// The conductor's flow as calculations.
// Run: node --test  (from this directory)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { check } from "../skills/blueprint/scripts/blueprint.mjs";
import * as flow from "./flow.mjs";

const ORCHESTRATION = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "ORCHESTRATION.md"), "utf8");
const base = () => flow.newRun({ task: "fix the export", repo: "/r", hq: "/hq", plugin: "/p", now: 0 });
const done = (extra = {}) => flow.parseResult(JSON.stringify({ status: "done", blueprint_path: "/hq/bp.md", changed_files: [], blocking_issue: null, evidence_excerpts: [], ...extra }));

/* ── results ── */

for (const [name, text, expected] of [
    ["a json block at the end", 'Done.\n```json\n{"status":"done","blueprint_path":"/b.md","changed_files":["a.js"],"blocking_issue":null,"evidence_excerpts":["npm test: 3 pass"]}\n```', { status: "done", blueprint_path: "/b.md", changed_files: ["a.js"] }],
    ["the last of two json blocks", '```json\n{"status":"blocked"}\n```\nthen\n```json\n{"status":"done","criteria":["C1","C2"]}\n```', { status: "done", criteria: ["C1", "C2"] }],
    ["bare json after prose", 'All good.\n{"status": "blocked", "blocking_issue": "C2 open"}', { status: "blocked", blocking_issue: "C2 open" }],
    ["bare object followed by a trailing line", 'Findings below.\n{"status": "done", "findings": 2}\nLaser On!', { status: "done", findings: 2 }],
    ["proposed criteria given as objects", '{"status": "done", "proposed_criteria": [{"id": "C9", "text": "When x, y shall z"}, "When a, b shall c"]}', { status: "done", proposed_criteria: ['{"id":"C9","text":"When x, y shall z"}', "When a, b shall c"] }],
    ["key: value lines", "status: done\nblueprint_path: /b.md\nchanged_files: [src/a.js, test/a.test.js]\nblocking_issue: null", { status: "done", changed_files: ["src/a.js", "test/a.test.js"], blocking_issue: null }],
    ["no result at all", "", { status: "failed" }],
]) {
    test(`parseResult reads ${name}`, () => {
        const r = flow.parseResult(text);
        for (const [k, v] of Object.entries(expected)) assert.deepEqual(r[k], v, k);
    });
}

for (const [answer, expected] of [
    ["open: a) 10/s b) 100/s; recommend a", { options: ["10/s", "100/s"], recommend: "10/s" }],
    ["open: a) date only b) date and time, local c) date and time, UTC; recommend b", { options: ["date only", "date and time, local", "date and time, UTC"], recommend: "date and time, local" }],
    ["open: a) keep b) drop", { options: ["keep", "drop"], recommend: null }],
]) {
    test(`optionsOf ${JSON.stringify(answer)}`, () => assert.deepEqual(flow.optionsOf(answer), expected));
}

test("openDecisions prefers the worker's description and fills gaps from the blueprint", () => {
    const r = done({ status: "blocked", open_decisions: [{ id: "C2", question: "Max rate?", options: ["10/s", "100/s"], recommend: "10/s", confidence: "medium", reason: "existing limit" }] });
    const fromCheck = [{ id: "C2", question: "x", answer: "open: a) 1 b) 2" }, { id: "C3", question: "Window?", answer: "open: a) 1s b) 60s; recommend b" }];
    assert.deepEqual(flow.openDecisions(r, fromCheck), [
        { id: "C2", question: "Max rate?", options: ["10/s", "100/s"], recommend: "10/s", confidence: "medium", reason: "existing limit" },
        { id: "C3", question: "Window?", options: ["1s", "60s"], recommend: "60s", confidence: null, reason: null },
    ]);
});

test("an open bracket of the blueprint becomes a question with its options, and an empty answer takes the recommendation", () => {
    const blueprint = [
        "# Blueprint: sorting", "", "Repo: acme/todo | Created: 2026-10-22", "", "## Inputs", "", "- **I1** (2026-10-22 09:14):", "  > list sorted", "",
        "## Criteria", "", '- **C1** (I1 "list sorted"): When the user lists, the CLI shall sort the items. [open: a) earliest first b) latest first; recommend a]', "",
        "## Boundaries", "", "| ID | Owner | Contract | Change | Criteria |", "|----|-------|----------|--------|----------|", "| B1 | `cli.js` list | args → lines | changed | C1 |", "",
    ].join("\n");
    const [d] = flow.openDecisions(done({ status: "blocked" }), check(blueprint).open);
    assert.deepEqual(d, { id: "C1", question: "When the user lists, the CLI shall sort the items.", options: ["earliest first", "latest first"], recommend: "earliest first", confidence: null, reason: null });
    assert.equal(flow.answerMessage([d], {}), "Q: When the user lists, the CLI shall sort the items. A (default): earliest first");
});

const LOCAL = "Convert the timestamp to the machine's local calendar date.";
for (const [name, options, recommend] of [
    ["options keyed a) b) and a recommendation by key", ["a) Preserve the date written in the string.", `b) ${LOCAL}`], "b"],
    ["a recommendation keyed b)", ["a) Preserve the date written in the string.", `b) ${LOCAL}`], `b) ${LOCAL}`],
    ["plain options and a recommendation by text", ["Preserve the date written in the string.", LOCAL], LOCAL],
    ["a recommendation that shortens the option", ["Preserve the date written in the string.", LOCAL], "Convert the timestamp to the machine's local calendar date"],
]) {
    test(`openDecisions matches the recommendation: ${name}`, () => {
        const [d] = flow.openDecisions(done({ status: "blocked", open_decisions: [{ id: "C5", question: "Which date?", options, recommend }] }));
        assert.deepEqual(d.options, ["Preserve the date written in the string.", LOCAL]);
        assert.equal(d.recommend, LOCAL);
    });
}

const D = [{ id: "C2", question: "Max rate?", options: ["10/s", "100/s"], recommend: "10/s" }];
for (const [name, answers, expected] of [
    ["the recommendation unchanged is a default", { C2: { choice: "10/s" } }, "Q: Max rate? A (default): 10/s"],
    ["no answer at all takes the recommendation as a default", {}, "Q: Max rate? A (default): 10/s"],
    ["the other option is the user's choice", { C2: { choice: "100/s" } }, "Q: Max rate? A: 100/s"],
    ["own words win over the radio button", { C2: { choice: "10/s", text: "20/s per client" } }, "Q: Max rate? A: 20/s per client"],
]) {
    test(`answerMessage: ${name}`, () => assert.equal(flow.answerMessage(D, answers), expected));
}

/* ── transitions ── */

const at = (stage, extra = {}) => ({ ...base(), stage, ...extra });

for (const [name, state, phase, results, expected] of [
    ["blueprint done → replicate", base(), "blueprint", [done({ criteria: ["C1", "C2"] })],
        { status: "running", stage: { phase: "replicate", input: [] }, criteria: ["C1", "C2"], blueprint: "/hq/bp.md", rounds: 1, nodes: [{ file: "/hq/bp.md", parent: null, status: "building" }] }],
    ["blueprint with open decisions asks the user and keeps what it planned", base(), "blueprint", [done({ status: "blocked", blocking_issue: "C2", criteria: ["C1", "C2"], groups: [{ id: "G1" }], open_decisions: [{ id: "C2", question: "Max?", options: ["a", "b"], recommend: "a" }] })],
        { status: "asking", criteria: ["C1", "C2"], groups: [{ id: "G1" }], size: "full" }],
    ["the pass after an answer adds to the round instead of replacing it", at({ phase: "blueprint", message: "Q: Max? A: a", input: [] }, { criteria: ["C1", "C2"], groups: [{ id: "G1" }], size: "full" }), "blueprint", [done({ criteria: ["C2", "C3"], size: "small" })],
        { criteria: ["C1", "C2", "C3"], groups: [{ id: "G1" }], size: "full", stage: { phase: "replicate", input: [] } }],
    ["a small round stays small", at({ phase: "blueprint", message: "rename it", input: [] }, { size: "small" }), "blueprint", [done({ criteria: ["C4"], size: "small" })],
        { size: "small" }],
    ["a round that adds a boundary row turns full", at({ phase: "blueprint", message: "add export", input: [] }, { size: "small" }), "blueprint", [done({ criteria: ["C4"], size: "full" })],
        { size: "full" }],
    ["blueprint after a fix round goes to replicate with the findings file", at({ phase: "blueprint", message: null, input: [], fix: true }, { findingsFile: "/hq/bp.runs/inspect.md", rounds: 1 }), "blueprint", [done({ criteria: ["C3"] })],
        { stage: { phase: "replicate", input: ["Findings file: /hq/bp.runs/inspect.md"], fix: true } }],
    ["replicate goes to inspect and collects changed files", at({ phase: "replicate", input: [] }, { rounds: 1, changed: ["b.js"] }), "replicate", [done({ changed_files: ["a.js"] }), done({ changed_files: ["c.js", "a.js"] })],
        { stage: { phase: "inspect", input: [], recheck: [] }, changed: ["a.js", "b.js", "c.js"], groups: [] }],
    ["a feedback round rechecks only its criteria", at({ phase: "replicate", input: [] }, { rounds: 2, criteria: ["C4"] }), "replicate", [done()],
        { stage: { phase: "inspect", input: [], recheck: ["C4"] } }],
    ["a fix round rechecks everything", at({ phase: "replicate", input: [], fix: true }, { rounds: 2, criteria: ["C4"] }), "replicate", [done()],
        { stage: { phase: "inspect", input: [], recheck: [] } }],
    ["inspect findings go back to replicate with the findings file", at({ phase: "inspect", input: [] }), "inspect", [done({ findings: 2, findings_file: "/f.md" })],
        { findings: 2, stage: { phase: "replicate", input: ["Findings file: /f.md"], fix: true } }],
    ["proposed criteria go to blueprint first", at({ phase: "inspect", input: [] }), "inspect", [done({ findings: 1, findings_file: "/f.md", proposed_criteria: ["When x, y shall z (data: a.js:1)"] })],
        { stage: { phase: "blueprint", message: null, input: ["Proposed criteria from inspect, with evidence in /f.md:", "When x, y shall z (data: a.js:1)"], fix: true } }],
    ["a clean inspect goes to extract", at({ phase: "inspect", input: [] }), "inspect", [done({ findings: 0 })],
        { findings: 0, stage: { phase: "extract", input: [] } }],
    ["a clean inspect after a small change skips extract", at({ phase: "inspect", input: [] }, { size: "small" }), "inspect", [done({ findings: 0 })],
        { status: "done", stage: null, report: { skippedExtract: true } }],
    ["no fewer findings twice asks the user", at({ phase: "inspect", input: [] }, { findings: 2, stalls: 1 }), "inspect", [done({ findings: 2, findings_file: "/f.md" })],
        { status: "asking", stalls: 2, stallAsked: true }],
    ["no fewer findings after the stall answer ends the run", at({ phase: "inspect", input: [] }, { findings: 2, stalls: 2, stallAsked: true }), "inspect", [done({ findings: 2, findings_file: "/f.md" })],
        { status: "failed", stage: null, report: { phase: "inspect", blocking_issue: "2 findings after 3 rounds without progress: /f.md" } }],
    ["a replicate block goes back to blueprint with the issue", at({ phase: "replicate", input: [] }), "replicate", [{ ...done(), status: "blocked", blocking_issue: "Boundaries lacks a row for C2" }],
        { blocks: 1, stage: { phase: "blueprint", message: null, input: ["Replicate stopped; settle this in the blueprint: Boundaries lacks a row for C2"] } }],
    ["a block in a fix round keeps the round a fix round", at({ phase: "replicate", input: ["Findings file: /f.md"], fix: true }, { findingsFile: "/f.md" }), "replicate", [{ ...done(), status: "blocked", blocking_issue: "x" }],
        { blocks: 1, stage: { phase: "blueprint", message: null, input: ["Replicate stopped; settle this in the blueprint: x"], fix: true } }],
    ["blueprint done after a first-round block retries replicate with its criteria", at({ phase: "blueprint", message: null, input: ["Replicate stopped; settle this in the blueprint: x"] }, { criteria: ["C1"], blocks: 1 }), "blueprint", [done()],
        { stage: { phase: "replicate", input: [] }, blocks: 1 }],
    ["a second replicate block ends the run", at({ phase: "replicate", input: [] }, { blocks: 1 }), "replicate", [{ ...done(), status: "blocked", blocking_issue: "still no row for C2" }],
        { status: "failed", stage: null, report: { phase: "replicate", blocking_issue: "still no row for C2" } }],
    ["a replicate that finishes resets the block count", at({ phase: "replicate", input: [] }, { blocks: 1 }), "replicate", [done()],
        { blocks: 0, stage: { phase: "inspect", input: [], recheck: [] } }],
    ["fewer findings resets the stall count", at({ phase: "inspect", input: [] }, { findings: 3, stalls: 1, stallAsked: true }), "inspect", [done({ findings: 1, findings_file: "/f.md" })],
        { status: "running", stalls: 0, stallAsked: false }],
    ["extract ends the run", at({ phase: "extract", input: [] }), "extract", [done({ captured: ["rule a"] })],
        { status: "done", stage: null, report: { captured: ["rule a"], retired: [] } }],
    ["a failed worker fails the run", base(), "blueprint", [flow.parseResult("")],
        { status: "failed" }],
    ["waiting feedback goes to blueprint before inspect", at({ phase: "replicate", input: [] }, { pending: [{ text: "also B", at: 1 }, { text: "and C", at: 2 }] }), "replicate", [done()],
        { stage: { phase: "blueprint", message: "also B\n\nand C", input: [] }, pending: [] }],
]) {
    test(`advance: ${name}`, () => {
        const next = flow.advance(state, phase, results);
        for (const [k, v] of Object.entries(expected)) assert.deepEqual(next[k], v, k);
    });
}

for (const [name, status, expected] of [
    ["while workers run, feedback waits", "running", { status: "running", pending: [{ text: "rename it", at: 5 }] }],
    ["after the report, feedback starts a new small round", "done", { status: "running", pending: [], stage: { phase: "blueprint", message: "rename it", input: [] }, criteria: [], groups: [], size: "small" }],
    ["instead of an answer, feedback starts a blueprint round", "asking", { status: "running", ask: null, stage: { phase: "blueprint", message: "rename it", input: [] } }],
]) {
    test(`feedback: ${name}`, () => {
        const next = flow.feedback({ ...base(), status }, "rename it", 5);
        for (const [k, v] of Object.entries(expected)) assert.deepEqual(next[k], v, k);
    });
}

test("answer sends the Q/A pairs to blueprint", () => {
    const asking = { ...base(), status: "asking", ask: { decisions: D } };
    assert.deepEqual(flow.answer(asking, { C2: { choice: "100/s" } }).stage, { phase: "blueprint", message: "Q: Max rate? A: 100/s", input: [] });
    assert.deepEqual(flow.answer({ ...base(), status: "asking", ask: { decisions: [], issue: "x" } }, { text: "skip it" }).stage.message, "skip it");
    assert.deepEqual(flow.answer({ ...base(), status: "asking", findings: 2, ask: { decisions: [], issue: "2 findings after 2 rounds" } }, { text: "skip it" }).stage,
        { phase: "blueprint", message: "skip it", input: ["Open issue: 2 findings after 2 rounds"], fix: true });
    assert.deepEqual(flow.answer({ ...base(), status: "asking", findings: 2, ask: { decisions: D, issue: null } }, { C2: { choice: "100/s" } }).stage,
        { phase: "blueprint", message: "Q: Max rate? A: 100/s", input: [], fix: true });
});

test("answer: a blueprint ask keeps the node", () => {
    const open = { ...base(), status: "asking", stage: replicateStopped, ask: { decisions: D } };
    assert.deepEqual(flow.answer(open, { C2: { choice: "100/s" } }).stage, { phase: "blueprint", message: "Q: Max rate? A: 100/s", input: [], node: ROOT });
});

for (const [name, status, expected] of [
    ["after the report, a correction goes to extract alone", "done", { status: "running", stage: { phase: "extract", input: ["Correction after the report:", "The maintainer's fix is at raw/x.diff", "CI: 2 tests failing, see raw/x-ci.md"] } }],
    ["after a failed run too", "failed", { status: "running" }],
    ["while workers run, a correction is ignored", "running", { status: "running", stage: { phase: "blueprint", message: "fix the export", input: [] } }],
]) {
    test(`learn: ${name}`, () => {
        const next = flow.learn({ ...base(), status }, "The maintainer's fix is at raw/x.diff\nCI: 2 tests failing, see raw/x-ci.md");
        for (const [k, v] of Object.entries(expected)) assert.deepEqual(next[k], v, k);
    });
}

test("feedback after a failed run starts the bounds afresh", () => {
    const next = flow.feedback({ ...base(), status: "failed", blocks: 1, stallAsked: true }, "try again", 5);
    assert.deepEqual([next.blocks, next.stallAsked, next.status], [0, false, "running"]);
});

/* ── the blueprint tree ── */

const ROOT = "/hq/bp.md";
const A = "/hq/bp.a.md";
const B = "/hq/bp.b.md";
const node = (file, status, extra = {}) => ({ file, parent: file === ROOT ? null : ROOT, status, ...extra });
const tree = (...statuses) => [ROOT, A, B].map((file, i) => node(file, statuses[i]));
const inspecting = (file) => ({ phase: "inspect", input: [], recheck: [], node: file });
const facts = (own = { boundaries: ["B1"], criteria: ["C1"] }) => ({
    [ROOT]: { children: [A, B], criteria: ["C1", "C2", "C3", "C4"], own },
    [A]: { children: [], criteria: ["C2", "C3"], own: { boundaries: ["B1"], criteria: ["C2", "C3"] } },
    [B]: { children: [], criteria: ["C4"], own: { boundaries: ["B1"], criteria: ["C4"] } },
});
const replicateStopped = { phase: "blueprint", message: null, input: ["Replicate stopped; settle this in the blueprint: x"], node: ROOT };

// A blueprint that is done is built at once: its nodes go from drafting straight to building, with no review in between.
for (const [name, state, result, expected, withFacts = {}] of [
    ["a pass that names children builds the children first, the root after them", at({ phase: "blueprint", message: "t", input: [] }), done(),
        { stage: { phase: "replicate", input: [] }, nodes: tree("building", "building", "building") }, facts()],
    ["feedback after a finished tree builds every blueprint again", at({ phase: "blueprint", message: "also B", input: [] }, { nodes: tree("done", "done", "done") }), done(),
        { stage: { phase: "replicate", input: [] }, nodes: tree("building", "building", "building") }, facts()],
    ["a small feedback round lets a child without a criterion of the round sit out", at({ phase: "blueprint", message: "fix C4", input: [] }, { nodes: tree("done", "done", "done"), size: "small", criteria: [] }), done({ criteria: ["C4"], size: "small" }),
        { stage: { phase: "replicate", input: [] }, nodes: tree("building", "done", "building") }, facts()],
    ["feedback waiting during the pass goes to blueprint first", at({ phase: "blueprint", message: "t", input: [] }, { pending: [{ text: "also B", at: 1 }] }), done(),
        { stage: { phase: "blueprint", message: "also B", input: [] }, pending: [] }],
]) {
    test(`advance: build at once: ${name}`, () => {
        const next = flow.advance({ ...state, blueprint: ROOT }, "blueprint", [result], { facts: withFacts });
        for (const [k, v] of Object.entries(expected)) assert.deepEqual(next[k], v, k);
    });
}

const block = (extra) => ({ ...done({ changed_files: [] }), status: "blocked", blocking_issue: "x", ...extra });

for (const [name, state, phase, results, expected] of [
    ["each child's result goes to its node, and the first child is inspected", at({ phase: "replicate", input: [] }, { nodes: tree("building", "building", "building"), rounds: 1 }), "replicate",
        [{ ...done({ changed_files: ["src/a.js"] }), node: A }, { ...done({ changed_files: ["src/b.js", "test/b.test.js"] }), node: B }],
        { stage: inspecting(A), changed: ["src/a.js", "src/b.js", "test/b.test.js"], nodes: [node(ROOT, "building"), node(A, "inspecting", { changed: ["src/a.js"] }), node(B, "inspecting", { changed: ["src/b.js", "test/b.test.js"] })] }],
    ["a clean child goes to its own extract", at(inspecting(A), { nodes: tree("building", "inspecting", "inspecting") }), "inspect", [done({ findings: 0 })],
        { stage: { phase: "extract", input: [], node: A }, findings: 0 }],
    ["findings in a child go to a fix round on that child", at(inspecting(A), { nodes: tree("building", "inspecting", "inspecting") }), "inspect", [done({ findings: 2, findings_file: "/hq/bp.a.runs/inspect.md" })],
        { stage: { phase: "replicate", input: ["Findings file: /hq/bp.a.runs/inspect.md"], fix: true, node: A } }],
    ["the fix round's replicate goes back to that child's inspect", at({ phase: "replicate", input: [], fix: true, node: A }, { nodes: tree("building", "inspecting", "inspecting"), rounds: 1 }), "replicate", [{ ...done({ changed_files: ["src/a.js"] }), node: A }],
        { stage: inspecting(A) }],
    ["a child's extract moves on to the next child with fresh bounds", at({ phase: "extract", input: [], node: A }, { nodes: tree("building", "inspecting", "inspecting"), findings: 0, stalls: 1, blocks: 1, findingsFile: "/hq/bp.a.runs/inspect.md" }), "extract", [done({ captured: ["rule a"] })],
        { stage: inspecting(B), nodes: tree("building", "done", "inspecting"), findings: null, stalls: 0, blocks: 0, findingsFile: null, status: "running" }],
    ["the last child's extract hands over to the root's replicate", at({ phase: "extract", input: [], node: B }, { nodes: tree("building", "done", "inspecting") }), "extract", [done()],
        { stage: { phase: "replicate", input: [] }, nodes: tree("building", "done", "done") }],
    ["a root that delegated everything skips its replicate and goes to inspect", at({ phase: "replicate", input: [] }, { nodes: tree("building", "done", "done"), changed: ["src/a.js"], rounds: 1 }), "replicate", [],
        { stage: inspecting(ROOT), nodes: tree("inspecting", "done", "done") }],
    ["a clean root goes to its own extract", at(inspecting(ROOT), { nodes: tree("inspecting", "done", "done") }), "inspect", [done({ findings: 0 })],
        { stage: { phase: "extract", input: [], node: ROOT } }],
    ["the root's extract ends the run with the lessons of every node", at({ phase: "extract", input: [], node: ROOT }, { nodes: tree("inspecting", "done", "done"), report: { captured: ["rule a", "rule b"], retired: ["old"] } }), "extract", [done({ captured: ["rule r"] })],
        { status: "done", stage: null, nodes: tree("done", "done", "done"), report: { captured: ["rule a", "rule b", "rule r"], retired: ["old"] } }],
    ["a small round skips the extract of each node and ends the run at the root", at(inspecting(ROOT), { nodes: tree("inspecting", "done", "done"), size: "small" }), "inspect", [done({ findings: 0 })],
        { status: "done", stage: null, report: { skippedExtract: true } }],
    ["a blocked child goes back to blueprint on its file while the others move on", at({ phase: "replicate", input: [] }, { nodes: tree("building", "building", "building") }), "replicate", [{ ...block({ blocking_issue: "no row for C2" }), node: A }, { ...done({ changed_files: ["src/b.js"] }), node: B }],
        { blocks: 1, nodes: [node(ROOT, "building"), node(A, "building"), node(B, "inspecting", { changed: ["src/b.js"] })], stage: { phase: "blueprint", message: null, input: ["Replicate stopped; settle this in the blueprint: no row for C2"], node: A } }],
    ["the blueprint pass after that block builds the blocked child again", at({ phase: "blueprint", message: null, input: ["Replicate stopped; settle this in the blueprint: x"], node: A }, { nodes: tree("building", "building", "inspecting"), blocks: 1 }), "blueprint", [done()],
        { stage: { phase: "replicate", input: [] }, blocks: 1, blueprint: "/hq/bp.md" }],
]) {
    test(`advance: tree: ${name}`, () => {
        const next = flow.advance({ ...state, blueprint: ROOT }, phase, results);
        for (const [k, v] of Object.entries(expected)) assert.deepEqual(next[k], v, k);
    });
}

test("a tree is walked to the end: children first, the root last", () => {
    const run = (state, steps) => steps.reduce((s, [phase, results, withFacts]) => flow.advance(s, phase, results, { facts: withFacts ?? {} }), state);
    const end = run(at({ phase: "blueprint", message: "t", input: [] }), [
        ["blueprint", [done({ criteria: ["C1", "C2", "C3", "C4"] })], facts()],
        ["replicate", [{ ...done({ changed_files: ["src/a.js"] }), node: A }, { ...done({ changed_files: ["src/b.js"] }), node: B }]],
        ["inspect", [done({ findings: 0 })]],
        ["extract", [done({ captured: ["a"] })]],
        ["inspect", [done({ findings: 0 })]],
        ["extract", [done({ captured: ["b"] })]],
        ["replicate", [{ ...done({ changed_files: ["src/root.js"] }), node: ROOT }]],
        ["inspect", [done({ findings: 0 })]],
        ["extract", [done({ captured: ["r"] })]],
    ]);
    assert.deepEqual([end.status, end.stage, end.nodes.map((n) => n.status), end.report.captured, end.changed], ["done", null, ["done", "done", "done"], ["a", "b", "r"], ["src/a.js", "src/b.js", "src/root.js"]]);
});

/* ── existing tests ── */

const INSPECT_FILE = "/hq/bp.runs/inspect.md";
const clean = done({ findings: 0, findings_file: INSPECT_FILE });
const CUT = { testLinesRemoved: 23, testFiles: ["test/a.test.js", "test/b.test.js"] };
const T1_QUESTION = "23 lines of existing tests were removed or rewritten by the change (test/a.test.js, test/b.test.js). Keep them and change the code until they pass, or confirm the removal?";
const T1_ISSUE = `Existing test lines were removed or rewritten: ${INSPECT_FILE}`;
const T1_ASK = { decisions: [{ id: "T1", question: T1_QUESTION, options: ["keep", "remove"], recommend: "keep", confidence: null, reason: null }], issue: T1_ISSUE, fix: true };
const inspectStage = { phase: "inspect", input: [], recheck: [] };

for (const [name, state, phase, results, options, expected] of [
    ["no removed lines: no ask", at(inspectStage), "inspect", [clean], { testLinesRemoved: 0 },
        { status: "running", ask: null, testsDecided: false, stage: { phase: "extract", input: [] } }],
    ["no count passed: no ask", at(inspectStage), "inspect", [clean], undefined,
        { status: "running", ask: null, stage: { phase: "extract", input: [] } }],
    ["removed lines in a clean inspect ask first, recommending keep, and the gate stays armed until an answer", at(inspectStage), "inspect", [clean], CUT,
        { status: "asking", ask: T1_ASK, testsDecided: false, testFiles: CUT.testFiles, findingsFile: INSPECT_FILE, stage: inspectStage }],
    ["the ask starts the next inspect's findings count afresh", at(inspectStage, { findings: 2, stalls: 1 }), "inspect", [clean], CUT,
        { status: "asking", findings: null }],
    ["one removed line is asked in the singular", at(inspectStage), "inspect", [clean], { testLinesRemoved: 1, testFiles: ["test/a.test.js"] },
        { status: "asking", ask: { ...T1_ASK, decisions: [{ ...T1_ASK.decisions[0], question: "1 line of existing tests was removed or rewritten by the change (test/a.test.js). Keep them and change the code until they pass, or confirm the removal?" }] } }],
    ["removed lines without file names still ask", at(inspectStage), "inspect", [clean], { testLinesRemoved: 2 },
        { status: "asking", ask: { ...T1_ASK, decisions: [{ ...T1_ASK.decisions[0], question: "2 lines of existing tests were removed or rewritten by the change. Keep them and change the code until they pass, or confirm the removal?" }] } }],
    ["a small change asks before it skips extract", at(inspectStage, { size: "small" }), "inspect", [clean], CUT,
        { status: "asking", ask: T1_ASK }],
    ["a node of a tree asks on its own file and keeps its place", at(inspecting(A), { nodes: tree("building", "inspecting", "inspecting") }), "inspect", [clean], CUT,
        { status: "asking", ask: T1_ASK, stage: inspecting(A) }],
    ["removed lines already decided: no ask, the flow goes on", at(inspectStage, { testsDecided: true }), "inspect", [clean], CUT,
        { status: "running", ask: null, stage: { phase: "extract", input: [] } }],
    ["removed lines already decided after a small change: the run ends", at(inspectStage, { testsDecided: true, size: "small" }), "inspect", [clean], CUT,
        { status: "done", stage: null, report: { skippedExtract: true } }],
    ["removed lines with findings: the fix round first, no ask", at(inspectStage), "inspect", [done({ findings: 2, findings_file: INSPECT_FILE })], CUT,
        { status: "running", ask: null, testsDecided: false, stage: { phase: "replicate", input: [`Findings file: ${INSPECT_FILE}`], fix: true } }],
    ["removed lines with proposed criteria: blueprint first, no ask", at(inspectStage), "inspect", [done({ findings: 0, findings_file: INSPECT_FILE, proposed_criteria: ["When x, y shall z (data: a.js:1)"] })], CUT,
        { status: "running", ask: null, testsDecided: false, stage: { phase: "blueprint", message: null, input: [`Proposed criteria from inspect, with evidence in ${INSPECT_FILE}:`, "When x, y shall z (data: a.js:1)"], fix: true } }],
    ["the next node asks afresh", at({ phase: "extract", input: [], node: A }, { nodes: tree("building", "inspecting", "inspecting"), testsDecided: true }), "extract", [done()], CUT,
        { testsDecided: false, stage: inspecting(B) }],
]) {
    test(`advance: existing tests: ${name}`, () => {
        const next = flow.advance({ ...state, blueprint: ROOT }, phase, results, options);
        for (const [k, v] of Object.entries(expected)) assert.deepEqual(next[k], v, k);
    });
}

const T1_ANSWER = (answer) => `Q: ${T1_QUESTION} A${answer === "keep" ? " (default)" : ""}: ${answer}`;
const fixBlueprintFor = (message, extra = {}) => ({ phase: "blueprint", message, input: [`Open issue: ${T1_ISSUE}`], fix: true, ...extra });
const asked = (state = at(inspectStage)) => flow.advance(state, "inspect", [clean], CUT);

for (const [name, state, answers, expected, testsAnswer] of [
    ["an empty answer takes the recommendation", at(inspectStage), {}, fixBlueprintFor(T1_ANSWER("keep")), "keep"],
    ["keep chosen as recommended stays a default", at(inspectStage), { T1: { choice: "keep" } }, fixBlueprintFor(T1_ANSWER("keep")), "keep"],
    ["remove is the user's own choice", at(inspectStage), { T1: { choice: "remove" } }, fixBlueprintFor(T1_ANSWER("remove")), "remove"],
    ["own words win over the radio button", at(inspectStage), { T1: { choice: "keep", text: "remove only test/b.test.js" } }, fixBlueprintFor(`Q: ${T1_QUESTION} A: remove only test/b.test.js`), "remove only test/b.test.js"],
    ["in a tree the fix round stays on that node", at(inspecting(A), { nodes: tree("building", "inspecting", "inspecting") }), {}, fixBlueprintFor(T1_ANSWER("keep"), { node: A }), "keep"],
]) {
    test(`answer: removed test lines: ${name}`, () => {
        const asking = asked(state);
        assert.equal(asking.status, "asking");
        const next = flow.answer(asking, answers);
        assert.deepEqual(next.stage, expected);
        assert.deepEqual([next.testsDecided, next.testsAnswer], [true, testsAnswer]);
    });
}

test("feedback that replaces the test question leaves the gate armed, so the next clean inspect asks again", () => {
    const fed = flow.feedback(asked(), "also B", 5);
    assert.deepEqual([fed.status, fed.ask, fed.testsDecided], ["running", null, false]);
    assert.equal(flow.advance({ ...fed, stage: inspectStage }, "inspect", [clean], CUT).status, "asking");
});

const KEEP_LINE = "The user keeps the existing tests: restore every removed or rewritten line in test/a.test.js, test/b.test.js and change the code until they pass.";

for (const [name, answers, line] of [
    ["keep restores every removed line", {}, KEEP_LINE],
    ["remove is confirmed", { T1: { choice: "remove" } }, "The user confirmed removing the existing test lines."],
    ["own words are passed on as they are", { T1: { text: "remove only test/b.test.js" } }, "The user answered the question about the existing tests: remove only test/b.test.js"],
]) {
    test(`the replicate fix round after the test question: ${name}`, () => {
        const next = flow.advance(flow.answer(asked(), answers), "blueprint", [done()]);
        assert.deepEqual(next.stage, { phase: "replicate", input: [`Findings file: ${INSPECT_FILE}`, line], fix: true });
        assert.equal(next.testsAnswer, null);
    });
}

test("a blueprint pass that stops during the test round asks with a fix round, and the answer still ends in the replicate fix round", () => {
    const stopped = flow.advance(flow.answer(asked(), {}), "blueprint", [done({ status: "blocked", blocking_issue: "C2 open", open_decisions: [{ id: "C2", question: "Which?", options: ["a", "b"], recommend: "a" }] })]);
    assert.deepEqual([stopped.status, stopped.ask.fix, stopped.testsAnswer], ["asking", true, "keep"]);
    const answered = flow.answer(stopped, { C2: { choice: "b" } });
    assert.equal(answered.stage.fix, true);
    assert.deepEqual(flow.advance(answered, "blueprint", [done()]).stage.input, [`Findings file: ${INSPECT_FILE}`, KEEP_LINE]);
});

test("a blueprint pass that stops outside the test round keeps asking without a fix round", () => {
    const stopped = flow.advance(at({ phase: "blueprint", message: "x", input: [] }), "blueprint", [done({ status: "blocked", blocking_issue: "C2 open", open_decisions: [{ id: "C2", question: "Which?", options: ["a", "b"], recommend: "a" }] })]);
    assert.equal(stopped.ask.fix, undefined);
});

test("an answered removal is applied in a fix round, inspected again and not asked twice", () => {
    const steps = [["blueprint", [done()]], ["replicate", [done({ changed_files: ["test/a.test.js"] })]], ["inspect", [clean]]];
    let run = flow.answer(asked(), {});
    const phases = [run.stage.phase];
    for (const [phase, results] of steps) {
        run = flow.advance(run, phase, results, CUT);
        phases.push(run.stage?.phase ?? run.status);
    }
    assert.deepEqual(phases, ["blueprint", "replicate", "inspect", "extract"]);
    assert.deepEqual([run.status, run.ask, run.testsDecided], ["running", null, true]);
});

/* ── jobs and prompts ── */

const G = (id, wave, parallel, boundaries, criteria) => ({ id, wave, parallel, boundaries, criteria });

for (const [name, groups, expected] of [
    ["one parallel wave", [G("G1", 1, true, ["B1"], ["C1"]), G("G2", 1, true, ["B2"], ["C2"])], [{ parallel: true, groups: ["G1", "G2"] }]],
    ["a serial wave and a later one", [G("G3", 2, true, ["B3"], ["C3"]), G("G1", 1, false, ["B1"], ["C1"]), G("G2", 1, false, ["B2"], ["C2"])], [{ parallel: false, groups: ["G1", "G2"] }, { parallel: true, groups: ["G3"] }]],
]) {
    test(`waves: ${name}`, () => {
        const w = flow.waves({ ...base(), stage: { phase: "replicate", input: [] }, groups });
        assert.deepEqual(w.map((x) => ({ parallel: x.parallel, groups: x.jobs.map((j) => j.group) })), expected);
    });
}

test("waves takes a group's criteria from its boundary rows in the current blueprint", () => {
    const state = { ...base(), stage: { phase: "replicate", input: [] }, criteria: ["C1", "C3", "C5", "C6"], groups: [G("G3", 1, true, ["B3"], ["C3"]), G("G4", 1, true, ["B4"], ["C6"])] };
    const [wave] = flow.waves(state, { boundaryCriteria: { B3: ["C3", "C5"], B4: ["C6"] } });
    assert.match(wave.jobs[0].input[0], /boundaries B3; criteria C3, C5\./);
    assert.match(wave.jobs[1].input[0], /boundaries B4; criteria C6\./);
});

test("a small round's groups keep only that round's criteria and drop the ones left empty", () => {
    const state = { ...base(), stage: { phase: "replicate", input: [] }, criteria: ["C7"], groups: [G("G1", 1, true, ["B1"], ["C1", "C7"]), G("G2", 1, true, ["B2"], ["C2", "C3"])] };
    assert.deepEqual(flow.waves(state), [{ parallel: false, jobs: [{ phase: "replicate", input: ["Criterion IDs: C7"], message: null }] }]);
});

test("one group with every boundary is one ordinary replicate job", () => {
    const state = { ...base(), stage: { phase: "replicate", input: [] }, criteria: ["C7"], groups: [G("G1", 1, false, ["B1", "B2", "B3", "B4"], ["C1", "C2", "C7"])] };
    assert.deepEqual(flow.waves(state), [{ parallel: false, jobs: [{ phase: "replicate", input: ["Criterion IDs: C7"], message: null }] }]);
});

test("waves gives a fix round one replicate job even when groups exist", () => {
    const w = flow.waves({ ...base(), stage: { phase: "replicate", input: ["Findings file: /f.md"], fix: true }, groups: [G("G1", 1, true, ["B1"], ["C1"])] });
    assert.deepEqual(w, [{ parallel: false, jobs: [{ phase: "replicate", input: ["Findings file: /f.md"], message: null }] }]);
});

const replicating = { phase: "replicate", input: [] };
const buildJob = (file, ...input) => ({ phase: "replicate", node: file, input });

for (const [name, state, withFacts, expected] of [
    ["an inspect is always of the code: the changed files, never a request to review the text", { ...base(), stage: inspectStage, nodes: [node(ROOT, "inspecting")], changed: ["a.js"] }, {},
        [{ parallel: false, jobs: [{ phase: "inspect", input: ["Changed files: a.js"], message: null }] }]],
    ["a blueprint pass after a replicate block names its file", { ...base(), stage: replicateStopped, nodes: tree("building", "building", "building") }, {},
        [{ parallel: false, jobs: [{ phase: "blueprint", input: replicateStopped.input, message: null, node: ROOT }] }]],
    ["children build one after another", { ...base(), stage: replicating, nodes: tree("building", "building", "building") }, facts(),
        [{ parallel: false, jobs: [buildJob(A, "Criterion IDs: C2, C3"), buildJob(B, "Criterion IDs: C4")] }]],
    ["the root builds its own rows once the children are done", { ...base(), stage: replicating, nodes: tree("building", "done", "done") }, facts(),
        [{ parallel: false, jobs: [buildJob(ROOT, "Criterion IDs: C1", "Boundary rows: B1")] }]],
    ["a root that delegated everything has nothing to build", { ...base(), stage: replicating, nodes: tree("building", "done", "done") }, facts({ boundaries: [], criteria: [] }), []],
    ["a small round builds the criteria of the round only", { ...base(), stage: replicating, size: "small", criteria: ["C3"], nodes: tree("building", "building", "done") }, facts(),
        [{ parallel: false, jobs: [buildJob(A, "Criterion IDs: C3")] }]],
    ["a child is inspected on the files its replicate changed", { ...base(), stage: inspecting(A), changed: ["src/a.js", "src/b.js"], nodes: [node(ROOT, "building"), node(A, "inspecting", { changed: ["src/a.js"] }), node(B, "inspecting")] }, {},
        [{ parallel: false, jobs: [{ phase: "inspect", input: ["Changed files: src/a.js"], message: null, node: A }] }]],
    ["the root is inspected on all changed files", { ...base(), stage: inspecting(ROOT), changed: ["src/a.js", "src/b.js"], nodes: tree("inspecting", "done", "done") }, {},
        [{ parallel: false, jobs: [{ phase: "inspect", input: ["Changed files: src/a.js, src/b.js"], message: null, node: ROOT }] }]],
    ["a fix round in a tree builds the findings of one node", { ...base(), stage: { phase: "replicate", input: ["Findings file: /f.md"], fix: true, node: A }, nodes: tree("building", "inspecting", "inspecting") }, {},
        [{ parallel: false, jobs: [{ phase: "replicate", input: ["Findings file: /f.md"], message: null, node: A }] }]],
    ["a child's extract names the child", { ...base(), stage: { phase: "extract", input: [], node: A }, nodes: tree("building", "inspecting", "done") }, {},
        [{ parallel: false, jobs: [{ phase: "extract", input: [], message: null, node: A }] }]],
]) {
    test(`waves: ${name}`, () => assert.deepEqual(flow.waves(state, { facts: withFacts }), expected));
}

const template = flow.templateFrom(ORCHESTRATION);

test("the dispatch template comes from ORCHESTRATION.md", () => {
    assert.match(template, /^Use the minime <phase> skill\./);
    assert.match(template, /status \(done \| blocked \| failed\)/);
    assert.match(template, /^<phase input: criterion IDs, boundary IDs, the findings file or the changed files>$/m);
    assert.doesNotMatch(template, /Blueprint only/);
});

test("the dispatch template asks for the JSON object and nothing else", () => {
    assert.deepEqual(template.split("\n").slice(-2), [
        "Reply with one JSON object in a json code block and nothing else: status (done | blocked | failed), blueprint_path, changed_files[], blocking_issue, evidence_excerpts[], and the fields the skill's Return section adds.",
        "Open decisions go in blocking_issue with status blocked. evidence_excerpts are the commands you ran with their pass and fail counts.",
    ]);
});

for (const [name, job, state, has, lacks] of [
    ["blueprint carries the user's words", { phase: "blueprint", input: [], message: "fix the export" }, base(),
        ["Use the minime blueprint skill.", "Blueprint: new", "Repo: /r", "User message:\nfix the export\nEnd of user message.", "Reply with one JSON object in a json code block and nothing else"], ["<phase input", "End your reply"]],
    ["replicate carries its IDs and no user message", { phase: "replicate", input: ["Criterion IDs: C1, C2"], message: null }, { ...base(), blueprint: "/hq/bp.md" },
        ["Use the minime replicate skill.", "Blueprint: /hq/bp.md", "Criterion IDs: C1, C2"], ["User message:", "End of user message.", "<the user's text"]],
    ["inspect names the blueprint and the changed files", { phase: "inspect", input: ["Changed files: a.js"], message: null, node: ROOT }, { ...base(), blueprint: ROOT },
        ["Use the minime inspect skill.", `Blueprint: ${ROOT}`, "Repo: /r", "Changed files: a.js"], ["Blueprint only", "User message:"]],
    ["the blueprint pass after a replicate block carries the issue, no user message", { phase: "blueprint", input: replicateStopped.input, message: null, node: ROOT }, { ...base(), blueprint: ROOT },
        ["Use the minime blueprint skill.", `Blueprint: ${ROOT}`, "Replicate stopped; settle this in the blueprint: x"], ["User message:", "End of user message."]],
    ["a child's replicate names the child's file and criteria", buildJob(A, "Criterion IDs: C2, C3"), { ...base(), blueprint: ROOT },
        ["Use the minime replicate skill.", `Blueprint: ${A}`, "Criterion IDs: C2, C3"], [`Blueprint: ${ROOT}`]],
    ["a child's extract names the child's file", { phase: "extract", input: [], message: null, node: A }, { ...base(), blueprint: ROOT },
        ["Use the minime extract skill.", `Blueprint: ${A}`, "Repo: /r"], [`Blueprint: ${ROOT}`, "Criterion IDs"]],
]) {
    test(`promptFor: ${name}`, () => {
        const p = flow.promptFor(template, job, state);
        for (const s of has) assert.ok(p.includes(s), `missing ${JSON.stringify(s)} in\n${p}`);
        for (const s of lacks) assert.ok(!p.includes(s), `unexpected ${JSON.stringify(s)} in\n${p}`);
    });
}

test("inspect is dispatched to Frau, the other phases to the default agent", () => {
    assert.deepEqual(flow.PHASES.map(flow.agentFor), [null, null, "minime:frau", null]);
});

/* ── board ── */

for (const [name, text, expected] of [
    ["findings that name criteria", "# Inspect\n\n## Findings\n\n- C2: test asserts 3 rows, criterion says 4\n- C5 deviates\n\n## Inputs run\n- C9 fine\n", ["C2", "C5"]],
    ["no findings", "## Findings\n\nNone.\n\n## Inputs run\n- C1 ok\n", []],
    ["no file", "", []],
]) {
    test(`criteriaWithFindings: ${name}`, () => assert.deepEqual(flow.criteriaWithFindings(text), expected));
}

test("scores add up the board and the finished jobs", () => {
    const state = { ...base(), rounds: 2, jobs: [{ started: 0, ended: 90_000, usage: { premiumRequests: 3 } }, { started: 0, ended: null }] };
    const board = { criteria: [{ tests: ["t.js"], finding: false }, { tests: ["t.js"], finding: true }, { tests: [], finding: false }], diff: { added: 10, removed: 14, duplicates: [{}] }, check: { sources: { surprise: 1, default: 2 } } };
    assert.deepEqual(flow.scores(state, board), { proven: 1, criteria: 3, netLines: -4, copiedBlocks: 1, surprises: 1, defaults: 2, rounds: 2, requests: 3, minutes: 1.5 });
});
