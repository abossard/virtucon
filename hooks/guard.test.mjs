// The guard's decisions as calculations, and the hook end to end through stdin.
// Run: node --test guard.test.mjs  (from this directory)

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { allowedRestore, attributed, breakerState, commandOf, decide, deniedCommand, firstPrompt, isShell, key, lastAssistant, normalize, output } from "./guard-rules.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

/* ── commands ── */

for (const [command, expected] of [
    ["git commit -m x", "git commit"],
    ["npm test && git push origin main", "git push"],
    ["sudo git reset --hard", "git reset"],
    ["gh pr create --fill", "gh pr create"],
    ["gh api -X POST repos/a/b/issues", "gh api -X"],
    ["git status; git diff", null],
    ["git log --oneline | head", null],
    ["echo 'git push' > notes.md", null],
    ["gh pr view 12", null],
    ["", null],
    ["git restore -- tests/screenshots/a.svg tests/b.svg", null],
    ["git restore --staged tests/a.svg", "git restore"],
    ["git restore -- src/app.py", "git restore"],
    ["pytest; git restore -- tests/a.svg && git status", null],
    ["npm test && git restore .", "git restore"],
]) {
    test(`deniedCommand ${JSON.stringify(command)} is ${expected}`, () => assert.equal(deniedCommand(command), expected));
}

for (const [segment, expected] of [
    ["git restore -- tests/screenshots/a.svg", true],
    ["git restore --source=HEAD --worktree -- pkg/__tests__/x.snap", true],
    ["git restore --source HEAD -W -- 'tests/a b.svg'", true],
    ["git restore tests/fixtures/a.json spec/b.yml", true],
    ["git restore", false],
    ["git restore -- tests/a.svg src/a.py", false],
    ["git restore --staged -- tests/a.svg", false],
    ["git restore -S tests/a.svg", false],
    ["git restore --source=main -- tests/a.svg", false],
    ["git restore -- .", false],
    ["git restore -- testsuite/a.svg", false],
    ["git restore -- contest/a.svg", false],
]) {
    test(`allowedRestore ${JSON.stringify(segment)} is ${expected}`, () => assert.equal(allowedRestore(segment), expected));
}

for (const [command, expected] of [
    ["git commit -m 'fix\n\nCo-Authored-By: Claude <noreply@anthropic.com>'", true],
    ["git commit -m 'fix' -m 'Generated with [Claude Code]'", true],
    ["git commit -m 'co-authored by the team'", false],
]) {
    test(`attributed ${JSON.stringify(command.slice(0, 40))} is ${expected}`, () => assert.equal(attributed(command), expected));
}

for (const [input, expected] of [
    [{ tool_input: { command: "git push" } }, "git push"],
    [{ toolArgs: { command: "ls" } }, "ls"],
    [{ tool_input: "raw" }, "raw"],
    [{}, ""],
]) {
    test(`commandOf ${JSON.stringify(input)}`, () => assert.equal(commandOf(input), expected));
}

for (const [name, expected] of [["Bash", true], ["bash", true], ["shell", true], ["powershell", true], ["Edit", false], ["Read", false], [undefined, false]]) {
    test(`isShell ${name} is ${expected}`, () => assert.equal(isShell(name), expected));
}

/* ── decisions ── */

for (const [name, args, expected] of [
    ["a read tool", { event: "PreToolUse", toolName: "Read", command: "" }, "allow"],
    ["a plain command", { event: "PreToolUse", toolName: "Bash", command: "npm test" }, "allow"],
    ["a commit", { event: "PreToolUse", toolName: "Bash", command: "git commit -m x" }, "deny"],
    ["a commit the user allowed", { event: "PreToolUse", toolName: "Bash", command: "git commit -m x", allowGit: true }, "allow"],
    ["an attributed commit even when allowed", { event: "PreToolUse", toolName: "Bash", command: "git commit -m 'x\n\nCo-Authored-By: Claude'", allowGit: true }, "deny"],
    ["any tool while paused", { event: "PreToolUse", toolName: "Read", command: "", paused: "/hq/PAUSED" }, "deny"],
    ["a prompt while paused", { event: "UserPromptSubmit", paused: "/hq/PAUSED" }, "deny"],
    ["a prompt whose breaker tripped", { event: "UserPromptSubmit", tripped: "/hq/breaker/abc.json" }, "deny"],
    ["a prompt otherwise", { event: "UserPromptSubmit" }, "allow"],
    ["a commit in a Copilot shell tool", { event: "PreToolUse", toolName: "shell", command: "git add -A" }, "deny"],
    ["a restore of rewritten snapshots", { event: "PreToolUse", toolName: "shell", command: "git restore -- tests/screenshots/a.svg" }, "allow"],
    ["a restore of a source file", { event: "PreToolUse", toolName: "Bash", command: "git restore -- src/app.py" }, "deny"],
    ["a restore of a source file the user allowed", { event: "PreToolUse", toolName: "Bash", command: "git restore -- src/app.py", allowGit: true }, "allow"],
]) {
    test(`decide ${name}: ${expected}`, () => assert.equal(decide(args).decision, expected));
}

test("decide names the one restore allowed", () => {
    assert.match(decide({ event: "PreToolUse", toolName: "Bash", command: "git restore -- src/app.py" }).reason, /under a test directory/);
});

test("decide names the command and the way to allow it", () => {
    const v = decide({ event: "PreToolUse", toolName: "Bash", command: "git push" });
    assert.match(v.reason, /'git push'/);
    assert.match(v.reason, /MINIME_ALLOW_GIT=1/);
});

for (const [event, verdict, expected] of [
    ["PreToolUse", { decision: "allow" }, {}],
    ["PreToolUse", { decision: "deny", reason: "r" }, { permissionDecision: "deny", permissionDecisionReason: "r", hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "r" } }],
    ["UserPromptSubmit", { decision: "deny", reason: "r" }, { decision: "block", reason: "r" }],
]) {
    test(`output for ${event} ${verdict.decision}`, () => assert.deepEqual(output(event, verdict), expected));
}

/* ── the breaker ── */

test("normalize ignores case, digits, spaces and punctuation", () => {
    assert.equal(normalize("No new firmware (checked 2026-11-03, 08:00)."), normalize("no new firmware checked"));
    assert.notEqual(normalize("no new firmware"), normalize("new firmware 19.0.1 found"));
});

test("key is stable across the same prompt with other numbers", () => assert.equal(key("check hourly at 10:00"), key("check hourly at 11:00")));

test("breakerState counts a streak of identical replies and trips at three", () => {
    const s1 = breakerState(null, "Monitoring remains blocked.");
    const s2 = breakerState(s1, "Monitoring remains blocked!");
    const s3 = breakerState(s2, "monitoring remains blocked");
    assert.deepEqual([s1.streak, s2.streak, s3.streak], [1, 2, 3]);
    assert.deepEqual([s1.tripped, s2.tripped, s3.tripped], [false, false, true]);
    assert.equal(breakerState(s3, "Firmware 19.0.1 is out").streak, 1);
    assert.equal(breakerState(s3, "").streak, 0);
});

const claude = (entries) => entries.map((e) => JSON.stringify(e)).join("\n");

test("lastAssistant and firstPrompt read a Claude transcript", () => {
    const t = claude([
        { type: "user", message: { content: "<system-reminder>x</system-reminder>" } },
        { type: "user", message: { content: [{ type: "text", text: "check firmware hourly" }] } },
        { type: "assistant", message: { content: [{ type: "text", text: "Looking." }] } },
        { type: "assistant", isSidechain: true, message: { content: [{ type: "text", text: "side" }] } },
        { type: "assistant", message: { content: [{ type: "tool_use", name: "Bash" }, { type: "text", text: "No new firmware." }] } },
    ]);
    assert.equal(lastAssistant(t), "No new firmware.");
    assert.equal(firstPrompt(t), "check firmware hourly");
});

test("lastAssistant and firstPrompt read a Copilot events file", () => {
    const t = claude([
        { type: "user.message", data: { content: "brief", parentAgentTaskId: "sub" } },
        { type: "user.message", data: { content: "Check all active sessions" } },
        { type: "assistant.message", agentId: "a1", data: { content: "sub reply" } },
        { type: "assistant.message", data: { content: "Monitoring remains blocked." } },
    ]);
    assert.equal(lastAssistant(t), "Monitoring remains blocked.");
    assert.equal(firstPrompt(t), "Check all active sessions");
});

/* ── the hook end to end ── */

function run(input, hq, env = {}) {
    const r = spawnSync(process.execPath, [path.join(here, "guard.mjs")], { input: JSON.stringify(input), encoding: "utf8", env: { ...process.env, VIRTUCON_HQ: hq, ...env } });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
}

test("guard.mjs denies a commit, allows it with the env flag or a fresh allow-git file, and stays silent otherwise", () => {
    const hq = mkdtempSync(path.join(os.tmpdir(), "minime-guard-"));
    try {
        const commit = { hook_event_name: "PreToolUse", session_id: "s", tool_name: "Bash", tool_input: { command: "git commit -m x" } };
        assert.equal(run(commit, hq).permissionDecision, "deny");
        assert.deepEqual(run({ ...commit, tool_input: { command: "npm test" } }, hq), {});
        assert.deepEqual(run(commit, hq, { MINIME_ALLOW_GIT: "1" }), {});
        writeFileSync(path.join(hq, "allow-git"), "");
        assert.deepEqual(run(commit, hq), {});
        const old = new Date(Date.now() - 9 * 3600e3);
        utimesSync(path.join(hq, "allow-git"), old, old);
        assert.equal(run(commit, hq).permissionDecision, "deny");
    } finally { rmSync(hq, { recursive: true, force: true }); }
});

test("guard.mjs blocks prompts and tools while PAUSED exists", () => {
    const hq = mkdtempSync(path.join(os.tmpdir(), "minime-guard-"));
    try {
        writeFileSync(path.join(hq, "PAUSED"), "");
        assert.equal(run({ hook_event_name: "UserPromptSubmit", prompt: "go" }, hq).decision, "block");
        assert.equal(run({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: {} }, hq).permissionDecision, "deny");
    } finally { rmSync(hq, { recursive: true, force: true }); }
});

test("guard.mjs trips the breaker on the third identical reply, then blocks the prompt and the session's tools", () => {
    const hq = mkdtempSync(path.join(os.tmpdir(), "minime-guard-"));
    try {
        const prompt = "check for new firmware";
        const transcript = path.join(hq, "t.jsonl");
        writeFileSync(transcript, claude([{ type: "user", message: { content: prompt } }, { type: "assistant", message: { content: [{ type: "text", text: "No new firmware." }] } }]));
        const stop = (session) => run({ hook_event_name: "Stop", session_id: session, transcript_path: transcript, last_assistant_message: "No new firmware." }, hq);
        assert.deepEqual(stop("r1"), {});
        assert.deepEqual(stop("r2"), {});
        assert.match(stop("r3").systemMessage, /circuit breaker/);
        assert.deepEqual(stop("r4"), {});
        assert.equal(run({ hook_event_name: "UserPromptSubmit", session_id: "r5", prompt }, hq).decision, "block");
        assert.equal(run({ hook_event_name: "PreToolUse", session_id: "r5", tool_name: "Read", tool_input: {} }, hq).permissionDecision, "deny");
        assert.deepEqual(run({ hook_event_name: "PreToolUse", session_id: "other", tool_name: "Read", tool_input: {} }, hq), {});
        rmSync(path.join(hq, "breaker"), { recursive: true });
        assert.deepEqual(run({ hook_event_name: "UserPromptSubmit", session_id: "r6", prompt }, hq), {});
    } finally { rmSync(hq, { recursive: true, force: true }); }
});

test("guard.mjs answers {} on garbage input", () => {
    const hq = mkdtempSync(path.join(os.tmpdir(), "minime-guard-"));
    mkdirSync(hq, { recursive: true });
    try {
        const r = spawnSync(process.execPath, [path.join(here, "guard.mjs")], { input: "not json", encoding: "utf8", env: { ...process.env, VIRTUCON_HQ: hq } });
        assert.equal(r.status, 0);
        assert.deepEqual(JSON.parse(r.stdout), {});
    } finally { rmSync(hq, { recursive: true, force: true }); }
});
