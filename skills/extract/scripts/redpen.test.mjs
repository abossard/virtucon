// The session red pen as calculations.
// Run: node --test  (from this directory)

import { test } from "node:test";
import assert from "node:assert/strict";

import { RULES, claudeTurns, copilotTurns, isCorrection, isInjected, matches, quote, render, tally } from "./redpen.mjs";

const claudeLine = (text, extra = {}) => JSON.stringify({ type: "user", timestamp: "2026-10-28T10:00:00Z", cwd: "/r/qlcplus", message: { content: text }, ...extra });
const copilotLine = (text, data = {}) => JSON.stringify({ type: "user.message", timestamp: "2026-10-30T12:00:00Z", data: { content: text, ...data } });

/* ── reading turns ── */

for (const [name, lines, expected] of [
    ["a typed string turn", [claudeLine("no commits, never", { turnOrigin: "human" })], [{ origin: "typed", text: "no commits, never" }]],
    ["an older turn without origin", [claudeLine("dont stage")], [{ origin: "typed", text: "dont stage" }]],
    ["text blocks joined", [claudeLine([{ type: "text", text: "use " }, { type: "tool_result", content: "x" }, { type: "text", text: "sub sessions" }], { turnOrigin: "human" })], [{ origin: "typed", text: "use \nsub sessions" }]],
    ["a scheduled run marked auto", [claudeLine("check firmware", { turnOrigin: "scheduled" })], [{ origin: "auto", text: "check firmware" }]],
    ["peer and notification turns dropped", [claudeLine("From the other session", { turnOrigin: "peer" }), claudeLine("done", { turnOrigin: "task_notification" })], []],
    ["injected turns dropped", [claudeLine("<system-reminder>x</system-reminder>"), claudeLine("[Request interrupted by user]"), claudeLine("Stop hook feedback: not done"), claudeLine("This session is being continued from a previous conversation")], []],
    ["tool results and cut lines skipped", [claudeLine([{ type: "tool_result", content: "ok" }]), '{"type":"user","mess', ""], []],
]) {
    test(`claudeTurns reads ${name}`, () => {
        const turns = claudeTurns(lines.join("\n"), "s1");
        assert.deepEqual(turns.map(({ origin, text }) => ({ origin, text })), expected);
        for (const t of turns) assert.equal(t.session, "s1");
    });
}

for (const [name, lines, expected] of [
    ["a typed turn", [copilotLine("no synthetic tests")], [{ origin: "typed" }]],
    ["a steering turn from another agent", [copilotLine("do not stage", { source: "agent-abc" })], [{ origin: "steer" }]],
    ["autopilot and system turns", [copilotLine("continue", { source: "autopilot" }), copilotLine("tick", { source: "system" })], [{ origin: "auto" }, { origin: "auto" }]],
    ["a scripted brief to a subagent", [copilotLine("review the diff", { parentAgentTaskId: "t1" })], [{ origin: "brief" }]],
    ["empty content dropped", [copilotLine("   ")], []],
]) {
    test(`copilotTurns tags ${name}`, () => {
        const turns = copilotTurns(lines.join("\n"), "c1", "/r/foundry");
        assert.deepEqual(turns.map(({ origin }) => ({ origin })), expected);
        for (const t of turns) assert.equal(t.cwd, "/r/foundry");
    });
}

/* ── rules ── */

const rule = (id) => RULES.find((r) => r.id === id);

for (const [id, text] of [
    ["no-git-writes", "no commits, never"],
    ["no-git-writes", "please ondt push any changes and don't commit them either"],
    ["no-git-writes", "ok please address these open things, dont'stage or commit"],
    ["real-runs", "oh please! only do it with real Real Copilot rerun!"],
    ["real-runs", "run it against a REAL model."],
    ["real-runs", "no syntehtic tests, real end to end tests please"],
    ["sub-sessions", "make sure to use subsessions for not blow up the context"],
    ["sub-sessions", "work in sub sessions within this project to protect the context size"],
    ["no-sleep", "never sleep!!!! make it an eslint policy"],
    ["no-sleep", "waiting in terms of sleep or so: not a gooed idea"],
    ["act-like-user", "is the test going through the app with browser interaction like a user would?"],
    ["act-like-user", "can we have a rule to not use \"focus\" since that's not a user action?"],
    ["no-slop", "and stop adding the sstupid slop comments everywhere"],
    ["no-slop", "comment sentences with smicolon.... can you rewrite them"],
    ["inline-single-caller", "get rid of all functions that are only called from one place"],
    ["lean", "in the end I want minime the whole flow to be small and efficient again"],
    ["lean", "keep minime light and fun. simple"],
    ["browser-tool", "sorry, you have to use playweight MCP with Edge"],
    ["upstream", "it's important that it remains compatible with upastream"],
    ["branch-policy", "you can directly work on the main branch as well"],
    ["no-ai-attribution", "make 100% sure that claude will NEVER ever add any co-authored commit"],
]) {
    test(`${id} matches ${JSON.stringify(text)}`, () => assert.ok(matches(text, rule(id))));
}

for (const [id, text] of [
    ["no-git-writes", "bump version, commit and push please"],
    ["no-sleep", "the UI polls the board every second by design"],
    ["lean", "a simple question: where is the log?"],
    ["branch-policy", "the main thing is the export"],
]) {
    test(`${id} leaves ${JSON.stringify(text)} alone`, () => assert.equal(matches(text, rule(id)), false));
}

for (const [text, expected] of [
    ["no, don't add to the root", true],
    ["ONLY fix whats new in this BRANCH", true],
    ["you are so inaccurate and full of assumptions", false],
    ["what a mess, right?", true],
    ["yes, implement", false],
    ["how far are you?", false],
]) {
    test(`isCorrection ${JSON.stringify(text)} is ${expected}`, () => assert.equal(isCorrection(text), expected));
}

test("isInjected spots the harness wrappers", () => {
    assert.ok(isInjected("<task-notification>done</task-notification>"));
    assert.equal(isInjected("please run the tests"), false);
});

test("quote collapses whitespace and cuts long text", () => {
    assert.equal(quote("a  b\n\nc"), "a b c");
    assert.equal(quote("x".repeat(200), 20).length, 20);
});

/* ── the report ── */

const turn = (text, extra = {}) => ({ host: "claude", session: "s1", cwd: "/r/qlcplus", ts: "2026-10-28T10:00:00Z", origin: "typed", text, ...extra });

test("tally counts a rule per typed turn and session, relays separately, and lists the rest", () => {
    const report = tally([
        turn("no commits, never"),
        turn("dont stage or commit anything", { session: "s2" }),
        turn("Do not stage, commit, push", { origin: "steer", host: "copilot" }),
        turn("check firmware", { origin: "auto" }),
        turn("no, don't add to the root"),
        turn("yes, implement"),
    ]);
    assert.equal(report.typed, 4);
    assert.equal(report.steer, 1);
    assert.deepEqual(report.rules.map((r) => [r.id, r.count, r.sessions, r.relays]), [["no-git-writes", 2, 2, 1]]);
    assert.deepEqual(report.other.map((r) => r.quote), ["no, don't add to the root"]);
    assert.equal(report.rules[0].receipts[0].quote, "no commits, never");
});

test("tally sorts rules by count then relays and drops rules nobody said", () => {
    const report = tally([turn("use subsessions"), turn("use sub sessions", { session: "s2" }), turn("no commits")]);
    assert.deepEqual(report.rules.map((r) => r.id), ["sub-sessions", "no-git-writes"]);
});

test("render writes each rule with its receipts and the uncategorized corrections", () => {
    const md = render(tally([turn("no commits, never"), turn("what a mess, right?")]), { since: "2026-10-27" });
    assert.match(md, /^# Session red pen since 2026-10-27/);
    assert.match(md, /### Never stage, commit or push unless the user asks in this turn\n1 times in 1 sessions \(no-git-writes\)\n- "no commits, never" \(claude s1 2026-10-28 qlcplus\)/);
    assert.match(md, /## Corrections no rule names\n\n- "what a mess, right\?"/);
});
