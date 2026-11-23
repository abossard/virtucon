#!/usr/bin/env node
// Lossless, index-free regex recall over Claude Code and Copilot CLI JSONL histories.
// node grepmem.mjs --pattern <regex> [--since YYYY-MM-DD] [--repo <cwd substring>]

import { readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

export const LIMITS = {
    maxMatches: 30,
    contextLines: 3,
    responseChars: 6 * 1024,
    lineChars: 300,
    timeoutMs: 10_000,
    maxTimeoutMs: 60_000,
};

const RESULT_MARKER = "[GrepMem search result]";
const TEXT_FIELDS = ["text", "content", "message", "reasoning", "summary", "command", "stdout", "stderr", "output", "result", "error", "prompt"];
const INPUT_FIELDS = ["arguments", "args", "input"];

class GrepMemError extends Error {
    constructor(message, code = "usage") {
        super(message);
        this.name = "GrepMemError";
        this.code = code;
    }
}

export class GrepMemTimeoutError extends GrepMemError {
    constructor(timeoutMs) {
        super(`search timed out after ${timeoutMs} ms`, "timeout");
        this.name = "GrepMemTimeoutError";
    }
}

const compact = (value) => (value ?? "").replace(/\s+/g, " ").trim();

function json(value) {
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function typedOrigin(event) {
    if (event.turnOrigin === "scheduled") return "auto";
    if (event.turnOrigin === "human" || event.turnOrigin == null) return "typed";
    return event.turnOrigin;
}

function copilotOrigin(data) {
    const source = data?.source ?? "";
    if (source.startsWith("agent-")) return "steer";
    if (source === "autopilot" || source === "system") return "auto";
    if (data?.parentAgentTaskId) return "brief";
    return "typed";
}

function blocksOf(value) {
    if (typeof value === "string") return value ? [{ kind: "message", text: value }] : [];
    if (typeof value === "number" || typeof value === "boolean") return [{ kind: "data", text: String(value) }];
    if (value == null) return [];
    if (Array.isArray(value)) return value.flatMap(blocksOf);
    if (typeof value !== "object") return [{ kind: "data", text: String(value) }];

    const type = typeof value.type === "string" ? value.type : "";
    if (type === "text") return typeof value.text === "string" ? [{ kind: "text", text: value.text }] : [];
    if (type === "thinking") return blocksOf(value.thinking ?? value.text ?? value.content)
        .map((part) => ({ kind: "reasoning", text: `Reasoning: ${part.text}` }));
    if (type === "tool_use") {
        const name = value.name ?? value.tool_name ?? "unknown";
        const input = value.input ?? value.arguments ?? {};
        return [{ kind: "tool-call", text: `Tool call ${name}: ${json(input)}` }];
    }
    if (type === "tool_result") {
        const id = value.tool_use_id ? ` ${value.tool_use_id}` : "";
        const parts = blocksOf(value.content ?? value.text ?? value.output);
        return parts.length
            ? parts.map((part) => ({ ...part, kind: "tool-result", text: `Tool result${id}: ${part.text}` }))
            : [{ kind: "tool-result", text: `Tool result${id}: ${json(value)}` }];
    }

    const known = ["content", "text", "message"].flatMap((key) => blocksOf(value[key]));
    return known.length ? known : [{ kind: type || "data", text: json(value) }];
}

function record(base, part, partIndex) {
    const text = String(part.text ?? "").trimEnd();
    if (!text) return null;
    return {
        ...base,
        id: `${base.host}/${base.session}/${base.eventLine}/${partIndex}`,
        kind: part.kind,
        text,
    };
}

export function claudeRecords(jsonl, session, { cwd = "", mtimeMs = 0, file = "" } = {}) {
    const records = [];
    for (const [index, line] of jsonl.split("\n").entries()) {
        if (!line.trim() || !line.startsWith("{")) continue;
        const eventLine = index + 1;
        let event;
        try {
            event = JSON.parse(line);
        } catch {
            records.push(record({
                host: "claude",
                session,
                cwd,
                timestamp: "",
                turn: "",
                role: "raw",
                origin: "raw",
                eventLine,
                file,
                mtimeMs,
            }, { kind: "raw", text: line }, 0));
            continue;
        }

        const base = {
            host: "claude",
            session,
            cwd: event.cwd ?? cwd,
            timestamp: event.timestamp ?? "",
            turn: event.turn ?? event.message?.turn ?? "",
            role: event.message?.role ?? event.type ?? "event",
            origin: typedOrigin(event),
            eventLine,
            file,
            mtimeMs,
        };
        let parts = [];
        if (event.message && Object.hasOwn(event.message, "content")) parts = blocksOf(event.message.content);
        else if (Object.hasOwn(event, "summary")) parts = blocksOf(event.summary);
        else if (Object.hasOwn(event, "content")) parts = blocksOf(event.content);
        else if (event.type === "user" || event.type === "assistant" || event.type === "system") parts = blocksOf(event.message ?? "");
        if (!parts.length) parts = [{ kind: event.type || "event", text: json(event) }];

        records.push(...parts.map((part, partIndex) => record(base, part, partIndex)).filter(Boolean));
    }
    return records;
}

function copilotParts(data, eventType) {
    const parts = [];
    const handled = new Set();
    const toolName = data.toolName ?? data.tool_name ?? data.name;
    const inputKey = INPUT_FIELDS.find((key) => Object.hasOwn(data, key));
    if (/\btool\b/.test(eventType) && toolName && inputKey) {
        parts.push({ kind: "tool-call", text: `Tool call ${toolName}: ${json(data[inputKey])}` });
        handled.add(inputKey);
        handled.add("toolName");
        handled.add("tool_name");
        handled.add("name");
    }

    for (const key of [...TEXT_FIELDS, ...INPUT_FIELDS]) {
        if (handled.has(key) || !Object.hasOwn(data, key) || data[key] == null) continue;
        const extracted = blocksOf(data[key]);
        const kind = key === "reasoning" ? "reasoning"
            : key === "command" ? "tool-call"
                : key === "stdout" || key === "stderr" || key === "output" || key === "result" || key === "error" ? "tool-result"
                    : INPUT_FIELDS.includes(key) ? "tool-input" : "message";
        parts.push(...extracted.map((part) => ({
            kind: part.kind === "tool-call" || part.kind === "tool-result" ? part.kind : kind,
            text: part.text,
        })));
        handled.add(key);
    }
    return parts;
}

function copilotRole(eventType) {
    if (eventType.startsWith("user")) return "user";
    if (eventType.startsWith("assistant")) return "assistant";
    if (eventType.includes("tool")) return "tool";
    if (eventType.startsWith("system")) return "system";
    return "event";
}

export function copilotRecords(jsonl, session, { cwd = "", mtimeMs = 0, file = "" } = {}) {
    const records = [];
    for (const [index, line] of jsonl.split("\n").entries()) {
        if (!line.trim() || !line.startsWith("{")) continue;
        const eventLine = index + 1;
        let event;
        try {
            event = JSON.parse(line);
        } catch {
            records.push(record({
                host: "copilot",
                session,
                cwd,
                timestamp: "",
                turn: "",
                role: "raw",
                origin: "raw",
                eventLine,
                file,
                mtimeMs,
            }, { kind: "raw", text: line }, 0));
            continue;
        }

        const data = event.data && typeof event.data === "object" ? event.data : {};
        const type = event.type ?? "";
        let parts = copilotParts(data, type);
        if (!parts.length && typeof event.content !== "undefined") parts = blocksOf(event.content);
        if (!parts.length && Object.keys(data).length) parts = [{ kind: type || "event", text: json(data) }];
        if (!parts.length) continue;

        const base = {
            host: "copilot",
            session,
            cwd: event.cwd ?? data.cwd ?? cwd,
            timestamp: event.timestamp ?? data.timestamp ?? "",
            turn: event.turn ?? data.turn ?? data.turnId ?? "",
            role: copilotRole(type),
            origin: copilotOrigin(data),
            eventLine,
            file,
            mtimeMs,
        };
        records.push(...parts.map((part, partIndex) => record(base, part, partIndex)).filter(Boolean));
    }
    return records;
}

function directoryEntries(dir) {
    try {
        return readdirSync(dir, { withFileTypes: true });
    } catch (error) {
        if (error.code === "ENOENT") return [];
        throw error;
    }
}

function cwdOf(workspaceYaml) {
    try {
        return (readFileSync(workspaceYaml, "utf8").match(/^cwd:\s*(.+)$/m) ?? [])[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
    } catch (error) {
        if (error.code === "ENOENT") return "";
        throw error;
    }
}

function fileMtime(file) {
    return statSync(file).mtimeMs;
}

function filterRecords(records, { sinceMs, repo } = {}) {
    const needle = repo ? repo.toLowerCase() : "";
    return records.filter((item) => {
        if (needle && !item.cwd.toLowerCase().includes(needle)) return false;
        if (!sinceMs) return true;
        const timestamp = Date.parse(item.timestamp);
        return Number.isFinite(timestamp) ? timestamp >= sinceMs : item.mtimeMs >= sinceMs;
    });
}

export function readClaude(dir, options = {}) {
    const files = [];
    for (const entry of directoryEntries(dir)) {
        if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push({ file: path.join(dir, entry.name), session: entry.name.replace(/\.jsonl$/, "") });
        if (!entry.isDirectory()) continue;
        const project = path.join(dir, entry.name);
        for (const child of directoryEntries(project)) {
            if (child.isFile() && child.name.endsWith(".jsonl")) {
                files.push({ file: path.join(project, child.name), session: child.name.replace(/\.jsonl$/, "") });
            }
        }
    }

    return files.flatMap(({ file, session }) => {
        const mtimeMs = fileMtime(file);
        if (options.sinceMs && mtimeMs < options.sinceMs) return [];
        return filterRecords(claudeRecords(readFileSync(file, "utf8"), session, { file, mtimeMs }), options);
    });
}

export function readCopilot(dir, options = {}) {
    const records = [];
    for (const entry of directoryEntries(dir)) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        const sessionDir = path.join(dir, entry.name);
        const file = path.join(sessionDir, "events.jsonl");
        try {
            const mtimeMs = fileMtime(file);
            if (options.sinceMs && mtimeMs < options.sinceMs) continue;
            const cwd = cwdOf(path.join(sessionDir, "workspace.yaml"));
            records.push(...filterRecords(copilotRecords(
                readFileSync(file, "utf8"),
                entry.name,
                { cwd, file, mtimeMs },
            ), options));
        } catch (error) {
            if (error.code === "ENOENT") continue;
            throw error;
        }
    }
    return records;
}

export function readHistory({ claude, copilot, sinceMs, repo } = {}) {
    return [...readClaude(claude, { sinceMs, repo }), ...readCopilot(copilot, { sinceMs, repo })].sort((a, b) => {
        const aTime = Date.parse(a.timestamp);
        const bTime = Date.parse(b.timestamp);
        const left = Number.isFinite(aTime) ? aTime : a.mtimeMs;
        const right = Number.isFinite(bTime) ? bTime : b.mtimeMs;
        return left - right
            || a.host.localeCompare(b.host)
            || a.session.localeCompare(b.session)
            || a.eventLine - b.eventLine
            || a.id.localeCompare(b.id);
    });
}

export function compilePattern(pattern) {
    try {
        return new RegExp(pattern, "i");
    } catch (error) {
        throw new GrepMemError(`invalid regular expression: ${error.message}`);
    }
}

export function isPriorGrepMem(text) {
    return text.includes(RESULT_MARKER)
        || /(?:^|[\s"'`])\S*grepmem\.mjs\s+(?:[^\n]*\s)?--pattern(?:=|\s)/i.test(text);
}

export function searchHistory(records, options) {
    const {
        pattern,
        maxMatches = 10,
        offset = 0,
        count = false,
        deadlineMs = 0,
        now = Date.now,
    } = options;
    const regex = compilePattern(pattern);
    const matches = [];
    const byHost = {};
    const entries = new Set();
    let total = 0;

    for (const item of records) {
        if (isPriorGrepMem(item.text)) continue;
        const lines = item.text.split(/\r?\n/);
        for (const [lineIndex, line] of lines.entries()) {
            if (lineIndex % 32 === 0 && deadlineMs && now() >= deadlineMs) throw new GrepMemTimeoutError(Math.max(0, deadlineMs - Date.now()));
            regex.lastIndex = 0;
            if (!regex.test(line)) continue;
            total++;
            entries.add(item.id);
            byHost[item.host] = (byHost[item.host] ?? 0) + 1;
            if (!count && total > offset && matches.length < maxMatches) {
                matches.push({ record: item, lineIndex, ordinal: total });
            }
        }
    }

    return {
        total,
        entryCount: entries.size,
        byHost,
        offset,
        matches,
    };
}

function clipLine(line, pattern, matched = false) {
    if (line.length <= LIMITS.lineChars) return line;
    let start = 0;
    let end = LIMITS.lineChars;
    if (matched && pattern) {
        pattern.lastIndex = 0;
        const match = pattern.exec(line);
        if (match) {
            const center = match.index + Math.floor(match[0].length / 2);
            start = Math.max(0, center - Math.floor(LIMITS.lineChars / 2));
            end = start + LIMITS.lineChars;
        }
    }
    const prefix = start > 0 ? "..." : "";
    const suffix = end < line.length ? "..." : "";
    const room = LIMITS.lineChars - prefix.length - suffix.length;
    return `${prefix}${line.slice(start, Math.min(line.length, start + room))}${suffix}`;
}

function header(match) {
    const item = match.record;
    const turn = item.turn ? ` turn ${compact(item.turn)}` : ` event ${item.eventLine}`;
    const source = item.origin && item.origin !== "raw" ? `${item.role}/${item.origin}` : item.role;
    const timestamp = item.timestamp ? ` ${item.timestamp}` : "";
    const cwd = item.cwd ? ` ${compact(item.cwd)}` : "";
    return clipLine(`== [${item.host} session ${compact(item.session)}${turn} ${source}${compact(item.kind)}]${timestamp}${cwd}`);
}

function renderMatch(match, contextLines, pattern) {
    const item = match.record;
    const lines = item.text.split(/\r?\n/);
    const start = Math.max(0, match.lineIndex - contextLines);
    const end = Math.min(lines.length - 1, match.lineIndex + contextLines);
    const rendered = [header(match)];
    for (let index = start; index <= end; index++) {
        const matched = index === match.lineIndex;
        const marker = matched ? ":" : "-";
        const text = clipLine(lines[index], pattern, matched);
        rendered.push(`${index + 1}${marker} ${text}`);
    }
    return rendered.join("\n");
}

function summary(result) {
    const hosts = Object.entries(result.byHost)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([host, count]) => `${host}: ${count}`)
        .join(", ");
    return `${result.total} matching line(s) in ${result.entryCount} history record(s)${hosts ? ` (${hosts})` : ""}.`;
}

export function renderResult(result, { contextLines = 1, pattern, count = false } = {}) {
    const prefix = `${RESULT_MARKER}\n${summary(result)}`;
    if (count || result.total === 0) return prefix;

    const regex = compilePattern(pattern);
    const blocks = [];
    let included = 0;
    let nextOffset = result.offset;

    for (const match of result.matches) {
        const block = renderMatch(match, contextLines, regex);
        const candidateCount = included + 1;
        const candidateNext = result.offset + candidateCount;
        const candidateFooter = `(showing matches ${result.offset + 1}-${candidateNext} of ${result.total}${candidateNext < result.total ? `; continue with --offset ${candidateNext}` : ""})`;
        const candidate = `${prefix}\n${[...blocks, block].join("\n")}\n${candidateFooter}`;
        if (candidate.length > LIMITS.responseChars && included > 0) break;
        blocks.push(block);
        included = candidateCount;
        nextOffset = candidateNext;
        if (candidate.length >= LIMITS.responseChars) break;
    }

    const start = included ? result.offset + 1 : 0;
    const end = included ? result.offset + included : 0;
    const more = nextOffset < result.total;
    const footer = `(showing matches ${start}-${end} of ${result.total}${more ? `; continue with --offset ${nextOffset}` : ""})`;
    const output = `${prefix}${blocks.length ? `\n${blocks.join("\n")}` : ""}\n${footer}`;
    return output.length <= LIMITS.responseChars ? output : output.slice(0, LIMITS.responseChars);
}

function integerOption(name, value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
    if (!/^\d+$/.test(String(value))) throw new GrepMemError(`${name} must be an integer`);
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < min || number > max) {
        throw new GrepMemError(`${name} must be between ${min} and ${max}`);
    }
    return number;
}

function sinceMsOf(value) {
    if (!value) return 0;
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value;
    const parsed = Date.parse(normalized);
    if (!Number.isFinite(parsed)) throw new GrepMemError(`--since is not a valid date: ${value}`);
    return parsed;
}

export function parseArgs(argv, home = os.homedir()) {
    const options = {
        maxMatches: 10,
        offset: 0,
        contextLines: 1,
        count: false,
        timeoutMs: LIMITS.timeoutMs,
        claude: path.join(home, ".claude", "projects"),
        copilot: path.join(home, ".copilot", "session-state"),
        since: "",
        repo: "",
        help: false,
    };
    const values = new Map([
        ["--pattern", "pattern"],
        ["--since", "since"],
        ["--repo", "repo"],
        ["--claude", "claude"],
        ["--copilot", "copilot"],
        ["--max-matches", "maxMatches"],
        ["--offset", "offset"],
        ["--context-lines", "contextLines"],
        ["--timeout-ms", "timeoutMs"],
    ]);
    for (let index = 0; index < argv.length; index++) {
        const token = argv[index];
        if (token === "--help") {
            options.help = true;
            continue;
        }
        if (token === "--count") {
            options.count = true;
            continue;
        }
        const equals = token.indexOf("=");
        const flag = equals >= 0 ? token.slice(0, equals) : token;
        const key = values.get(flag);
        if (!key) throw new GrepMemError(`unknown option: ${token}`);
        const value = equals >= 0 ? token.slice(equals + 1) : argv[++index];
        if (value === undefined || value === "") throw new GrepMemError(`${flag} requires a value`);
        options[key] = value;
    }
    if (options.help) return options;
    if (!options.pattern) throw new GrepMemError("--pattern is required");
    options.maxMatches = integerOption("--max-matches", options.maxMatches, { min: 1, max: LIMITS.maxMatches });
    options.offset = integerOption("--offset", options.offset);
    options.contextLines = integerOption("--context-lines", options.contextLines, { max: LIMITS.contextLines });
    options.timeoutMs = integerOption("--timeout-ms", options.timeoutMs, { min: 1, max: LIMITS.maxTimeoutMs });
    options.sinceMs = sinceMsOf(options.since);
    compilePattern(options.pattern);
    return options;
}

const USAGE = `Usage:
  node grepmem.mjs --pattern <regex> [options]

Options:
  --since <date>          Include events from this ISO date or later
  --repo <substring>      Match a session working-directory substring
  --claude <dir>          Override ~/.claude/projects
  --copilot <dir>         Override ~/.copilot/session-state
  --max-matches <1-30>    Matches per page (default 10)
  --offset <n>            Matching lines to skip (default 0)
  --context-lines <0-3>   Surrounding lines per match (default 1)
  --count                 Return counts without match contents
  --timeout-ms <1-60000>  Search timeout (default 10000)
`;

async function workerSearch(records, options) {
    if (isMainThread === false) throw new GrepMemError("workerSearch cannot run inside a worker", "runtime");
    return new Promise((resolve, reject) => {
        const worker = new Worker(fileURLToPath(import.meta.url), {
            workerData: { mode: "search", records, options },
        });
        const timer = setTimeout(() => {
            worker.terminate();
            reject(new GrepMemTimeoutError(options.timeoutMs));
        }, options.timeoutMs);
        let settled = false;
        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            callback(value);
        };
        worker.once("message", (message) => {
            if (message.ok) finish(resolve, message.result);
            else {
                const error = new GrepMemError(message.error?.message ?? "search worker failed", message.error?.code ?? "runtime");
                error.name = message.error?.name ?? error.name;
                finish(reject, error);
            }
        });
        worker.once("error", (error) => finish(reject, error));
        worker.once("exit", (code) => {
            if (code !== 0) finish(reject, new GrepMemError(`search worker exited with code ${code}`, "runtime"));
        });
    });
}

export async function main(argv = process.argv.slice(2), io = { stdout: process.stdout, stderr: process.stderr }) {
    let options;
    try {
        options = parseArgs(argv);
    } catch (error) {
        io.stderr.write(`grepmem: ${error.message}\n\n${USAGE}`);
        return 2;
    }
    if (options.help) {
        io.stdout.write(USAGE);
        return 0;
    }

    const started = Date.now();
    try {
        const records = readHistory(options);
        const remaining = options.timeoutMs - (Date.now() - started);
        if (remaining <= 0) throw new GrepMemTimeoutError(options.timeoutMs);
        const result = await workerSearch(records, {
            pattern: options.pattern,
            maxMatches: options.maxMatches,
            offset: options.offset,
            count: options.count,
            timeoutMs: remaining,
        });
        io.stdout.write(`${renderResult(result, options)}\n`);
        return 0;
    } catch (error) {
        const expected = error instanceof GrepMemError;
        io.stderr.write(`grepmem: ${error.message}\n`);
        return expected && error.code === "usage" ? 2 : 1;
    }
}

if (!isMainThread && workerData?.mode === "search") {
    try {
        parentPort.postMessage({
            ok: true,
            result: searchHistory(workerData.records, { ...workerData.options, deadlineMs: Date.now() + workerData.options.timeoutMs }),
        });
    } catch (error) {
        parentPort.postMessage({
            ok: false,
            error: { name: error.name, code: error.code, message: error.message },
        });
    }
} else if (isMainThread && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = await main();
}
