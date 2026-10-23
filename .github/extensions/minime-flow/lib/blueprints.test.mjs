import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
    isBlueprintFilename,
    listOpenBlueprints,
    needsInputFromBlueprint,
    parseBlueprint,
    readBlueprint,
} from "./blueprints.mjs";

const HEADER = "Repo: acme/todo | Created: 2026-10-22";
const D1 = "| D1 | Date format? | ISO 8601 | data: src/store.js:42 |";
const OPEN = "| D2 | Max rate? | open: a) 10/s b) 100/s; recommend a | user: pending |";

const CURRENT = `# Blueprint: due dates

${HEADER}

## Inputs

- **I1** (2026-10-22 09:14):
  > add a --due flag so I can sort by due date
  > keep the list output stable
- **I2** (2026-10-22 09:20):
  > don't touch the storage format

## Criteria

- **C1** (I1 "sort by due date"): When the user passes \`--due\`, the list command shall print items sorted by due date, earliest first.
- **C2** (I1 "--due flag", I2 "storage format", D1): When \`--due\` gets a value that is not a date (the CLI), it shall exit with code 2 and name the bad value.

## Boundaries

| ID | Owner | Contract | Change | Criteria |
|----|-------|----------|--------|----------|
| B1 | \`src/cli.js\` parseArgs | argv → options; unknown value → exit 2 | changed | C1, C2 |

## Decisions

| ID | Question | Answer | Source |
|----|----------|--------|--------|
${D1}

## Constraints

- Storage format stays unchanged (I2)

## Out of scope

None.
`;

const LEGACY = `# Blueprint: Native integration

Created: 2026-09-16 07:16 +02:00 | Status: implementing | Repo: acme/repo

## Goal

Keep this file as the source of truth.

## Active criteria

- [x] C0-7 Apply correction waits for worker boundary. | VOI: decided-by-data
- [ ] C0-9 Native subagent lifecycle is displayed with model evidence. | VOI: decided-by-data

## Criteria archive

- [x] Older accepted criterion.
`;

const withDecision = (row) => CURRENT.replace(D1, `${D1}\n${row}`);
const extracted = CURRENT.replace(HEADER, `${HEADER} | Extracted: 2026-10-23`);

for (const [name, markdown, status, isOpen] of [
    ["no open decision", CURRENT, "ready", true],
    ["an open answer", withDecision(OPEN), "questions", true],
    ["a user decision still pending", withDecision("| D2 | Max rate? | 10/s | user: pending |"), "questions", true],
    ["an Extracted date closes it", extracted, "extracted", false],
]) {
    test(`current format status: ${name}`, () => {
        const model = parseBlueprint(markdown, "2026-10-22-due.md");
        assert.equal(model.status, status);
        assert.equal(model.isOpen, isOpen);
    });
}

test("current format model carries title, goal, criteria and the extraction date", () => {
    const model = parseBlueprint(extracted, "2026-10-22-due.md", {}, "/hq/acme/_todo/blueprints/2026-10-22-due.md");
    assert.equal(model.format, "blueprint");
    assert.equal(model.title, "due dates");
    assert.equal(model.path, "/hq/acme/_todo/blueprints/2026-10-22-due.md");
    assert.equal(model.goal, "add a --due flag so I can sort by due date\nkeep the list output stable");
    assert.deepEqual(model.criteria.map(({ id, inputs }) => [id, inputs]), [["C1", ["I1"]], ["C2", ["I1", "I2"]]]);
    assert.match(model.criteria[1].text, /^When `--due` gets a value that is not a date \(the CLI\)/);
    assert.equal(model.extracted, "2026-10-23");
    assert.equal(parseBlueprint(CURRENT, "x.md").extracted, null);
});

test("open decisions list the question and the options", () => {
    assert.deepEqual(parseBlueprint(withDecision(OPEN), "x.md").openDecisions, [
        { id: "D2", question: "Max rate?", answer: "open: a) 10/s b) 100/s; recommend a" },
    ]);
    assert.deepEqual(parseBlueprint(CURRENT, "x.md").openDecisions, []);
});

for (const [name, blueprint, expected] of [
    ["the first open decision", parseBlueprint(withDecision(OPEN), "x.md"), { id: "D2", question: "Max rate?" }],
    ["no open decision", parseBlueprint(CURRENT, "x.md"), null],
    ["a legacy blueprint", parseBlueprint(LEGACY, "x.blueprint.md"), null],
    ["no blueprint", null, null],
]) {
    test(`needs input from blueprint: ${name}`, () => {
        assert.deepEqual(needsInputFromBlueprint(blueprint), expected);
    });
}

test("legacy blueprints keep parsing, and a criteria archive does not make them current", () => {
    const model = parseBlueprint(LEGACY, "2026-09-16-native.blueprint.md");
    assert.equal(model.format, "legacy");
    assert.equal(model.title, "Native integration");
    assert.equal(model.status, "implementing");
    assert.equal(model.goal, "Keep this file as the source of truth.");
    assert.deepEqual(model.criteria.map(({ id, complete }) => [id, complete]), [["C0-7", true], ["C0-9", false]]);
    assert.deepEqual(model.progress, { completed: 1, total: 2 });
    assert.equal(model.isOpen, true);
});

for (const [name, expected] of [
    ["2026-10-22-due.md", true],
    ["2026-09-16-native.blueprint.md", true],
    ["notes.txt", false],
    ["2026-10-22-due.md.tmp", false],
    ["2026-10-22-due.runs", false],
    [undefined, false],
]) {
    test(`isBlueprintFilename(${name})`, () => assert.equal(isBlueprintFilename(name), expected));
}

async function blueprintRoot(label, files) {
    const root = resolve(".github/extensions/minime-flow/lib/.test-work", `${label}-${randomUUID()}`);
    await mkdir(root, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
        await mkdir(resolve(root, name, ".."), { recursive: true });
        await writeFile(resolve(root, name), content, "utf8");
    }
    return root;
}

test("lists open blueprints of both formats and ignores run logs, drafts and other files", async (t) => {
    const root = await blueprintRoot("list", {
        "2026-10-22-due.md": CURRENT,
        "2026-10-21-done.md": extracted,
        "2026-09-16-native.blueprint.md": LEGACY,
        "2026-10-22-due.runs/inspect.md": "# Inspect findings\n",
        ".drafts/session.json": "{}",
        "notes.txt": "not a blueprint",
    });
    t.after(() => rm(root, { recursive: true, force: true }));
    assert.deepEqual(listOpenBlueprints(root).map((item) => item.filename).sort(), [
        "2026-09-16-native.blueprint.md",
        "2026-10-22-due.md",
    ]);
});

for (const filename of ["../2026-10-22-due.md", "sub/2026-10-22-due.md", "notes.txt", "2026-10-22-due.md\0"]) {
    test(`readBlueprint rejects ${JSON.stringify(filename)}`, async (t) => {
        const root = await blueprintRoot("reject", { "2026-10-22-due.md": CURRENT });
        t.after(() => rm(root, { recursive: true, force: true }));
        assert.throws(() => readBlueprint(root, filename), { status: 400, message: "Invalid blueprint name." });
    });
}

test("readBlueprint reads a current blueprint by its date-prefixed name", async (t) => {
    const root = await blueprintRoot("read", { "2026-10-22-due.md": CURRENT });
    t.after(() => rm(root, { recursive: true, force: true }));
    const { model } = readBlueprint(root, "2026-10-22-due.md");
    assert.equal(model.title, "due dates");
    assert.equal(model.format, "blueprint");
});

// The canvas parser is a second implementation of the blueprint file format, so it is checked against the tool that writes it.
const TOOL = "../../../../skills/blueprint/scripts/blueprint.mjs";
for (const [name, markdown] of [
    ["ready", CURRENT],
    ["questions", withDecision(OPEN)],
    ["extracted", extracted],
]) {
    test(`canvas parser agrees with blueprint.mjs check: ${name}`, async (t) => {
        const tool = await import(TOOL).catch(() => null);
        if (!tool) return t.skip("skills/blueprint is not next to this extension");
        const expected = tool.check(markdown);
        assert.deepEqual(expected.errors, []);
        const model = parseBlueprint(markdown, "2026-10-22-due.md");
        assert.equal(model.status === "extracted" ? "ready" : model.status, expected.status);
        assert.equal(model.extracted, expected.extracted);
        assert.deepEqual(model.openDecisions.map(({ id }) => id), expected.open.map(({ id }) => id));
        assert.deepEqual(model.criteria.map(({ id }) => id), tool.parse(markdown).criteria.map(({ id }) => id));
    });
}
