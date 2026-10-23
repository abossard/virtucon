// Blueprint check and coverage.
// Run: node --test  (from this directory)

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { check, coverage, fingerprint, idPattern, isTestPath, placeholders, splitRow } from "./blueprint.mjs";

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

- **C1** (I1 "sort by due date"): When the user passes \`--due\`, the list command shall print items sorted by due date, earliest first.
- **C2** (I1 "--due flag"): When \`--due\` gets a value that is not a date, the CLI shall exit with code 2 and name the bad value.

## Boundaries

| ID | Owner | Contract | Change | Criteria |
|----|-------|----------|--------|----------|
| B1 | \`src/cli.js\` parseArgs | argv → options; unknown value → exit 2 | changed | C1, C2 |

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

test("valid blueprint has no errors and is ready", () => {
    const r = run(VALID);
    assert.deepEqual(r.errors, []);
    assert.equal(r.status, "ready");
    assert.deepEqual(r.counts, { inputs: 2, criteria: 2, boundaries: 1, decisions: 1 });
    assert.equal(r.extracted, null);
});

test("the bundled template itself is rejected", () => {
    assert.equal(run(TEMPLATE).status, "invalid");
});

const long = (n) => "x".repeat(n);

for (const [name, from, to, expected] of [
    ["missing section", "## Out of scope\n\nNone.\n", "", "missing section: ## Out of scope"],
    ["missing title", "# Blueprint: due-dates\n", "", "missing title"],
    ["missing header", "Repo: acme/todo | Created: 2026-10-22", "Repo: acme/todo", "missing header"],
    ["tests section", "## Decisions", "## Tests\n\n| ID | Criterion |\n|----|-----------|\n| T1 | C1 |\n\n## Decisions", "section ## Tests is not allowed"],
    ["unknown section", "## Decisions", "## Notes\n\n- x (I1)\n\n## Decisions", "unknown section: ## Notes"],
    ["duplicate section", "## Constraints", "## Criteria\n\n## Constraints", "duplicate section: ## Criteria"],
    ["criterion in no boundary", "| changed | C1, C2 |", "| changed | C1 |", "C2 is in no boundary"],
    ["boundary without criterion", "| changed | C1, C2 |", "| changed | none |", "B1 names no criterion"],
    ["boundary with unknown criterion", "| changed | C1, C2 |", "| changed | C1, C2, C9 |", "B1 references unknown criterion C9"],
    ["boundary change outside new/changed/unchanged", "| changed |", "| rewritten |", "B1 change must be"],
    ["boundary with a stray pipe", "→ options;", "→ a | b;", "has 6 cells, expected 5"],
    ["criterion without origin", '**C2** (I1 "--due flag"):', "**C2**:", "C2 names no origin"],
    ["unknown input", '**C2** (I1 "--due flag"):', '**C2** (I9 "--due flag"):', "C2 references unknown input I9"],
    ["input cited without its words", '(I1 "--due flag")', "(I1)", "C2 cites I1 without its words"],
    ["quote the input does not contain", '(I1 "--due flag")', '(I1 "--sort flag")', "C2 quotes \"--sort flag\" but I1 does not contain those words"],
    ["quote taken from the input's timestamp line", '(I1 "--due flag")', '(I1 "09:14")', "C2 quotes \"09:14\" but I1 does not contain those words"],
    ["quote shorter than 3 characters", '(I1 "--due flag")', '(I1 "--")', "C2 quote is 2 characters, use 3 to 60"],
    ["quote longer than 60 characters", '(I1 "--due flag")', `(I1 "${"x".repeat(61)}")`, "C2 quote is 61 characters, use 3 to 60"],
    ["decision cited that does not exist", '(I1 "--due flag")', '(I1 "--due flag", D9)', "C2 references unknown decision D9"],
    ["untraced input", "(I2)", "(I1)", "I2 is not traced"],
    ["criterion not in EARS form", "the CLI shall exit", "the CLI will exit", "C2 is not EARS"],
    ["source kind outside data/research/user", "data: src/store.js:42", "wiki: patterns/dates.md", "D1 source must be"],
    ["decision with a stray pipe", "| ISO 8601 |", "| ISO | 8601 |", "has 5 cells, expected 4"],
    ["decision without answer", "| ISO 8601 |", "|  |", "D1 has no answer"],
    ["constraint without a source", "- Storage format stays unchanged (I2)", "- Storage format stays unchanged", "Constraints:"],
    ["out of scope without a source", "None.\n", "- Sorting by other fields\n", "Out of scope:"],
    ["duplicate id", "| D1 | Date format? | ISO 8601 | data: src/store.js:42 |", "| D1 | Date format? | ISO 8601 | data: src/store.js:42 |\n| D1 | Other? | x | data: a.js:1 |", "duplicate id D1"],
    ["placeholder left", "Repo: acme/todo", "Repo: <org>/<repo>", "template placeholder left: <org>"],
    ["dispatcher skill line recorded as an input", "  > don't touch the storage format", "  > Use the minime blueprint skill.\n  > Blueprint: new", "I2 contains the dispatcher's prompt"],
    ["dispatcher Return line recorded as an input", "  > don't touch the storage format", "  > Return: status (done | blocked | failed), blueprint_path", "I2 contains the dispatcher's prompt"],
    ["paragraph under the header", "\n## Inputs", "\nThis task is about sorting.\n\n## Inputs", "is prose in the header"],
    ["paragraph in criteria", "## Boundaries", "The criteria above came from the first message.\n\n## Boundaries", "is prose in ## Criteria"],
    ["continuation line under a criterion", "name the bad value.", "name the bad value.\n  which keeps scripts safe", "is prose in ## Criteria"],
    ["paragraph in constraints", "None.\n", "- Storage stays (I2)\nExplanation of why.\n", "is prose in ## Out of scope"],
    ["code block outside boundaries", "## Decisions", "## Decisions\n\n```text\nnotes\n```", "is prose in ## Decisions"],
    ["unclosed code block in boundaries", "## Decisions", "```mermaid\nflowchart LR\n\n## Decisions", "## Boundaries has an unclosed code block"],
]) {
    test(`check rejects: ${name}`, () => {
        assert.ok(VALID.includes(from), `fixture lacks ${JSON.stringify(from)}`);
        const r = run(VALID.replace(from, to));
        assert.equal(r.status, "invalid");
        assert.ok(r.errors.some((e) => e.includes(expected)), `${expected} not in ${JSON.stringify(r.errors)}`);
    });
}

// The limits are pinned as numbers on purpose: a test that reuses the constant cannot notice it changing.
for (const [what, limit, build] of [
    ["criterion text", 200, (n) => VALID.replace(/(\*\*C2\*\* \(I1 "--due flag"\): ).*$/m, `$1a shall ${long(n - 8)}`)],
    ["boundary contract", 160, (n) => VALID.replace("argv → options; unknown value → exit 2", long(n))],
    ["decision question", 100, (n) => VALID.replace("Date format?", long(n))],
    ["decision answer", 140, (n) => VALID.replace("| ISO 8601 |", `| ${long(n)} |`)],
    ["decision source", 120, (n) => VALID.replace("data: src/store.js:42", `data: ${long(n - 6)}`)],
    ["constraint", 140, (n) => VALID.replace("- Storage format stays unchanged (I2)", `- ${long(n - 5)} (I2)`)],
]) {
    test(`${what} may be ${limit} characters, not ${limit + 1}`, () => {
        assert.deepEqual(run(build(limit)).errors, []);
        const errors = run(build(limit + 1)).errors;
        assert.ok(errors.some((e) => e.includes(`is ${limit + 1} characters, max ${limit}`)), JSON.stringify(errors));
    });
}

for (const [name, from, to] of [
    ["a quoted input with blank quote lines", "  > add a --due flag so I can sort by due date", "  > add a --due flag\n  >\n  > so I can sort by due date"],
    ["a Mermaid flowchart under the boundaries", "## Decisions", "```mermaid\nflowchart LR\n  A --> B\n```\n\n## Decisions"],
    ["an Extracted date in the header", "Created: 2026-10-22", "Created: 2026-10-22 | Extracted: 2026-10-23"],
    ["a decision answered with a value and a pipe in code", "| ISO 8601 |", "| `a \\| b` |"],
]) {
    test(`check accepts: ${name}`, () => {
        assert.ok(VALID.includes(from), `fixture lacks ${JSON.stringify(from)}`);
        assert.deepEqual(run(VALID.replace(from, to)).errors, []);
    });
}

const DERIVED = VALID.replace(
    "- **C2** (I1 \"--due flag\"):",
    "- **C3** (D1): When `--due` is missing, the list command shall keep the stored order.\n- **C2** (I1 \"--due flag\"):",
).replace("| changed | C1, C2 |", "| changed | C1, C2, C3 |");

for (const [name, text] of [
    ["a quote that differs in case and spacing", VALID.replace('"--due flag"', '"--DUE   Flag"')],
    ["a quote that spans a wrapped input line", VALID.replace("> add a --due flag so I can sort by due date", "> add a --due flag\n  > so I can sort by due date").replace('"--due flag"', '"flag so I can"')],
    ["parentheses inside a quote", VALID.replace("> add a --due flag so", "> add a --due flag (asap) so").replace('"--due flag"', '"flag (asap)"')],
    ["a criterion that comes from a decision", DERIVED],
    ["ids inside the quoted words", VALID.replace("> add a --due flag so I can sort by due date", "> add a --due flag so I can sort by due date, keep I2 and D3 intact").replace('(I1 "--due flag")', '(I1 "keep I2 and D3 intact")')],
    ["several origins", VALID.replace('(I1 "--due flag")', '(I1 "--due flag", I2 "storage format", D1)')],
]) {
    test(`check accepts: ${name}`, () => assert.deepEqual(run(text).errors, []));
}

test("check lists the criteria that quote no input as derived", () => {
    assert.deepEqual(run(VALID).derived, []);
    assert.deepEqual(run(DERIVED).derived, ["C3"]);
});

test("check reports the Extracted date", () => {
    assert.equal(run(VALID.replace("Created: 2026-10-22", "Created: 2026-10-22 | Extracted: 2026-10-23")).extracted, "2026-10-23");
});

const OPEN_ROW = "| D2 | Max rate? | open: a) 10/s b) 100/s; recommend a | user: pending |";
const D1_ROW = "| D1 | Date format? | ISO 8601 | data: src/store.js:42 |";

for (const [name, text, status] of [
    ["no open decision", VALID, "ready"],
    ["an open answer", VALID.replace(D1_ROW, `${D1_ROW}\n${OPEN_ROW}`), "questions"],
    ["a user decision still pending", VALID.replace(D1_ROW, `${D1_ROW}\n| D2 | Max rate? | 10/s | user: pending |`), "questions"],
    ["errors win over open decisions", VALID.replace(D1_ROW, `${D1_ROW}\n${OPEN_ROW}`).replace("(I2)", "(I9)"), "invalid"],
]) {
    test(`status: ${name}`, () => assert.equal(run(text).status, status));
}

test("open decisions are listed with their options", () => {
    assert.deepEqual(run(VALID.replace(D1_ROW, `${D1_ROW}\n${OPEN_ROW}`)).open, [
        { id: "D2", question: "Max rate?", answer: "open: a) 10/s b) 100/s; recommend a" },
    ]);
});

for (const [name, rows, expected] of [
    ["one data decision", [], { data: 1, research: 0, wiki: 0, user: 0 }],
    ["wiki research counts as research and wiki", ["| D2 | Quote rule? | RFC 4180 | research: wiki/patterns/csv.md |"], { data: 1, research: 1, wiki: 1, user: 0 }],
    ["a wiki page cited with a space still counts", ["| D2 | Quote rule? | RFC 4180 | research: wiki orgs/acme/todo/x.md \"rule\" |"], { data: 1, research: 1, wiki: 1, user: 0 }],
    ["external research is not a wiki hit", ["| D2 | Quote rule? | RFC 4180 | research: https://example.com/spec |"], { data: 1, research: 1, wiki: 0, user: 0 }],
    ["a Wikipedia URL is not a wiki hit", ["| D2 | Sort? | stable | research: https://en.wikipedia.org/wiki/Sorting |"], { data: 1, research: 1, wiki: 0, user: 0 }],
    ["user and pending user decisions", ["| D2 | Max rate? | 10/s | user: I2 |", "| D3 | Window? | open: a) 1s b) 60s | user: pending |"], { data: 1, research: 0, wiki: 0, user: 2 }],
]) {
    test(`check counts decision sources: ${name}`, () => {
        assert.deepEqual(run(VALID.replace(D1_ROW, [D1_ROW, ...rows].join("\n"))).sources, expected);
    });
}

test("splitRow keeps pipes inside code spans", () => {
    assert.deepEqual(splitRow("| B1 | `a | b` | x |"), ["B1", "`a | b`", "x"]);
});

/* ── coverage ── */

for (const [text, id, matches] of [
    ["func C1_roundsUp()", "C1", true],
    ["// C1", "C1", true],
    ['it("C1: rounds up")', "C1", true],
    ["test_C1_rounds_up", "C1", true],
    ["C1", "C1", true],
    ["C10_other", "C1", false],
    ["AC1", "C1", false],
    ["C2_other", "C1", false],
]) {
    test(`idPattern(${id}) ${matches ? "matches" : "ignores"} ${JSON.stringify(text)}`, () => {
        assert.equal(new RegExp(idPattern(id)).test(text), matches);
    });
}

for (const [file, expected] of [
    ["engine/test/inputoutputmap/inputoutputmap_test.cpp", true],
    ["tests/test_export.py", true],
    ["src/cli.spec.ts", true],
    ["src/FooTest.java", true],
    ["docs/notes.md", false],
    ["src/cli.js", false],
]) {
    test(`isTestPath(${file})`, () => assert.equal(isTestPath(file), expected));
}

function repoWith(files) {
    const dir = mkdtempSync(path.join(tmpdir(), "bp-cov-"));
    spawnSync("git", ["init", "-q"], { cwd: dir });
    for (const [name, content] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
        writeFileSync(path.join(dir, name), content);
    }
    return dir;
}

const COVERED_FILES = {
    "src/cli.js": "// C1 and C2 are implemented here, but this is not a test\n",
    "test/due.test.js": 'it("C1: sorts by due date", () => {});\n',
    "test/bad.test.js": "function test_C2_exitsWithCode2() {}\n",
    "test/other.test.js": "// C10 belongs to another blueprint\n",
};

test("coverage lists the test files that name each criterion, found without committing", () => {
    const repo = repoWith(COVERED_FILES);
    const out = coverage(VALID, { repo });
    assert.equal(out.status, "covered");
    assert.deepEqual(out.covered, [
        { id: "C1", files: ["test/due.test.js"] },
        { id: "C2", files: ["test/bad.test.js"] },
    ]);
});

test("coverage reports a criterion that no test file names", () => {
    const repo = repoWith({ "test/due.test.js": COVERED_FILES["test/due.test.js"], "docs/notes.md": "C2 is described here\n" });
    const out = coverage(VALID, { repo });
    assert.equal(out.status, "missing");
    assert.deepEqual(out.missing, ["C2"]);
});

test("coverage can be limited to the changed files", () => {
    const repo = repoWith(COVERED_FILES);
    const out = coverage(VALID, { repo, files: ["test/due.test.js"] });
    assert.deepEqual(out.missing, ["C2"]);
});

test("coverage command exits 1 for a missing criterion and 0 when covered", () => {
    for (const [files, status, json] of [[COVERED_FILES, 0, "covered"], [{ "test/due.test.js": COVERED_FILES["test/due.test.js"] }, 1, "missing"]]) {
        const dir = repoWith(files);
        const file = path.join(dir, "bp.md");
        writeFileSync(file, VALID);
        const out = spawnSync(process.execPath, [SCRIPT, "coverage", file, "--repo", dir], { encoding: "utf8" });
        assert.equal(out.status, status);
        assert.equal(JSON.parse(out.stdout).status, json);
    }
});

test("coverage command limits the search to --files", () => {
    const dir = repoWith(COVERED_FILES);
    const file = path.join(dir, "bp.md");
    writeFileSync(file, VALID);
    const out = spawnSync(process.execPath, [SCRIPT, "coverage", file, "--repo", dir, "--files", "test/due.test.js"], { encoding: "utf8" });
    assert.equal(out.status, 1);
    assert.deepEqual(JSON.parse(out.stdout).missing, ["C2"]);
});

test("coverage command reports a directory that is not a git repository", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bp-nogit-"));
    const file = path.join(dir, "bp.md");
    writeFileSync(file, VALID);
    const out = spawnSync(process.execPath, [SCRIPT, "coverage", file, "--repo", dir], { encoding: "utf8", env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(dir) } });
    assert.equal(out.status, 2);
    assert.equal(JSON.parse(out.stdout).status, "error");
});

/* ── fingerprint ── */

const gitIn = (dir, ...args) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir, encoding: "utf8" });

function committedRepo() {
    const dir = repoWith({ "src/a.txt": "one\n", ".gitignore": "build/\n" });
    gitIn(dir, "add", "-A");
    gitIn(dir, "commit", "-q", "-m", "base");
    return dir;
}

const print = (dir) => fingerprint(dir).fingerprint;

test("fingerprint is stable, changes with any edit and returns once the bytes are restored", () => {
    const dir = committedRepo();
    const clean = print(dir);
    assert.equal(print(dir), clean);
    const file = path.join(dir, "src", "a.txt");
    const original = readFileSync(file);
    writeFileSync(file, "one\ntwo\n");
    const edited = print(dir);
    assert.notEqual(edited, clean);
    writeFileSync(file, original);
    assert.equal(print(dir), clean);
});

test("fingerprint covers staged, untracked and rewritten untracked files but not ignored ones", () => {
    const dir = committedRepo();
    const clean = print(dir);
    mkdirSync(path.join(dir, "build"), { recursive: true });
    writeFileSync(path.join(dir, "build", "out.o"), "object");
    assert.equal(print(dir), clean, "ignored files do not count");
    writeFileSync(path.join(dir, "new.txt"), "x");
    const withNew = print(dir);
    assert.notEqual(withNew, clean);
    writeFileSync(path.join(dir, "new.txt"), "y");
    assert.notEqual(print(dir), withNew, "the content of an untracked file counts");
    rmSync(path.join(dir, "new.txt"));
    assert.equal(print(dir), clean);
    writeFileSync(path.join(dir, "src", "a.txt"), "staged\n");
    gitIn(dir, "add", "src/a.txt");
    assert.notEqual(print(dir), clean, "staged changes count");
});

test("fingerprint command prints the fingerprint, and reports a directory that is not a git repository", () => {
    const dir = committedRepo();
    const ok = spawnSync(process.execPath, [SCRIPT, "fingerprint", "--repo", dir], { encoding: "utf8" });
    assert.equal(ok.status, 0);
    assert.equal(JSON.parse(ok.stdout).fingerprint, print(dir));
    const plain = mkdtempSync(path.join(tmpdir(), "bp-nogit-"));
    const bad = spawnSync(process.execPath, [SCRIPT, "fingerprint", "--repo", plain], { encoding: "utf8", env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(plain) } });
    assert.equal(bad.status, 2);
    assert.equal(JSON.parse(bad.stdout).status, "error");
});

/* ── command line ── */

test("check command exits 0 for a valid blueprint and 1 for an invalid one", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bp-"));
    const file = path.join(dir, "bp.md");
    writeFileSync(file, VALID);
    assert.equal(spawnSync(process.execPath, [SCRIPT, "check", file], { encoding: "utf8" }).status, 0);
    writeFileSync(file, VALID.replace("(I2)", ""));
    const out = spawnSync(process.execPath, [SCRIPT, "check", file], { encoding: "utf8" });
    assert.equal(out.status, 1);
    assert.equal(JSON.parse(out.stdout).status, "invalid");
});

for (const args of [[], ["check"], ["verify", "bp.md"], ["coverage"]]) {
    test(`usage error for ${JSON.stringify(args)}`, () => {
        const out = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
        assert.equal(out.status, 2);
        assert.match(out.stderr, /usage: blueprint\.mjs check/);
    });
}
