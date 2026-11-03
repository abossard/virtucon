// The session watcher as calculations, plus the tail reader and a scan over fixture directories.
// Run: node --test sessions-watch.test.mjs  (from this directory)

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { scan, stuckClaude, stuckCopilot, tailOf } from "./sessions-watch.mjs";

const T0 = Date.parse("2026-11-03T10:00:00Z");
const at = (minutesAgo) => new Date(T0 - minutesAgo * 60e3).toISOString();
const jsonl = (entries) => entries.map((e) => JSON.stringify(e)).join("\n") + "\n";

const copilotError = (minutesAgo, message = "Failed native model HTTP request: error sending request (Connect): dns error") =>
    ({ type: "session.error", timestamp: at(minutesAgo), data: { errorType: "query", message } });

for (const [name, entries, expected] of [
    ["a network error left alone for 30 minutes", [{ type: "assistant.message", timestamp: at(31), data: { content: "working" } }, copilotError(30)], { idleMinutes: 30 }],
    ["a network error only 5 minutes old", [copilotError(5)], null],
    ["an error the user already answered", [copilotError(30), { type: "user.message", timestamp: at(20), data: { content: "continue" } }], null],
    ["an error before a clean shutdown", [copilotError(30), { type: "session.shutdown", timestamp: at(29) }], null],
    ["a non-network error", [copilotError(30, "Execution failed: tool result too large")], null],
    ["no error at all", [{ type: "assistant.message", timestamp: at(30), data: { content: "done" } }], null],
    ["a cut last line", [copilotError(30)], { idleMinutes: 30 }],
]) {
    test(`stuckCopilot sees ${name}`, () => {
        const tail = jsonl(entries) + (name.startsWith("a cut") ? '{"type":"assis' : "");
        const hit = stuckCopilot(tail, { now: T0 });
        if (expected === null) assert.equal(hit, null);
        else { assert.equal(hit.idleMinutes, expected.idleMinutes); assert.match(hit.error, /Connect/); }
    });
}

const claudeError = (minutesAgo, error = { message: "Connection error.", formatted: "Can't reach the API server (ENOTFOUND)", isNetworkDown: true }) =>
    ({ type: "system", subtype: "api_error", timestamp: at(minutesAgo), error });

for (const [name, entries, expected] of [
    ["a network api_error left alone", [claudeError(40)], { idleMinutes: 40 }],
    ["an api_error the user followed up on", [claudeError(40), { type: "user", timestamp: at(10), message: { content: "go on" } }], null],
    ["a sidechain user entry after the error", [claudeError(40), { type: "user", isSidechain: true, timestamp: at(10), message: { content: "sub" } }], { idleMinutes: 40 }],
    ["a rate limit, not the network", [claudeError(40, { message: "rate_limit_error", formatted: "You have hit your usage limit", isNetworkDown: false })], null],
    ["a fresh error", [claudeError(3)], null],
]) {
    test(`stuckClaude sees ${name}`, () => {
        const hit = stuckClaude(jsonl(entries), { now: T0 });
        if (expected === null) assert.equal(hit, null);
        else assert.equal(hit.idleMinutes, expected.idleMinutes);
    });
}

test("idleMinutes is a threshold", () => {
    assert.ok(stuckCopilot(jsonl([copilotError(16)]), { now: T0, idleMinutes: 15 }));
    assert.equal(stuckCopilot(jsonl([copilotError(14)]), { now: T0, idleMinutes: 15 }), null);
});

test("tailOf returns whole small files and only complete trailing lines of large ones", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "minime-watch-"));
    try {
        const small = path.join(dir, "small.jsonl");
        writeFileSync(small, "a\nb\n");
        assert.equal(tailOf(small), "a\nb\n");
        const big = path.join(dir, "big.jsonl");
        writeFileSync(big, Array.from({ length: 50 }, (_, i) => `{"n":${i},"pad":"${"x".repeat(100)}"}`).join("\n") + "\n");
        const tail = tailOf(big, 500);
        assert.ok(tail.startsWith("{"));
        assert.ok(tail.length <= 500);
        assert.match(tail, /"n":49/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("scan lists stuck sessions of both hosts with their directories", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "minime-watch-"));
    try {
        const copilot = path.join(dir, "copilot");
        const claude = path.join(dir, "claude");
        mkdirSync(path.join(copilot, "abc"), { recursive: true });
        writeFileSync(path.join(copilot, "abc", "events.jsonl"), jsonl([copilotError(30)]));
        writeFileSync(path.join(copilot, "abc", "workspace.yaml"), "id: abc\ncwd: /r/foundry\n");
        mkdirSync(path.join(copilot, "fine"), { recursive: true });
        writeFileSync(path.join(copilot, "fine", "events.jsonl"), jsonl([{ type: "assistant.message", timestamp: at(30), data: { content: "ok" } }]));
        mkdirSync(path.join(claude, "-Users-me-proj"), { recursive: true });
        writeFileSync(path.join(claude, "-Users-me-proj", "s1.jsonl"), jsonl([claudeError(40)]));
        const stuck = scan({ copilot, claude, hours: 24, idleMinutes: 15, now: T0 });
        assert.deepEqual(stuck.map(({ host, id, cwd, idleMinutes }) => ({ host, id, cwd, idleMinutes })), [
            { host: "copilot", id: "abc", cwd: "/r/foundry", idleMinutes: 30 },
            { host: "claude", id: "s1", cwd: "-Users-me-proj", idleMinutes: 40 },
        ]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});
