// Blueprint check and coverage.
// Run: node --test  (from this directory)

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { addedLines, applyEdit, check, checkFile, coverage, diff, duplicates, evidenceOf, idPattern, isTestPath, open, parse, placeholders, splitRow } from "./blueprint.mjs";

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

- **C1** (I1 "sort by due date"): When the user passes \`--due\`, the list command shall print items sorted by due date, earliest first. [data: src/store.js:42]
- **C2** (I1 "--due flag"): When \`--due\` gets a value that is not a date, the CLI shall exit with code 2 and name the bad value. [ran: node src/cli.js --due x → exit 2]

## Boundaries

| ID | Owner | Contract | Change | Criteria |
|----|-------|----------|--------|----------|
| B1 | \`src/cli.js\` parseArgs | argv → options; unknown value → exit 2 | changed | C1, C2 |
| B2 | \`src/store.js\` save | items → file; storage format unchanged (I2) | unchanged | C1 |
`;

const run = (text) => check(text, placeholders(TEMPLATE));

test("valid blueprint has no errors and is ready", () => {
    const r = run(VALID);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.warnings, []);
    assert.equal(r.status, "ready");
    assert.deepEqual(r.counts, { inputs: 2, criteria: 2, boundaries: 2 });
    assert.equal(r.extracted, null);
});

test("the bundled template itself is rejected", () => {
    assert.equal(run(TEMPLATE).status, "invalid");
});

test("the bundled template is the three sections with one placeholder line each", () => {
    const bp = parse(TEMPLATE);
    assert.deepEqual(bp.headings, ["Inputs", "Criteria", "Boundaries"]);
    assert.deepEqual([bp.inputs.length, bp.criteria.length, bp.boundaries.length], [1, 1, 1]);
    assert.equal(bp.criteria[0].evidence.length, 1);
});

const long = (n) => "x".repeat(n);
const BOUNDARIES_SECTION = VALID.slice(VALID.indexOf("## Boundaries"));
const C1_EVIDENCE = "[data: src/store.js:42]";
const C2_EVIDENCE = "[ran: node src/cli.js --due x → exit 2]";

for (const [name, from, to, expected] of [
    ["missing section", BOUNDARIES_SECTION, "", "missing section: ## Boundaries"],
    ["missing title", "# Blueprint: due-dates\n", "", "missing title"],
    ["missing header", "Repo: acme/todo | Created: 2026-10-22", "Repo: acme/todo", "missing header"],
    ["unknown section", "## Boundaries", "## Notes\n\n- x (I1)\n\n## Boundaries", "unknown section: ## Notes, allowed: Inputs, Criteria, Boundaries"],
    ["duplicate section", "## Boundaries", "## Criteria\n\n## Boundaries", "duplicate section: ## Criteria"],
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
    ["a decision cited in the origin", '(I1 "--due flag")', '(I1 "--due flag", D1)', "C2 cites D1, decisions are brackets now"],
    ["a decision as the only origin", '(I1 "--due flag")', "(D1)", "C2 cites D1, decisions are brackets now"],
    ["a decision cited in the sentence", "earliest first.", "earliest first (D1).", "C1 cites D1, decisions are brackets now"],
    ["untraced input", "(I2)", "(I1)", "I2 is not traced"],
    ["criterion not in EARS form", "the CLI shall exit", "the CLI will exit", "C2 is not EARS"],
    ["a criterion without a bracket", ` ${C2_EVIDENCE}`, "", "C2 has no evidence: end it with [ran: …], [data: …], [research: …], [user: I1] or [default: I1]"],
    ["text after the evidence", `bad value. ${C2_EVIDENCE}`, `bad value. ${C2_EVIDENCE} And more.`, "C2 has no evidence"],
    ["a period after the evidence", C2_EVIDENCE, `${C2_EVIDENCE}.`, "C2 has no evidence"],
    ["source outside the evidence ladder", C1_EVIDENCE, "[wiki: patterns/dates.md]", 'C1 evidence "[wiki: patterns/dates.md]" must be ran, data, research, user, default or open followed by ": <reference>"'],
    ["model memory as a source", C1_EVIDENCE, "[memory: ISO is common]", "C1 evidence"],
    ["a source without a reference", C1_EVIDENCE, "[data:]", "C1 evidence"],
    ["a bracket without a source", C1_EVIDENCE, "[src/store.js:42]", "C1 evidence"],
    ["a process link to a page that is not a phase page", C1_EVIDENCE, "[research: process-date-parsing.md#quote-the-words]", "C1 links process-date-parsing.md, which is not a process page"],
    ["a process link to a plural phase page name", C1_EVIDENCE, "[research: [rule](process-blueprints.md#quote-the-words)]", "C1 links process-blueprints.md, which is not a process page"],
    ["a process link without an anchor", C1_EVIDENCE, "[research: process-blueprint.md]", "C1 links process-blueprint.md without an anchor"],
    ["a markdown process link without an anchor", C1_EVIDENCE, "[research: [rule](process-blueprint.md#)]", "C1 links process-blueprint.md without an anchor"],
    ["a process link in a data bracket to a wrong page", C1_EVIDENCE, "[data: src/store.js:42, process-notes.md#a]", "C1 links process-notes.md, which is not a process page"],
    ["duplicate criterion id", '**C2** (I1 "--due flag")', '**C1** (I1 "--due flag")', "duplicate id C1"],
    ["duplicate boundary id", "| B2 |", "| B1 |", "duplicate id B1"],
    ["placeholder left", "Repo: acme/todo", "Repo: <org>/<repo>", "template placeholder left: <org>"],
    ["dispatcher skill line recorded as an input", "  > don't touch the storage format", "  > Use the minime blueprint skill.\n  > Blueprint: new", "I2 contains the dispatcher's prompt"],
    ["dispatcher Return line recorded as an input", "  > don't touch the storage format", "  > Return: status (done | blocked | failed), blueprint_path", "I2 contains the dispatcher's prompt"],
    ["paragraph under the header", "\n## Inputs", "\nThis task is about sorting.\n\n## Inputs", "is prose in the header"],
    ["paragraph in criteria", "## Boundaries", "The criteria above came from the first message.\n\n## Boundaries", "is prose in ## Criteria"],
    ["continuation line under a criterion", "→ exit 2]", "→ exit 2]\n  which keeps scripts safe", "is prose in ## Criteria"],
    ["code block outside boundaries", "## Boundaries", "```text\nnotes\n```\n\n## Boundaries", "is prose in ## Criteria"],
    ["unclosed code block in boundaries", "| unchanged | C1 |\n", "| unchanged | C1 |\n```mermaid\nflowchart LR\n", "## Boundaries has an unclosed code block"],
]) {
    test(`check rejects: ${name}`, () => {
        assert.ok(VALID.includes(from), `fixture lacks ${JSON.stringify(from)}`);
        const r = run(VALID.replace(from, to));
        assert.equal(r.status, "invalid");
        assert.ok(r.errors.some((e) => e.includes(expected)), `${expected} not in ${JSON.stringify(r.errors)}`);
    });
}

// Everything the older format kept in a section of its own now sits on a criterion line or in a Boundaries row.
for (const [name, body] of [
    ["Decisions", "| ID | Question | Answer | Source |\n|----|----------|--------|--------|\n| D1 | Date format? | ISO 8601 | data: src/store.js:42 |"],
    ["Flows", "| ID | From | To | Message | Criteria |\n|----|------|----|---------|----------|\n| F1 | ext | B1 | list | C1 |"],
    ["Constraints", "- Storage format stays unchanged (I2)"],
    ["Out of scope", "None."],
    ["Tests", "| ID | Criterion |\n|----|-----------|\n| T1 | C1 |"],
]) {
    test(`check rejects the section ## ${name} and nothing else`, () => {
        const r = run(`${VALID}\n## ${name}\n\n${body}\n`);
        assert.equal(r.status, "invalid");
        assert.deepEqual(r.errors, [`section ## ${name} is not allowed: fold its facts into the criterion or boundary row that needs them`]);
    });
}

// The limits are pinned as numbers on purpose: a test that reuses the constant cannot notice it changing.
for (const [what, limit, build] of [
    ["criterion text", 200, (n) => VALID.replace(/(\*\*C2\*\* \(I1 "--due flag"\): ).*$/m, `$1a shall ${long(n - 8)} ${C2_EVIDENCE}`)],
    ["boundary contract", 160, (n) => VALID.replace("argv → options; unknown value → exit 2", long(n))],
    ["evidence bracket", 120, (n) => VALID.replace("ran: node src/cli.js --due x → exit 2", `ran: ${long(n - 5)}`)],
    ["open bracket", 140, (n) => VALID.replace("data: src/store.js:42", `open: a) ${long(n - 9)}`)],
]) {
    test(`${what} may be ${limit} characters, not ${limit + 1}`, () => {
        assert.deepEqual(run(build(limit)).errors, []);
        const errors = run(build(limit + 1)).errors;
        assert.ok(errors.some((e) => e.includes(`is ${limit + 1} characters, max ${limit}`)), JSON.stringify(errors));
    });
}

// Inputs stay verbatim however long they get; everything else shares one budget.
const padRows = (n) => VALID + Array.from({ length: n }, (_, i) => `| B${i + 3} | \`src/pad${i}.js\` | ${"x".repeat(80)} (I2) | unchanged | C1 |\n`).join("");
const sizeOf = (text) => Buffer.byteLength(text) - Buffer.byteLength(text.slice(text.indexOf("## Inputs") + "## Inputs\n".length, text.indexOf("## Criteria")));

test("a blueprint over 2048 bytes without its inputs gets a warning, not an error", () => {
    let n = 0;
    while (sizeOf(padRows(n + 1)) <= 2048) n++;
    assert.deepEqual(run(padRows(n)).warnings, []);
    const over = run(padRows(n + 1));
    assert.deepEqual(over.errors, []);
    assert.equal(over.status, "ready");
    assert.ok(over.warnings.some((w) => /bytes without its inputs, aim for 2048 or less/.test(w)), JSON.stringify(over.warnings));
});

test("long inputs do not count against the size budget", () => {
    const longInput = VALID.replace("> don't touch the storage format", `> don't touch the storage format ${"y".repeat(8000)}`);
    assert.deepEqual(run(longInput).errors, []);
    assert.deepEqual(run(longInput).warnings, []);
});

for (const [name, from, to] of [
    ["a quoted input with blank quote lines", "  > add a --due flag so I can sort by due date", "  > add a --due flag\n  >\n  > so I can sort by due date"],
    ["a Mermaid flowchart under the boundaries", "| unchanged | C1 |\n", "| unchanged | C1 |\n\n```mermaid\nflowchart LR\n  A --> B\n```\n"],
    ["an Extracted date in the header", "Created: 2026-10-22", "Created: 2026-10-22 | Extracted: 2026-10-23"],
    ["a contract with a pipe in a code span", "argv → options;", "argv → `a | b`;"],
    ["a criterion settled by running a prediction", C1_EVIDENCE, "[ran: node -e 'Date.parse(x)' → ISO accepted]"],
    ["a recommendation the user accepted", C1_EVIDENCE, "[default: I2]"],
    ["a value the user stated", C1_EVIDENCE, "[user: I2]"],
    ["a run that contradicted its prediction", C2_EVIDENCE, "[ran: node src/cli.js --due x → exit 1; surprise: expected 2]"],
    ["two brackets on one criterion", C1_EVIDENCE, `${C1_EVIDENCE} [ran: node src/cli.js list --due → sorted]`],
    ["brackets inside a bracket", C1_EVIDENCE, "[ran: node -e 'console.log([2, 1].sort())' → [ 1, 2 ]]"],
    ["a bracket with a code span that holds a bracket", C1_EVIDENCE, "[ran: grep -c `[` src/store.js → 2]"],
    ["a stray bracket in the sentence", "earliest first.", "earliest first, ignoring a stray [."],
    ["a decided value and the existing-tests rule in one bracket", C1_EVIDENCE, "[ran: npm test with a → 73/6, with b → 79/0]"],
    ["a process rule in a bracket", C1_EVIDENCE, "[research: process-blueprint.md#quote-the-words-of-the-report]"],
    ["a process rule in a bracket as a markdown link", C1_EVIDENCE, "[research: [quote the words](process-blueprint.md#quote-the-words-of-the-report)]"],
    ["a link to the page of another phase", C1_EVIDENCE, "[research: process-replicate.md#restore-the-lines]"],
    ["a link with the wiki path in front", C1_EVIDENCE, "[research: orgs/acme/todo/process-blueprint.md#quote-the-words]"],
    ["an unchanged row backed by a run in its contract", "storage format unchanged (I2)", "storage format unchanged (I2, ran: node cli.js list → exit 0)"],
]) {
    test(`check accepts: ${name}`, () => {
        assert.ok(VALID.includes(from), `fixture lacks ${JSON.stringify(from)}`);
        assert.deepEqual(run(VALID.replace(from, to)).errors, []);
    });
}

for (const [name, text] of [
    ["a quote that differs in case and spacing", VALID.replace('"--due flag"', '"--DUE   Flag"')],
    ["a quote that spans a wrapped input line", VALID.replace("> add a --due flag so I can sort by due date", "> add a --due flag\n  > so I can sort by due date").replace('"--due flag"', '"flag so I can"')],
    ["parentheses inside a quote", VALID.replace("> add a --due flag so", "> add a --due flag (asap) so").replace('"--due flag"', '"flag (asap)"')],
    ["ids inside the quoted words", VALID.replace("> add a --due flag so I can sort by due date", "> add a --due flag so I can sort by due date, keep I2 and D3 intact").replace('(I1 "--due flag")', '(I1 "keep I2 and D3 intact")')],
    ["several origins", VALID.replace('(I1 "--due flag")', '(I1 "--due flag", I2 "storage format")')],
    ["a decision id inside a code span of the sentence", VALID.replace("the CLI shall exit", "the CLI shall exit (key `D1`)")],
]) {
    test(`check accepts: ${name}`, () => assert.deepEqual(run(text).errors, []));
}

test("check reports the Extracted date", () => {
    assert.equal(run(VALID.replace("Created: 2026-10-22", "Created: 2026-10-22 | Extracted: 2026-10-23")).extracted, "2026-10-23");
});

/* ── evidence brackets ── */

for (const [name, line, text, evidence] of [
    ["no bracket", "When a, b shall c.", "When a, b shall c.", []],
    ["one bracket", "When a, b shall c. [data: x.js:1]", "When a, b shall c.", ["[data: x.js:1]"]],
    ["two brackets, in order", "When a, b shall c. [data: x.js:1] [ran: t → 3/0]", "When a, b shall c.", ["[data: x.js:1]", "[ran: t → 3/0]"]],
    ["brackets inside a bracket", "When a, b shall c. [ran: f([1, 2]) → [3]]", "When a, b shall c.", ["[ran: f([1, 2]) → [3]]"]],
    ["a markdown link inside a bracket", "When a, b shall c. [research: [rule](process-blueprint.md#a)]", "When a, b shall c.", ["[research: [rule](process-blueprint.md#a)]"]],
    ["a code span that holds a bracket", "When a, b shall c. [ran: grep `[` f → 2]", "When a, b shall c.", ["[ran: grep `[` f → 2]"]],
    ["a stray bracket in the sentence", "When a [ is typed, b shall c. [data: x.js:1]", "When a [ is typed, b shall c.", ["[data: x.js:1]"]],
    ["a code span with a bracket in the sentence", "When `[` is typed, b shall c. [data: x.js:1]", "When `[` is typed, b shall c.", ["[data: x.js:1]"]],
    ["a markdown link at the end of the line", "When a, b shall c, see [spec](u).", "When a, b shall c, see [spec](u).", []],
    ["a bracket that is not closed", "When a, b shall c. [data: x.js:1", "When a, b shall c. [data: x.js:1", []],
    ["a bracket followed by text", "When a, b shall c. [data: x.js:1] and d.", "When a, b shall c. [data: x.js:1] and d.", []],
    ["a source off the ladder", "When a, b shall c. [wiki: x.md]", "When a, b shall c.", ["[wiki: x.md]"]],
]) {
    test(`evidenceOf: ${name}`, () => {
        const out = evidenceOf(line);
        assert.deepEqual([out.text, out.evidence.map((e) => e.raw)], [text, evidence]);
    });
}

test("evidenceOf reads the source of each bracket, and a source off the ladder as none", () => {
    assert.deepEqual(evidenceOf("x [Ran: t → 1] [open: a) 1 b) 2] [wiki: x.md] [data:]").evidence.map((e) => e.kind), ["ran", "open", null, null]);
});

/* ── open questions ── */

const OPEN_BRACKET = "[open: a) earliest first b) latest first; recommend a]";
const OPEN = VALID.replace(C1_EVIDENCE, OPEN_BRACKET);
const QUESTION = { id: "C1", question: "When the user passes `--due`, the list command shall print items sorted by due date, earliest first.", answer: "open: a) earliest first b) latest first; recommend a" };

for (const [name, text, status] of [
    ["no open question", VALID, "ready"],
    ["an open bracket", OPEN, "questions"],
    ["an open bracket next to other evidence", VALID.replace(C1_EVIDENCE, `${C1_EVIDENCE} ${OPEN_BRACKET}`), "questions"],
    ["an open bracket with a capital letter", OPEN.replace("[open:", "[Open:"), "questions"],
    ["errors win over open questions", OPEN.replace("(I2)", "(I9)"), "invalid"],
]) {
    test(`status: ${name}`, () => assert.equal(run(text).status, status));
}

test("an open bracket is reported as a question of its criterion, by check and by open()", () => {
    assert.deepEqual(run(OPEN).open, [QUESTION]);
    assert.deepEqual(open(OPEN), [QUESTION]);
    assert.deepEqual(run(VALID).open, []);
    assert.deepEqual(open(VALID), []);
});

test("open() lists the questions of every criterion that has one, in order", () => {
    const two = OPEN.replace(C2_EVIDENCE, "[open: a) exit 2 b) exit 1]");
    assert.deepEqual(open(two).map((q) => [q.id, q.answer]), [["C1", QUESTION.answer], ["C2", "open: a) exit 2 b) exit 1"]]);
});

/* ── evidence sources and process links ── */

for (const [name, extra, expected] of [
    ["one data bracket and one run", "", {}],
    ["wiki research counts as research and wiki", "[research: wiki/patterns/csv.md]", { research: 1, wiki: 1 }],
    ["a wiki page cited with a space still counts", '[research: wiki orgs/acme/todo/x.md "rule"]', { research: 1, wiki: 1 }],
    ["external research is not a wiki hit", "[research: https://example.com/spec]", { research: 1 }],
    ["a Wikipedia URL is not a wiki hit", "[research: https://en.wikipedia.org/wiki/Sorting]", { research: 1 }],
    ["a value the user stated", "[user: I2]", { user: 1 }],
    ["an accepted recommendation counts as default, not user", "[default: I2]", { default: 1 }],
    ["a run that matched its prediction", "[ran: node src/cli.js --due y → exit 2]", { ran: 2 }],
    ["a run that contradicted its prediction is a surprise", "[ran: node src/cli.js --due y → exit 1; surprise: expected 2]", { ran: 2, surprise: 1 }],
    ["an open question counts as no source", OPEN_BRACKET, {}],
]) {
    test(`check counts evidence sources: ${name}`, () => {
        assert.deepEqual(run(VALID.replace(C1_EVIDENCE, `${C1_EVIDENCE} ${extra}`.trim())).sources, { ran: 1, data: 1, research: 0, wiki: 0, user: 0, default: 0, surprise: 0, ...expected });
    });
}

const CITE = "process-blueprint.md#quote-the-words-of-the-report";

for (const [name, from, to, expected] of [
    ["no link", C1_EVIDENCE, C1_EVIDENCE, 0],
    ["a bare link", C1_EVIDENCE, `[research: ${CITE}]`, 1],
    ["a markdown link", C1_EVIDENCE, `[research: [rule](${CITE})]`, 1],
    ["a link in a data bracket", C1_EVIDENCE, `[data: src/store.js:7, ${CITE}]`, 1],
    ["two links in one bracket count one bracket", C1_EVIDENCE, `[research: ${CITE} and process-replicate.md#restore]`, 1],
    ["two brackets with a link", C1_EVIDENCE, `[research: ${CITE}] [research: [rule](${CITE})]`, 2],
    ["a link on the second criterion", C2_EVIDENCE, `${C2_EVIDENCE} [research: ${CITE}]`, 1],
    ["a link in the sentence is no citation", "earliest first.", `earliest first, see ${CITE}.`, 0],
    ["a file that only starts with the same letters", C1_EVIDENCE, "[data: src/preprocess-blueprint.md:3]", 0],
]) {
    test(`check counts the brackets that link a process rule: ${name}`, () => {
        assert.ok(VALID.includes(from), `fixture lacks ${JSON.stringify(from)}`);
        const out = run(VALID.replace(from, to));
        assert.deepEqual(out.errors, []);
        assert.equal(out.processCited, expected);
    });
}

/* ── applyEdit ── */

const rowsOf = (text) => ({ boundaries: parse(text).boundaries });

test("applyEdit keeps a blueprint that it reads back unchanged, and a second identical edit changes nothing", () => {
    const once = applyEdit(VALID, rowsOf(VALID));
    assert.equal(once.ok, true);
    assert.deepEqual(run(once.text).errors, []);
    assert.equal(once.text, VALID);
    assert.equal(applyEdit(once.text, rowsOf(once.text)).text, once.text);
});

test("applyEdit changes a contract and moves a row, keeping everything outside the table", () => {
    const { boundaries } = rowsOf(VALID);
    const edit = applyEdit(VALID, { boundaries: [boundaries[1], { ...boundaries[0], contract: "argv → options; bad value → exit 2" }] });
    assert.equal(edit.ok, true);
    assert.deepEqual(parse(edit.text).boundaries.map((b) => [b.id, b.contract]), [["B2", "items → file; storage format unchanged (I2)"], ["B1", "argv → options; bad value → exit 2"]]);
    assert.equal(edit.text.replace(/## Boundaries[\s\S]*$/, ""), VALID.replace(/## Boundaries[\s\S]*$/, ""));
});

test("applyEdit keeps a Mermaid block under the boundaries", () => {
    const withChart = `${VALID}\n\`\`\`mermaid\nflowchart LR\n  A --> B\n\`\`\`\n`;
    const { boundaries } = rowsOf(withChart);
    const edit = applyEdit(withChart, { boundaries: [{ ...boundaries[0], contract: "argv → options" }, boundaries[1]] });
    assert.equal(edit.ok, true);
    assert.ok(edit.text.includes("flowchart LR\n  A --> B"));
    assert.ok(edit.text.includes("argv → options |"));
});

test("applyEdit drops the Extracted date, since the extracted lessons no longer match", () => {
    const extracted = VALID.replace("Created: 2026-10-22", "Created: 2026-10-22 | Extracted: 2026-10-23");
    const edit = applyEdit(extracted, rowsOf(extracted));
    assert.equal(parse(edit.text).header.extracted, null);
});

test("applyEdit escapes a pipe outside a code span once, and leaves one inside a code span alone", () => {
    const { boundaries } = rowsOf(VALID);
    const first = applyEdit(VALID, { boundaries: [{ ...boundaries[0], contract: "a | b; `c | d`" }, boundaries[1]] });
    assert.equal(first.ok, true);
    assert.equal(parse(first.text).boundaries[0].contract, "a \\| b; `c | d`");
    assert.equal(applyEdit(first.text, rowsOf(first.text)).text, first.text);
});

for (const [name, edit, expected] of [
    ["a criterion left in no boundary", (b) => ({ boundaries: [{ ...b[0], criteria: ["C1"] }, b[1]] }), "C2 is in no boundary"],
    ["a boundary change outside the three words", (b) => ({ boundaries: [{ ...b[0], change: "rewritten" }, b[1]] }), "B1 change must be"],
    ["a duplicate boundary id", (b) => ({ boundaries: [b[0], { ...b[0] }, b[1]] }), "duplicate id B1"],
    ["an input no row traces any more", (b) => ({ boundaries: [b[0]] }), "I2 is not traced"],
    ["every row deleted", () => ({ boundaries: [] }), "missing section: ## Boundaries"],
]) {
    test(`applyEdit refuses ${name} and returns only the new errors`, () => {
        const r = applyEdit(VALID, edit(rowsOf(VALID).boundaries));
        assert.equal(r.ok, false);
        assert.ok(r.errors.some((e) => e.includes(expected)), JSON.stringify(r.errors));
    });
}

test("applyEdit lets an edit through on a blueprint that already has other errors", () => {
    const broken = VALID.replace("(I2)", "(I9)");
    const { boundaries } = rowsOf(broken);
    const r = applyEdit(broken, { boundaries: [{ ...boundaries[0], contract: "argv → options" }, boundaries[1]] });
    assert.equal(r.ok, true);
    assert.ok(check(r.text).errors.some((e) => e.includes("I2 is not traced")));
});

test("splitRow keeps pipes inside code spans", () => {
    assert.deepEqual(splitRow("| B1 | `a | b` | x |"), ["B1", "`a | b`", "x"]);
});

/* ── splits ── */

const CHILD_FILE = "2026-10-22-due-dates.sort.md";
const PARENT_HEADER = "Repo: acme/todo | Created: 2026-10-22 | Parent: 2026-10-22-due-dates.md";
const DELEGATING = `| B3 | \`${CHILD_FILE}\` | items → sorted items; missing date sorts last | new | C2 |`;
const PARENT = VALID.replace("| changed | C1, C2 |", "| changed | C1 |").replace("| unchanged | C1 |\n", `| unchanged | C1 |\n${DELEGATING}\n`);
const CHILD = `# Blueprint: due-dates.sort

${PARENT_HEADER}

## Inputs

- **I1** (2026-10-22 09:14):
  > add a --due flag so I can sort by due date
- **I2** (2026-10-22 09:20):
  > don't touch the storage format

## Criteria

- **C2** (I1 "--due flag"): When \`--due\` gets a value that is not a date, the CLI shall exit with code 2 and name the bad value. ${C2_EVIDENCE}

## Boundaries

| ID | Owner | Contract | Change | Criteria |
|----|-------|----------|--------|----------|
| B1 | \`src/store.js\` sortByDue | items → sorted items; missing date sorts last | new | C2 |
`;

test("a parent with a delegating row is valid: the row covers its criteria", () => {
    const r = run(PARENT);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.warnings, []);
    assert.deepEqual([r.parent, r.children], [null, [CHILD_FILE]]);
});

test("a child that copies the parent's inputs is valid and reports its parent", () => {
    const r = run(CHILD);
    assert.deepEqual(r.errors, []);
    assert.deepEqual([r.parent, r.children, r.counts.criteria], ["2026-10-22-due-dates.md", [], 1]);
});

for (const [name, text, errors] of [
    ["an input none of a child's items trace", CHILD, 0],
    ["the same input in a root", VALID.replace(" (I2)", ""), 1],
]) {
    test(`check on untraced inputs: ${name}`, () => assert.equal(run(text).errors.filter((e) => e.includes("I2 is not traced")).length, errors));
}

for (const [name, header, parent, extracted] of [
    ["a parent", "Repo: acme/todo | Created: 2026-10-22 | Parent: bp.md", "bp.md", null],
    ["a parent, then Extracted", "Repo: acme/todo | Created: 2026-10-22 | Parent: bp.md | Extracted: 2026-10-23", "bp.md", "2026-10-23"],
    ["no parent", "Repo: acme/todo | Created: 2026-10-22", null, null],
]) {
    test(`check reads the header with ${name}`, () => {
        const r = run(VALID.replace("Repo: acme/todo | Created: 2026-10-22", header));
        assert.deepEqual([r.errors, r.parent, r.extracted], [[], parent, extracted]);
    });
}

test("check rejects Extracted before Parent in the header", () => {
    const r = run(VALID.replace("Created: 2026-10-22", "Created: 2026-10-22 | Extracted: 2026-10-23 | Parent: bp.md"));
    assert.ok(r.errors.some((e) => e.includes("missing header")), JSON.stringify(r.errors));
});

for (const [owner, children] of [
    [`\`${CHILD_FILE}\``, [CHILD_FILE]],
    ["`docs/due-dates.sort.md`", []],
    ["`CHANGELOG.md`", []],
    [`\`${CHILD_FILE}\` section`, []],
    ["`src/store.js` sortByDue", []],
]) {
    test(`check takes ${owner} ${children.length ? "as a delegating row" : "for an ordinary owner"}`, () => {
        assert.deepEqual(run(PARENT.replace(`\`${CHILD_FILE}\``, owner)).children, children);
    });
}

for (const [name, siblings, errors] of [
    ["the child is not looked for without a directory listing", null, []],
    ["the child is there", [CHILD_FILE, "other.md"], []],
    ["the child is missing", ["other.md"], [`B3 delegates to ${CHILD_FILE}, which does not exist next to the blueprint`]],
]) {
    test(`check with siblings: ${name}`, () => assert.deepEqual(check(PARENT, placeholders(TEMPLATE), siblings).errors, errors));
}

test("checkFile and the check command look for the child file next to the blueprint", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bp-split-"));
    const file = path.join(dir, "2026-10-22-due-dates.md");
    writeFileSync(file, PARENT);
    const cli = () => spawnSync(process.execPath, [SCRIPT, "check", file], { encoding: "utf8" });
    assert.equal(cli().status, 1);
    assert.ok(checkFile(file).errors.some((e) => e.includes(`B3 delegates to ${CHILD_FILE}`)));
    writeFileSync(path.join(dir, CHILD_FILE), CHILD);
    assert.deepEqual(checkFile(file).errors, []);
    const out = cli();
    assert.equal(out.status, 0);
    assert.deepEqual(JSON.parse(out.stdout).children, [CHILD_FILE]);
});

test("applyEdit keeps a delegating row and the Parent header, and drops only the Extracted date", () => {
    const child = CHILD.replace("Parent: 2026-10-22-due-dates.md", "Parent: 2026-10-22-due-dates.md | Extracted: 2026-10-23");
    const edit = applyEdit(child, rowsOf(child));
    assert.equal(edit.ok, true);
    assert.deepEqual([parse(edit.text).header.parent, parse(edit.text).header.extracted], ["2026-10-22-due-dates.md", null]);
    const parent = applyEdit(PARENT, rowsOf(PARENT));
    assert.deepEqual(parent.ok && parse(parent.text).boundaries.map((b) => b.child), [null, null, CHILD_FILE]);
    assert.equal(applyEdit(parent.text, rowsOf(parent.text)).text, parent.text);
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
    ["inspect.py", false],
    ["latest.py", false],
    ["contest/x.py", false],
    ["src/respect.js", false],
    ["src/specimen/a.js", false],
    ["src/Latest.java", false],
    ["tests/x.py", true],
    ["a/b/tests/test_x.py", true],
    ["x_test.go", true],
    ["foo.test.mjs", true],
    ["spec/a_spec.rb", true],
    ["src/__tests__/a.js", true],
    ["app/tests.py", true],
    ["conftest.py", true],
    ["src/Tests/A.cs", true],
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

/* ── diff ── */

const gitIn = (dir, ...args) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir, encoding: "utf8" });

function committedRepo(files) {
    const dir = repoWith({ ".gitignore": "build/\n", ...files });
    gitIn(dir, "add", "-A");
    gitIn(dir, "commit", "-q", "-m", "base");
    return dir;
}

test("addedLines reads the new line numbers of each file from a zero-context diff", () => {
    const unified = ["diff --git a/x.js b/x.js", "--- a/x.js", "+++ b/x.js", "@@ -2,0 +3,2 @@", "+a", "+b", "@@ -9 +11 @@", "-old", "+new", "diff --git a/gone.js b/gone.js", "--- a/gone.js", "+++ /dev/null", "@@ -1 +0,0 @@", "-x"].join("\n");
    assert.deepEqual(Object.fromEntries(Object.entries(addedLines(unified)).map(([f, s]) => [f, [...s]])), { "x.js": [3, 4, 11] });
});

const BLOCK = ["const a = load(file);", "if (!a.ok) throw new Error(a.reason);", "const rows = a.rows.filter(keep);", "return rows.map(format);"];
const all = (text) => new Set(text.split("\n").map((_, i) => i + 1));

for (const [name, contents, added, expected] of [
    ["a block copied into a second file", { "a.js": BLOCK.join("\n"), "b.js": BLOCK.join("\n") }, { "b.js": all(BLOCK.join("\n")) }, ["b.js:1", "a.js:1"]],
    ["a block repeated in the same file", { "a.js": [...BLOCK, "", ...BLOCK].join("\n") }, { "a.js": new Set([6, 7, 8, 9]) }, ["a.js:6", "a.js:1"]],
    ["braces and blank lines between the copied lines", { "a.js": BLOCK.join("\n"), "b.js": BLOCK.join("\n\n}\n") }, { "b.js": all(BLOCK.join("\n\n}\n")) }, ["b.js:1", "a.js:1"]],
]) {
    test(`duplicates finds ${name}`, () => assert.deepEqual(duplicates(contents, added).map((d) => d.at), [expected]));
}

for (const [name, contents, added] of [
    ["three copied lines, below the block size", { "a.js": BLOCK.slice(0, 3).join("\n"), "b.js": BLOCK.slice(0, 3).join("\n") }, { "b.js": new Set([1, 2, 3]) }],
    ["a copy that already existed before the change", { "a.js": BLOCK.join("\n"), "b.js": BLOCK.join("\n") }, {}],
    ["repeated imports and closing braces", { "a.js": "import a from 'a';\nimport b from 'b';\n}\n}\n});\n", "b.js": "import a from 'a';\nimport b from 'b';\n}\n}\n});\n" }, { "b.js": new Set([1, 2, 3, 4, 5]) }],
]) {
    test(`duplicates ignores ${name}`, () => assert.deepEqual(duplicates(contents, added), []));
}

test("diff counts tracked and untracked lines against HEAD and reports a copied block", () => {
    const dir = committedRepo({ "src/a.js": `${BLOCK.join("\n")}\n`, "src/old.js": "one\ntwo\n", "test/old.test.js": "assert(1)\nassert(2)\nassert(3)\n" });
    writeFileSync(path.join(dir, "src", "old.js"), "one\nthree\nfour\n");
    writeFileSync(path.join(dir, "test", "old.test.js"), "assert(1)\n");
    writeFileSync(path.join(dir, "src", "b.js"), `${BLOCK.join("\n")}\n`);
    mkdirSync(path.join(dir, "build"), { recursive: true });
    writeFileSync(path.join(dir, "build", "out.js"), "ignored\n");
    const out = diff(dir);
    assert.deepEqual(out.files, [{ file: "src/b.js", added: 4, removed: 0 }, { file: "src/old.js", added: 2, removed: 1 }, { file: "test/old.test.js", added: 0, removed: 2 }]);
    assert.equal(out.added, 6);
    assert.equal(out.removed, 3);
    assert.equal(out.testLinesRemoved, 2);
    assert.deepEqual(out.testFiles, ["test/old.test.js"]);
    assert.deepEqual(out.duplicates.map((d) => d.at), [["src/b.js:1", "src/a.js:1"]]);
});

test("diff command prints the diff, and reports a directory that is not a git repository", () => {
    const dir = committedRepo({ "a.txt": "one\n" });
    writeFileSync(path.join(dir, "a.txt"), "one\ntwo\n");
    const ok = spawnSync(process.execPath, [SCRIPT, "diff", "--repo", dir], { encoding: "utf8" });
    assert.equal(ok.status, 0);
    assert.deepEqual(JSON.parse(ok.stdout).files, [{ file: "a.txt", added: 1, removed: 0 }]);
    const plain = mkdtempSync(path.join(tmpdir(), "bp-nogit-"));
    const bad = spawnSync(process.execPath, [SCRIPT, "diff", "--repo", plain], { encoding: "utf8", env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(plain) } });
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
