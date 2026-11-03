#!/usr/bin/env node
// Script-first session watcher: which Copilot CLI and Claude Code sessions stopped on a network error and were never resumed.
// Zero model calls. Prints one JSON list; with --resume it resumes each stuck Copilot session once and prints the Claude commands.
//   node conductor/sessions-watch.mjs [--idle <minutes>] [--hours <lookback>] [--copilot <dir>] [--claude <dir>] [--resume]
// Meant for cron or launchd in place of a model-driven monitor; a model is only needed when this list is not empty.

import { spawnSync } from "node:child_process";
import { closeSync, openSync, readdirSync, readSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* ── calculations ── */

export const NETWORK = /ENOTFOUND|ECONNRESET|ETIMEDOUT|ECONNREFUSED|Connect\)|\b408\b|network|Connection error|getaddrinfo|fetch failed/i;

function parseLines(text) {
    const out = [];
    for (const line of String(text).split("\n")) {
        if (!line.startsWith("{")) continue;
        try { out.push(JSON.parse(line)); } catch { /* a cut line */ }
    }
    return out;
}

const minutesSince = (ts, now) => Math.round((now - new Date(ts).getTime()) / 60e3);

// A Copilot session is stuck when its tail ends in a network error with no user turn after it and it has sat idle long enough.
export function stuckCopilot(tail, { now = Date.now(), idleMinutes = 15 } = {}) {
    const events = parseLines(tail);
    let error = null;
    for (const e of events) {
        if (e.type === "session.error" && NETWORK.test(e.data?.message ?? "")) error = e;
        else if (e.type === "user.message" || e.type === "session.shutdown") error = null;
    }
    if (!error) return null;
    const idle = minutesSince(error.timestamp, now);
    return idle >= idleMinutes ? { error: String(error.data?.message ?? "").slice(0, 120), idleMinutes: idle } : null;
}

// A Claude Code session is stuck when its tail ends in a network api_error with no user turn after it.
export function stuckClaude(tail, { now = Date.now(), idleMinutes = 15 } = {}) {
    const entries = parseLines(tail);
    let error = null;
    for (const e of entries) {
        if (e.type === "system" && e.subtype === "api_error" && (e.error?.isNetworkDown || NETWORK.test(e.error?.formatted ?? e.error?.message ?? ""))) error = e;
        else if (e.type === "user" && !e.isSidechain) error = null;
    }
    if (!error) return null;
    const idle = minutesSince(error.timestamp, now);
    return idle >= idleMinutes ? { error: String(error.error?.formatted ?? error.error?.message ?? "").slice(0, 120), idleMinutes: idle } : null;
}

/* ── actions ── */

// The last bytes of a large log: enough for the final events without reading a 300 MB file.
export function tailOf(file, bytes = 65536) {
    const size = statSync(file).size;
    const fd = openSync(file, "r");
    try {
        const length = Math.min(bytes, size);
        const buffer = Buffer.alloc(length);
        readSync(fd, buffer, 0, length, size - length);
        const text = buffer.toString("utf8");
        return length < size ? text.slice(text.indexOf("\n") + 1) : text;
    } finally { closeSync(fd); }
}

function arg(argv, name, fallback) { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback; }
const recent = (file, hours) => { try { return Date.now() - statSync(file).mtimeMs < hours * 3600e3; } catch { return false; } };
const cwdOf = (yaml) => { try { return (readFileSync(yaml, "utf8").match(/^cwd:\s*(.+)$/m) ?? [])[1]?.trim() ?? ""; } catch { return ""; } };

export function scan({ copilot, claude, hours, idleMinutes, now = Date.now() }) {
    const stuck = [];
    for (const s of readdirSync(copilot, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith("."))) {
        const file = path.join(copilot, s.name, "events.jsonl");
        if (!recent(file, hours)) continue;
        const hit = stuckCopilot(tailOf(file), { now, idleMinutes });
        if (hit) stuck.push({ host: "copilot", id: s.name, cwd: cwdOf(path.join(copilot, s.name, "workspace.yaml")), ...hit });
    }
    for (const project of readdirSync(claude, { withFileTypes: true }).filter((d) => d.isDirectory())) {
        for (const f of readdirSync(path.join(claude, project.name)).filter((n) => n.endsWith(".jsonl"))) {
            const file = path.join(claude, project.name, f);
            if (!recent(file, hours)) continue;
            const hit = stuckClaude(tailOf(file), { now, idleMinutes });
            if (hit) stuck.push({ host: "claude", id: f.replace(/\.jsonl$/, ""), cwd: project.name, ...hit });
        }
    }
    return stuck;
}

function resume(stuck) {
    for (const s of stuck) {
        if (s.host === "copilot") {
            const r = spawnSync("copilot", ["--resume", s.id, "-p", "Continue from where you left off.", "-s"], { encoding: "utf8", cwd: s.cwd || undefined });
            s.resumed = r.status === 0 ? "ok" : `exit ${r.status}: ${(r.stderr ?? "").trim().slice(-200)}`;
        } else {
            s.resumed = `run: claude -r ${s.id}`;
        }
    }
    return stuck;
}

function main(argv) {
    const home = os.homedir();
    const stuck = scan({
        copilot: arg(argv, "--copilot", path.join(home, ".copilot", "session-state")),
        claude: arg(argv, "--claude", path.join(home, ".claude", "projects")),
        hours: Number(arg(argv, "--hours", "24")),
        idleMinutes: Number(arg(argv, "--idle", "15")),
    });
    process.stdout.write(JSON.stringify(argv.includes("--resume") ? resume(stuck) : stuck, null, 2) + "\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
