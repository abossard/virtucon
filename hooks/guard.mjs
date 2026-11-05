#!/usr/bin/env node
// Guard hook for minime, registered for PreToolUse, UserPromptSubmit and Stop in hooks/hooks.json (both hosts).
// Reads the host's JSON on stdin, decides with guard-rules.mjs, prints one JSON object. Never fails: exits 0 with {} on any error.
// State under VIRTUCON_HQ: PAUSED (a file: everything stops), allow-git (a file younger than 8 h: git writes allowed, never for
// a conductor worker, which runs with MINIME_UNATTENDED=1), breaker/<key>.json.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { BREAKER_LIMIT, breakerState, commandOf, decide, firstPrompt, key, lastAssistant, output } from "./guard-rules.mjs";

const HQ = process.env.VIRTUCON_HQ || path.join(os.homedir(), ".minime");
const ALLOW_GIT_HOURS = 8;

function readStdin() {
    return new Promise((resolve) => {
        if (process.stdin.isTTY) return resolve({});
        let data = "";
        const finish = () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } };
        const timer = setTimeout(finish, 500);
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (chunk) => { data += chunk; });
        process.stdin.on("end", () => { clearTimeout(timer); finish(); });
        process.stdin.on("error", () => { clearTimeout(timer); finish(); });
    });
}

const readJson = (file) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; } };
const fresh = (file, hours) => { try { return Date.now() - statSync(file).mtimeMs < hours * 3600e3; } catch { return false; } };
const readText = (file) => { try { return readFileSync(file, "utf8"); } catch { return ""; } };

const breakerFile = (id) => path.join(HQ, "breaker", `${id}.json`);
const trippedFile = (...ids) => ids.map(breakerFile).find((f) => readJson(f)?.tripped);

function eventOf(input, argv) {
    const name = input.hook_event_name ?? input.hookEventName ?? argv[2] ?? "";
    return /prompt/i.test(name) ? "UserPromptSubmit" : /stop/i.test(name) ? "Stop" : "PreToolUse";
}

// On Stop: count identical replies to this session's first prompt; trip the breaker at the limit and tell the user once.
function stopVerdict(input, session) {
    const transcript = readText(input.transcript_path ?? input.transcriptPath ?? "");
    const reply = input.last_assistant_message ?? lastAssistant(transcript);
    const prompt = firstPrompt(transcript);
    if (!reply || !prompt) return {};
    const id = key(prompt);
    const next = breakerState(readJson(breakerFile(id)), reply);
    mkdirSync(path.join(HQ, "breaker"), { recursive: true });
    writeFileSync(breakerFile(id), JSON.stringify({ ...next, prompt: prompt.slice(0, 200), session }, null, 2));
    if (next.tripped && session) writeFileSync(breakerFile(session), JSON.stringify({ tripped: true, key: id }, null, 2));
    if (next.streak === BREAKER_LIMIT) {
        return { systemMessage: `minime circuit breaker: the last ${next.streak} replies to this prompt were identical. Its prompts and tools are blocked until ${breakerFile(id)} is deleted; a script that checks the same thing costs nothing.` };
    }
    return {};
}

async function main() {
    const input = await readStdin();
    const event = eventOf(input, process.argv);
    const session = input.session_id ?? input.sessionId ?? "";
    if (event === "Stop") return stopVerdict(input, session);
    const paused = existsSync(path.join(HQ, "PAUSED")) ? path.join(HQ, "PAUSED") : null;
    const prompt = input.prompt ?? "";
    const tripped = trippedFile(session, ...(prompt ? [key(prompt)] : []));
    // A Copilot prompt hook cannot block; mark the session so PreToolUse denies instead.
    if (event === "UserPromptSubmit" && tripped && session && !readJson(breakerFile(session))?.tripped) {
        mkdirSync(path.join(HQ, "breaker"), { recursive: true });
        writeFileSync(breakerFile(session), JSON.stringify({ tripped: true, key: key(prompt) }, null, 2));
    }
    const verdict = decide({
        event, paused, tripped,
        toolName: input.tool_name ?? input.toolName ?? "",
        command: event === "PreToolUse" ? commandOf(input) : "",
        allowGit: process.env.MINIME_UNATTENDED !== "1" && (process.env.MINIME_ALLOW_GIT === "1" || fresh(path.join(HQ, "allow-git"), ALLOW_GIT_HOURS)),
    });
    return output(event, verdict);
}

main().then((out) => { process.stdout.write(JSON.stringify(out) + "\n", () => process.exit(0)); })
    .catch(() => { process.stdout.write("{}\n", () => process.exit(0)); });
