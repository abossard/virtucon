// Blueprint check and verify.
// Run: node --test  (from this directory)

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { check, commandOf, groupByCommand, placeholders, setResults, splitRow } from "./blueprint.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = readFileSync(path.join(HERE, "..", "template.md"), "utf8");
const SCRIPT = path.join(HERE, "blueprint.mjs");

const VALID = `# Blueprint: due-dates

Repo: acme/todo | Created: 2026-10-22

## Inputs

- **I1** (2026-10-22 09:14):
  > add a --due flag so I can sort by due date
- **I2** (2026-10-22 09:20):
  > don't touch the storage format

## Criteria

- **C1** (I1): When the user passes \`--due\`, the list command shall print items sorted by due date, earliest first.
- **C2** (I1): When \`--due\` gets a value that is not a date, the CLI shall exit with code 2 and name the bad value.

## Boundaries

| ID | Owner | Contract | Change | Criteria |
|----|-------|----------|--------|----------|
| B1 | \`src/cli.js\` parseArgs | argv → options; unknown value → exit 2 | changed | C1, C2 |

## Tests

| ID | Criterion | Boundary | Cases | Check | Result |
|----|-----------|----------|-------|-------|--------|
| T1 | C1 | B1 | two items out of order; equal dates keep input order | \`npm test -- -t due \\| tail -1\` | pending |
| T2 | C2 | B1 | \`--due nope\` exits 2 | review: error message names the value | pending |

## Decisions

| ID | Question | Answer | Source |
|----|----------|--------|--------|
| D1 | Date format? | ISO 8601 | data: src/store.js:42 |

## Constraints

- Storage format stays unchanged (I2)

## Out of scope

None.
`;

const run = (text) => check(text, placeholders(TEMPLATE));

test("valid blueprint has no errors and is pending", () => {
    const r = run(VALID);
    assert.deepEqual(r.errors, []);
    assert.equal(r.status, "pending");
    assert.deepEqual(r.tests, { total: 2, pass: 0, fail: 0, pending: 2 });
});

test("the bundled template itself is rejected", () => {
    assert.equal(run(TEMPLATE).status, "invalid");
});

for (const [name, from, to, expected] of [
    ["missing section", "## Out of scope\n\nNone.\n", "", "missing section: ## Out of scope"],
    ["criterion without test", "| T2 | C2 |", "| T2 | C1 |", "C2 has no test"],
    ["criterion without input", "**C2** (I1):", "**C2**:", "C2 names no input"],
    ["unknown input", "**C2** (I1):", "**C2** (I9):", "C2 references unknown input I9"],
    ["untraced input", "(I2)", "(none)", "I2 is not traced"],
    ["source kind outside data/research/user", "data: src/store.js:42", "wiki: patterns/dates.md", "D1 source must be"],
    ["test with unknown boundary", "| T1 | C1 | B1 |", "| T1 | C1 | B7 |", "T1 references unknown boundary B7"],
    ["test without check", "review: error message names the value", "looks fine", "T2 check must be"],
    ["bad result", "| review: error message names the value | pending |", "| review: error message names the value | done |", "T2 result must start with"],
    ["duplicate id", "| T2 | C2 |", "| T1 | C2 |", "duplicate id T1"],
    ["placeholder left", "Repo: acme/todo", "Repo: <org>/<repo>", "template placeholder left: <org>"],
]) {
    test(`check rejects: ${name}`, () => {
        assert.ok(VALID.includes(from), `fixture lacks ${from}`);
        const r = run(VALID.replace(from, to));
        assert.equal(r.status, "invalid");
        assert.ok(r.errors.some((e) => e.includes(expected)), `${expected} not in ${JSON.stringify(r.errors)}`);
    });
}

for (const [name, results, decision, status] of [
    ["all pass", ["pass", "pass"], null, "verified"],
    ["one fail", ["pass", "fail"], null, "failing"],
    ["one pending", ["pass", "pending"], null, "pending"],
    ["open decision wins over results", ["pass", "pass"], "| D2 | Max rate? | open: a) 10/s b) 100/s, recommend a | user: pending |", "questions"],
]) {
    test(`status: ${name}`, () => {
        let text = setResults(VALID, { T1: results[0], T2: results[1] });
        if (decision) text = text.replace("| D1 | Date format? | ISO 8601 | data: src/store.js:42 |", `$&\n${decision}`);
        assert.equal(run(text).status, status);
    });
}

for (const [cell, command] of [
    ["`npm test`", "npm test"],
    ["`npm test \\| tail -1`", "npm test | tail -1"],
    ["review: looks right", null],
]) {
    test(`commandOf(${cell})`, () => assert.equal(commandOf(cell), command));
}

for (const [name, rows, expected] of [
    ["one data decision", [], { data: 1, research: 0, wiki: 0, user: 0 }],
    ["wiki research counts as research and wiki", ["| D2 | Quote rule? | RFC 4180 | research: wiki/patterns/csv.md |"], { data: 1, research: 1, wiki: 1, user: 0 }],
    ["a wiki page cited with a space still counts", ["| D2 | Quote rule? | RFC 4180 | research: wiki orgs/acme/todo/x.md \"rule\" |"], { data: 1, research: 1, wiki: 1, user: 0 }],
    ["external research is not a wiki hit", ["| D2 | Quote rule? | RFC 4180 | research: https://example.com/spec |"], { data: 1, research: 1, wiki: 0, user: 0 }],
    ["a Wikipedia URL is not a wiki hit", ["| D2 | Sort? | stable | research: https://en.wikipedia.org/wiki/Sorting |"], { data: 1, research: 1, wiki: 0, user: 0 }],
    ["user and pending user decisions", ["| D2 | Max rate? | 10/s | user: I2 |", "| D3 | Window? | open: a) 1s b) 60s | user: pending |"], { data: 1, research: 0, wiki: 0, user: 2 }],
]) {
    test(`check counts decision sources: ${name}`, () => {
        const text = VALID.replace("| D1 | Date format? | ISO 8601 | data: src/store.js:42 |", ["| D1 | Date format? | ISO 8601 | data: src/store.js:42 |", ...rows].join("\n"));
        assert.deepEqual(run(text).sources, expected);
    });
}

test("splitRow keeps pipes inside code spans", () => {
    assert.deepEqual(splitRow("| T1 | `a | b` | x |"), ["T1", "`a | b`", "x"]);
});

test("verify runs commands, writes logs and results, skips review checks", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bp-"));
    const file = path.join(dir, "due-dates.md");
    writeFileSync(file, VALID.replace("`npm test -- -t due \\| tail -1`", "`echo ok`"));
    const out = spawnSync(process.execPath, [SCRIPT, "verify", file, "--cwd", dir, "--by", "replicate"], { encoding: "utf8" });
    const json = JSON.parse(out.stdout);
    assert.equal(out.status, 0);
    assert.deepEqual(json.results.map((r) => [r.id, r.exit]), [["T1", 0]]);
    const text = readFileSync(file, "utf8");
    assert.match(text, /\| pass \(replicate [\d-]+ [\d:]+\) \[log\]\(due-dates\.runs\/T1\.log\) \|/);
    assert.match(text, /\| review: error message names the value \| pending \|/);
    assert.match(readFileSync(path.join(dir, "due-dates.runs", "T1.log"), "utf8"), /^\$ echo ok\n[\s\S]*exit: 0[\s\S]*ok/);
});

for (const [name, command, exitCode] of [
    ["failing command", "`exit 3`", 1],
    ["missing command", "`definitely-not-a-command-xyz`", 1],
]) {
    test(`verify marks ${name} as fail`, () => {
        const dir = mkdtempSync(path.join(tmpdir(), "bp-"));
        const file = path.join(dir, "bp.md");
        writeFileSync(file, VALID.replace("`npm test -- -t due \\| tail -1`", command));
        const out = spawnSync(process.execPath, [SCRIPT, "verify", file, "--cwd", dir], { encoding: "utf8" });
        assert.equal(out.status, exitCode);
        assert.equal(JSON.parse(out.stdout).status, "failing");
        assert.match(readFileSync(file, "utf8"), /\| fail \(run /);
    });
}

for (const [name, checks, groups] of [
    ["distinct commands stay separate", ["`a`", "`b`"], [["a", ["T1"]], ["b", ["T2"]]]],
    ["a repeated command is one group", ["`a`", "`a`"], [["a", ["T1", "T2"]]]],
]) {
    test(`groupByCommand: ${name}`, () => {
        const tests = checks.map((c, i) => ({ id: `T${i + 1}`, check: c }));
        assert.deepEqual(groupByCommand(tests).map((g) => [g.command, g.ids]), groups);
    });
}

test("verify runs a shared harness command once and marks every row it covers", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bp-"));
    const file = path.join(dir, "bp.md");
    writeFileSync(file, VALID.replace("`npm test -- -t due \\| tail -1`", "`echo run >> count.txt`").replace("review: error message names the value", "`echo run >> count.txt`"));
    const out = spawnSync(process.execPath, [SCRIPT, "verify", file, "--cwd", dir], { encoding: "utf8" });
    assert.equal(out.status, 0);
    assert.equal(readFileSync(path.join(dir, "count.txt"), "utf8"), "run\n");
    assert.deepEqual(JSON.parse(out.stdout).results.map((r) => r.id), ["T1", "T2"]);
    assert.ok(existsSync(path.join(dir, "bp.runs", "T1+T2.log")));
    assert.equal(readFileSync(file, "utf8").match(/\| pass \(run [\d-]+ [\d:]+\) \[log\]\(bp\.runs\/T1\+T2\.log\) \|/g).length, 2);
});

test("verify refuses an invalid blueprint without running anything", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bp-"));
    const file = path.join(dir, "bp.md");
    writeFileSync(file, VALID.replace("(I2)", "").replace("`npm test -- -t due \\| tail -1`", "`touch ran`"));
    const out = spawnSync(process.execPath, [SCRIPT, "verify", file, "--cwd", dir], { encoding: "utf8" });
    assert.equal(out.status, 1);
    assert.equal(existsSync(path.join(dir, "ran")), false);
});
