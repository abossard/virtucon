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
        { status: "running", stage: { phase: "replicate", input: [] }, criteria: ["C1", "C2"], blueprint: "/hq/bp.md", rounds: 1 }],
    ["blueprint with open decisions asks the user and keeps what it planned", base(), "blueprint", [done({ status: "blocked", blocking_issue: "C2", criteria: ["C1", "C2"], open_decisions: [{ id: "C2", question: "Max?", options: ["a", "b"], recommend: "a" }] })],
        { status: "asking", criteria: ["C1", "C2"] }],
    ["the pass after an answer adds to the round instead of replacing it", at({ phase: "blueprint", message: "Q: Max? A: a", input: [] }, { criteria: ["C1", "C2"] }), "blueprint", [done({ criteria: ["C2", "C3"] })],
        { criteria: ["C1", "C2", "C3"], stage: { phase: "replicate", input: [] } }],
    ["a blueprint pass after a replicate block goes straight back to one replicate job", at({ phase: "blueprint", message: null, input: ["Replicate stopped; settle this in the blueprint: x"] }, { blocks: 1, criteria: ["C1"] }), "blueprint", [done({ criteria: ["C1"] })],
        { stage: { phase: "replicate", input: [] }, blocks: 1 }],
    ["blueprint after a fix round goes to replicate with the findings file", at({ phase: "blueprint", message: null, input: [], fix: true }, { findingsFile: "/hq/bp.runs/inspect.md", rounds: 1 }), "blueprint", [done({ criteria: ["C3"] })],
        { stage: { phase: "replicate", input: ["Findings file: /hq/bp.runs/inspect.md"], fix: true } }],
    ["replicate goes to inspect and collects changed files", at({ phase: "replicate", input: [] }, { rounds: 1, changed: ["b.js"] }), "replicate", [done({ changed_files: ["a.js"] }), done({ changed_files: ["c.js", "a.js"] })],
        { stage: { phase: "inspect", input: [], recheck: [] }, changed: ["a.js", "b.js", "c.js"], blocks: 0 }],
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
    ["after the report, feedback starts a new round", "done", { status: "running", pending: [], stage: { phase: "blueprint", message: "rename it", input: [] }, criteria: [], blocks: 0 }],
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

const ROOT = "/hq/bp.md";
const replicateStopped = { phase: "blueprint", message: null, input: ["Replicate stopped; settle this in the blueprint: x"] };

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
    ["removed lines already decided: no ask, the flow goes on", at(inspectStage, { testsDecided: true }), "inspect", [clean], CUT,
        { status: "running", ask: null, stage: { phase: "extract", input: [] } }],
    ["removed lines with findings: the fix round first, no ask", at(inspectStage), "inspect", [done({ findings: 2, findings_file: INSPECT_FILE })], CUT,
        { status: "running", ask: null, testsDecided: false, stage: { phase: "replicate", input: [`Findings file: ${INSPECT_FILE}`], fix: true } }],
    ["removed lines with proposed criteria: blueprint first, no ask", at(inspectStage), "inspect", [done({ findings: 0, findings_file: INSPECT_FILE, proposed_criteria: ["When x, y shall z (data: a.js:1)"] })], CUT,
        { status: "running", ask: null, testsDecided: false, stage: { phase: "blueprint", message: null, input: [`Proposed criteria from inspect, with evidence in ${INSPECT_FILE}:`, "When x, y shall z (data: a.js:1)"], fix: true } }],
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

const KEEP_LINE = "The user keeps the existing tests: put back every removed or rewritten line in test/a.test.js, test/b.test.js by hand (no git restore: those files hold your new tests) and change the code until they pass.";

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

const replicating = { phase: "replicate", input: [] };

for (const [name, state, expected] of [
    ["an inspect is always of the code: the changed files, never a request to review the text", { ...base(), stage: inspectStage, changed: ["a.js"] },
        [{ parallel: false, jobs: [{ phase: "inspect", input: ["Changed files: a.js"], message: null }] }]],
    ["a blueprint pass after a replicate block carries the issue", { ...base(), stage: replicateStopped },
        [{ parallel: false, jobs: [{ phase: "blueprint", input: replicateStopped.input, message: null }] }]],
    ["one replicate job builds the whole blueprint with the round's criteria", { ...base(), stage: replicating, criteria: ["C1", "C2"] },
        [{ parallel: false, jobs: [{ phase: "replicate", input: ["Criterion IDs: C1, C2"], message: null }] }]],
    ["a fix round carries the findings file and no criterion list", { ...base(), stage: { phase: "replicate", input: ["Findings file: /f.md"], fix: true }, criteria: ["C1"] },
        [{ parallel: false, jobs: [{ phase: "replicate", input: ["Findings file: /f.md"], message: null }] }]],
    ["an inspect after a feedback round names the criteria to recheck and the baseline", { ...base(), stage: { phase: "inspect", input: [], recheck: ["C4"] }, changed: ["a.js"], baseline: "ran: npm test on HEAD abc → 3 passed" },
        [{ parallel: false, jobs: [{ phase: "inspect", input: ["Changed files: a.js", "Criterion IDs to recheck: C4", "Baseline: ran: npm test on HEAD abc → 3 passed"], message: null }] }]],
]) {
    test(`waves: ${name}`, () => assert.deepEqual(flow.waves(state), expected));
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
    ["inspect names the blueprint and the changed files", { phase: "inspect", input: ["Changed files: a.js"], message: null }, { ...base(), blueprint: ROOT },
        ["Use the minime inspect skill.", `Blueprint: ${ROOT}`, "Repo: /r", "Changed files: a.js"], ["Blueprint only", "User message:"]],
    ["the blueprint pass after a replicate block carries the issue, no user message", { phase: "blueprint", input: replicateStopped.input, message: null }, { ...base(), blueprint: ROOT },
        ["Use the minime blueprint skill.", `Blueprint: ${ROOT}`, "Replicate stopped; settle this in the blueprint: x"], ["User message:", "End of user message."]],
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

/* ── fuel and verdict ── */

const job = (phase, { issue = null, requests = 1, minutes = 1, tree = "t1" } = {}) => ({ phase, started: 0, ended: minutes * 60_000, usage: { premiumRequests: requests }, result: { status: issue ? "blocked" : "done", blocking_issue: issue }, tree });

for (const [name, state, expected] of [
    ["no caps and no repeat", { ...base(), jobs: [job("blueprint", { requests: 40 })] }, null],
    ["requests at the cap", { ...base(), budget: { requests: 10 }, jobs: [job("blueprint", { requests: 4 }), job("replicate", { requests: 6 })] }, "10 premium requests, cap 10"],
    ["requests under the cap", { ...base(), budget: { requests: 10 }, jobs: [job("blueprint", { requests: 9 })] }, null],
    ["minutes past the cap", { ...base(), budget: { minutes: 30 }, jobs: [job("replicate", { minutes: 31 })] }, "31 worker minutes, cap 30"],
    ["a running job does not count yet", { ...base(), budget: { requests: 1 }, jobs: [{ ...job("blueprint"), ended: null }] }, null],
    ["the same blocking issue twice", { ...base(), jobs: [job("blueprint", { issue: "which Azure target?" }), job("blueprint", { issue: "which Azure target?" })] }, "the same blocking issue 2 times: which Azure target?"],
    ["two different issues", { ...base(), jobs: [job("blueprint", { issue: "a" }), job("blueprint", { issue: "b" })] }, null],
    ["a done pass between two identical issues", { ...base(), jobs: [job("replicate", { issue: "a" }), job("blueprint"), job("replicate", { issue: "a" })] }, null],
    ["repeats raised to three", { ...base(), budget: { repeats: 3 }, jobs: [job("blueprint", { issue: "a" }), job("blueprint", { issue: "a" })] }, null],
    ["the same open decision reworded twice", { ...base(), jobs: [{ ...job("blueprint", { issue: "I3 names no paths" }), result: { status: "blocked", blocking_issue: "I3 names no paths", open_decisions: [{ id: "C6", question: "Which paths?" }] } }, { ...job("blueprint", { issue: "I4 supplies no paths either" }), result: { status: "blocked", blocking_issue: "I4 supplies no paths either", open_decisions: [{ id: "C6", question: "What are the paths?" }] } }] }, "the same blocking issue 2 times: open decision C6"],
    ["different open decisions in a row", { ...base(), jobs: [{ ...job("blueprint", { issue: "a" }), result: { status: "blocked", blocking_issue: "a", open_decisions: [{ id: "C6" }] } }, { ...job("blueprint", { issue: "b" }), result: { status: "blocked", blocking_issue: "b", open_decisions: [{ id: "C7" }] } }] }, null],
    ["repeats off", { ...base(), budget: { repeats: 0 }, jobs: [job("blueprint", { issue: "a" }), job("blueprint", { issue: "a" })] }, null],
]) {
    test(`overBudget: ${name}`, () => assert.equal(flow.overBudget(state), expected));
}

test("a run out of fuel stops with its reason and no stage, ask or pause", () => {
    const s = flow.stopped({ ...base(), status: "asking", ask: { decisions: [] }, paused: true }, "10 premium requests, cap 10");
    assert.deepEqual([s.status, s.stopReason, s.stage, s.ask, s.paused], ["stopped", "10 premium requests, cap 10", null, null, false]);
});

const proven = { criteria: [{ id: "C1", tests: ["t.js"], finding: false }, { id: "C2", tests: ["t.js"], finding: false }] };
const tidy = { ...base(), findings: 0, ratchet: { interface_changes_outside_boundaries: 0, single_caller_functions: 0, copied_blocks: 0, test_lines_removed: 0 }, jobs: [job("inspect", { tree: "t1" })] };
for (const [name, state, board, tree, expected] of [
    ["everything proven", tidy, proven, "t1", { proven: true, gaps: [] }],
    ["no tree hash at hand still proves", tidy, proven, null, { proven: true, gaps: [] }],
    ["no blueprint yet", tidy, null, "t1", { proven: false, gaps: ["no criteria"] }],
    ["a criterion without a test and one with a finding", tidy, { criteria: [{ id: "C1", tests: [], finding: false }, { id: "C2", tests: ["t.js"], finding: true }] }, "t1", { proven: false, gaps: ["C1: no test", "C2: finding"] }],
    ["no inspection ran", { ...tidy, jobs: [] }, proven, "t1", { proven: false, gaps: ["no inspection"] }],
    ["the tree moved after the inspection", tidy, proven, "t2", { proven: false, gaps: ["the tree changed after the last inspection"] }],
    ["findings open", { ...tidy, findings: 2 }, proven, "t1", { proven: false, gaps: ["2 findings"] }],
    ["inspect gave no count", { ...tidy, findings: null }, proven, "t1", { proven: false, gaps: ["no findings count"] }],
    ["a dirty ratchet", { ...tidy, ratchet: { interface_changes_outside_boundaries: 1, single_caller_functions: 2, copied_blocks: 0, test_lines_removed: 3 } }, proven, "t1", { proven: false, gaps: ["ratchet: 1 interface changes outside the boundaries", "ratchet: 2 single-caller functions", "ratchet: 3 test lines removed"] }],
    ["removed test lines the user decided on", { ...tidy, testsDecided: true, ratchet: { ...tidy.ratchet, test_lines_removed: 3 } }, proven, "t1", { proven: true, gaps: [] }],
    ["a worker's done status proves nothing by itself", { ...tidy, status: "done", findings: null, jobs: [] }, { criteria: [{ id: "C1", tests: [], finding: false }] }, "t1", { proven: false, gaps: ["C1: no test", "no inspection", "no findings count"] }],
]) {
    test(`verdict: ${name}`, () => assert.deepEqual(flow.verdict(state, board, tree), expected));
}

test("replicate's preflight line becomes inspect's baseline", () => {
    const line = "ran: npm test on HEAD 1a2b3c4 → 73/1";
    const next = flow.advance(at({ phase: "replicate", input: [] }, { rounds: 1 }), "replicate", [done({ evidence_excerpts: [line, "npm test → 75/0"] })]);
    assert.equal(next.baseline, line);
    assert.ok(flow.waves(next)[0].jobs[0].input.includes(`Baseline: ${line}`));
    const blocked = flow.advance(at({ phase: "replicate", input: [] }), "replicate", [{ ...done({ evidence_excerpts: [line] }), status: "blocked", blocking_issue: "server down" }]);
    assert.equal(blocked.baseline, line);
});

test("a replicate reply without a preflight line keeps the earlier baseline and inspect gets none when there is none", () => {
    const kept = flow.advance(at({ phase: "replicate", input: [] }, { baseline: "ran: x on HEAD a → 1/0" }), "replicate", [done({ evidence_excerpts: ["npm test → 2/0"] })]);
    assert.equal(kept.baseline, "ran: x on HEAD a → 1/0");
    const none = flow.advance(at({ phase: "replicate", input: [] }), "replicate", [done()]);
    assert.ok(!flow.waves(none)[0].jobs[0].input.some((l) => l.startsWith("Baseline:")));
});

test("scores add up the board and the finished jobs", () => {
    const state = { ...base(), rounds: 2, jobs: [{ started: 0, ended: 90_000, usage: { premiumRequests: 3 } }, { started: 0, ended: null }] };
    const board = { criteria: [{ tests: ["t.js"], finding: false }, { tests: ["t.js"], finding: true }, { tests: [], finding: false }], diff: { added: 10, removed: 14, duplicates: [{}] }, check: { sources: { surprise: 1, default: 2 } } };
    assert.deepEqual(flow.scores(state, board), { proven: 1, criteria: 3, netLines: -4, copiedBlocks: 1, surprises: 1, defaults: 2, wiki: 0, rounds: 2, requests: 3, minutes: 1.5 });
});

/* ── the read side: scope, wiki input, receipts ── */

for (const [name, origin, expected] of [
    ["github https", "https://github.com/acme/todo.git", { org: "acme", repo: "todo" }],
    ["github ssh", "git@github.com:acme/todo.git", { org: "acme", repo: "todo" }],
    ["azure devops", "https://dev.azure.com/acme/proj/_git/todo", { org: "acme", repo: "todo" }],
    ["no remote", "", { org: "local", repo: "todo-dir" }],
    ["a bare name", "todo", { org: "todo", repo: "todo" }],
]) {
    test(`scopeOf: ${name}`, () => assert.deepEqual(flow.scopeOf(origin, "todo-dir"), expected));
}

test("waves pastes the wiki index and the past runs into a blueprint dispatch and nothing into the others", () => {
    const wiki = { index: { path: "/hq/wiki/orgs/acme/todo/index.md", text: "# acme/todo\n- [Dates](./dates.md)\n" }, runs: { path: "/hq/raw/acme/todo/runs.md", text: "| 2026-11-03 | fix | proven | blueprint 1 | 4 req, 6 min | ran: pytest on HEAD abc → 3 passed | - |" } };
    const bp = flow.waves({ ...base(), stage: { phase: "blueprint", message: "m", input: [] } }, { wiki });
    assert.deepEqual(bp[0].jobs[0].input, [
        "Wiki index of this repo (/hq/wiki/orgs/acme/todo/index.md); cite a rule you apply as [research: wiki <page path>#<anchor>]:",
        "# acme/todo\n- [Dates](./dates.md)",
        "Past runs of this repo (/hq/raw/acme/todo/runs.md); the test command of a proven run is the preflight command:",
        wiki.runs.text,
    ]);
    const rep = flow.waves({ ...base(), stage: { phase: "replicate", input: [] } }, { wiki });
    assert.deepEqual(rep[0].jobs[0].input, []);
    const none = flow.waves({ ...base(), stage: { phase: "blueprint", message: "m", input: [] } }, { wiki: { index: null, runs: null } });
    assert.deepEqual(none[0].jobs[0].input, []);
});

for (const [name, state, verdict, expected] of [
    ["a proven run", { ...base(), status: "done", baseline: "ran: pytest -q on HEAD abc → 3 passed, 0 failed", jobs: [job("blueprint"), job("replicate", { issue: "x" }), job("replicate"), { ...job("inspect"), result: { status: "done", findings: 2 } }, { ...job("inspect"), result: { status: "done", findings: 0 } }, job("extract")] }, { proven: true, gaps: [] },
        "| 2026-11-03 | fix the export | proven | blueprint 1, replicate 2 (1 blocked), inspect 2 (findings 2 → 0), extract 1 | 6 req, 6 min | ran: pytest -q on HEAD abc → 3 passed, 0 failed | - |"],
    ["a run the fuel gauge stopped", { ...base(), status: "stopped", stopReason: "the same blocking issue 2 times: no | test", jobs: [job("blueprint", { requests: 2 })] }, { proven: false, gaps: ["C1: no test", "no inspection"] },
        "| 2026-11-03 | fix the export | unproven: C1: no test; no inspection | blueprint 1 | 2 req, 1 min | - | the same blocking issue 2 times: no / test |"],
    ["a failed run with a report", { ...base(), status: "failed", report: { phase: "replicate", blocking_issue: "needs Azure" }, jobs: [] }, { proven: false, gaps: ["no criteria"] },
        "| 2026-11-03 | fix the export | unproven: no criteria | - | 0 req, 0 min | - | needs Azure |"],
]) {
    test(`receipt: ${name}`, () => assert.equal(flow.receipt(state, { criteria: [] }, verdict, Date.UTC(2026, 10, 3, 12)), expected));
}
