// Wiki lint against the schema page rules.
// Run: node --test  (from this directory)

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LIMITS, lint, lintCitations, linksTo } from "./wiki-lint.mjs";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "wiki-lint.mjs");

const PAGE = `# Due dates

- **Summary:** Agents compare due dates in local time.
- **Read when:** changing due-date handling
- **Scope:** \`acme/todo\` \`src/**\`
- **LastVerified:** 2026-10-22

## Rules

### Compare due dates as YYYY-MM-DD strings
Dates carry no time or zone, so string order is date order.
- **Evidence:** \`src/store.js:3\` · [source](../../../../raw/acme/todo/due-2026-10-22.md)
- **Origin:** observation
`;

const FILES = {
    "wiki/index.md": "# Wiki index\n\n## Repositories\n- [acme/todo](./orgs/acme/todo/index.md): CLI\n\n## Patterns\n- [CSV](./patterns/csv.md): exports\n",
    "wiki/log.md": "# Wiki log\n- 2026-10-22 extract acme/todo: added due-date rule\n- 2026-10-01 reorg _global: rebuilt patterns\n",
    "wiki/orgs/acme/todo/index.md": "# acme/todo\n\n## Pages\n- [Due dates](./due.md): Read when changing due-date handling.\n",
    "wiki/orgs/acme/todo/due.md": PAGE,
    "wiki/patterns/csv.md": PAGE.replace("# Due dates", "# CSV").replace("../../../../raw", "../../raw"),
    "raw/acme/todo/due-2026-10-22.md": "> user quote\n",
};

function makeHq(edit) {
    const hq = mkdtempSync(path.join(tmpdir(), "wiki-"));
    for (const [rel, text] of Object.entries(FILES)) {
        mkdirSync(path.dirname(path.join(hq, rel)), { recursive: true });
        writeFileSync(path.join(hq, rel), text);
    }
    edit?.({
        write: (rel, text) => {
            mkdirSync(path.dirname(path.join(hq, rel)), { recursive: true });
            writeFileSync(path.join(hq, rel), text);
        },
        change: (rel, fn) => writeFileSync(path.join(hq, rel), fn(readFileSync(path.join(hq, rel), "utf8"))),
        remove: (rel) => rmSync(path.join(hq, rel)),
    });
    return hq;
}

const DUE = "wiki/orgs/acme/todo/due.md";
const LOG = "wiki/log.md";
const rules = (hq, ...paths) => lint(hq, paths).errors.map((e) => e.rule);

test("a conforming wiki has no violations", () => {
    const out = lint(makeHq());
    assert.deepEqual(out.errors, []);
    assert.equal(out.checked, 5);
});

for (const [name, rule, edit] of [
    ["page over the size limit", "size", (h) => h.change(DUE, (t) => t + "x".repeat(LIMITS.bytes))],
    ["page over the line limit", "lines", (h) => h.change(DUE, (t) => t + "\n".repeat(LIMITS.lines))],
    ["page over the rule limit", "rules", (h) => h.change(DUE, (t) => t + "\n### r\ny\n- **Evidence:** e\n- **Origin:** observation\n".repeat(LIMITS.rules))],
    ["missing Read when", "header", (h) => h.change(DUE, (t) => t.replace("- **Read when:** changing due-date handling\n", ""))],
    ["LastVerified without a date", "header", (h) => h.change(DUE, (t) => t.replace("2026-10-22", "yesterday"))],
    ["rule without Evidence", "evidence", (h) => h.change(DUE, (t) => t.replace(/- \*\*Evidence:\*\*.*\n/, ""))],
    ["rule with an unknown Origin", "origin", (h) => h.change(DUE, (t) => t.replace("observation", "hunch"))],
    ["Status outside active, stale or superseded", "status", (h) => h.change(DUE, (t) => t + "- **Status:** old\n")],
    ["em dash in a page", "em-dash", (h) => h.change(DUE, (t) => t + "a — b\n")],
    ["broken relative link", "link", (h) => h.remove("raw/acme/todo/due-2026-10-22.md")],
    ["page missing from its scope index", "index", (h) => h.change("wiki/orgs/acme/todo/index.md", (t) => t.replace("due.md", "other.md"))],
    ["scope without an index", "index", (h) => h.remove("wiki/orgs/acme/todo/index.md")],
    ["scope missing from the global index", "index", (h) => h.change("wiki/index.md", (t) => t.replace("./orgs/acme/todo/index.md", "./elsewhere.md"))],
    ["pattern missing from the global index", "index", (h) => h.change("wiki/index.md", (t) => t.replace("./patterns/csv.md", "./patterns/other.md"))],
    ["log at the line limit", "log-size", (h) => h.change(LOG, (t) => t + "- 2026-09-01 lint _global: n\n".repeat(LIMITS.logLines))],
    ["log entry in free form", "log-format", (h) => h.change(LOG, (t) => t + "- did some stuff\n")],
    ["log entry over the word limit", "log-words", (h) => h.change(LOG, (t) => t + `- 2026-09-01 lint _global: ${"word ".repeat(LIMITS.logWords + 1)}\n`)],
    ["log entry newer than the one above", "log-order", (h) => h.change(LOG, (t) => t + "- 2026-11-01 lint _global: later\n")],
]) {
    test(`reports ${rule}: ${name}`, () => {
        assert.ok(rules(makeHq(edit)).includes(rule));
    });
}

for (const [value, ok] of [
    ["active", true],
    ["stale", true],
    ["superseded by [Other rule](./x.md#other-rule)", true],
    ["superseded", false],
    ["supersedes the old rule", false],
]) {
    test(`Status "${value}" is ${ok ? "accepted" : "rejected"}`, () => {
        const hq = makeHq((h) => h.change(DUE, (t) => t + `- **Status:** ${value}\n`));
        assert.equal(rules(hq, "orgs/acme/todo").includes("status"), !ok);
    });
}

test("paths limit what is checked", () => {
    const hq = makeHq((h) => h.change(LOG, (t) => t + "- did some stuff\n"));
    assert.deepEqual(rules(hq, "orgs/acme/todo"), []);
    assert.deepEqual(rules(hq, "log.md"), ["log-format"]);
});

test("a path selects a whole directory, not a name prefix", () => {
    const hq = makeHq((h) => h.write("wiki/orgs/acme/todo-extra/x.md", "broken"));
    assert.deepEqual(rules(hq, "orgs/acme/todo"), []);
});

test("an external link to a .md file is not resolved as a path", () => {
    const hq = makeHq((h) => h.change(DUE, (t) => t + "See [spec](https://example.com/spec.md).\n"));
    assert.deepEqual(rules(hq, "orgs/acme/todo"), []);
});

for (const [index, target, expected] of [
    ["- [A](./due.md): x", "due.md", true],
    ["- [A](due.md#rule): x", "due.md", true],
    ["- [A](./due.md.bak): x", "due.md", false],
    ["- [A](./xdue.md): x", "due.md", false],
]) {
    test(`linksTo(${index}, ${target})`, () => assert.equal(linksTo(index, target), expected));
}

const SOURCE = ["export function main() {", "    return 1;", "}", "", "export function other() {", "    return 2;", "}", "", "x", "x", "x", "x", "x", "x", "x", "x", "x", "x"].join("\n");
const readSource = (rel) => (rel === "src/a.js" ? SOURCE : null);

for (const [name, citation, expected] of [
    ["a line inside the file", "`src/a.js:2`", []],
    ["a range inside the file", "`src/a.js:1-3` (`main`)", []],
    ["a symbol within the window", "`src/a.js:4` (`main`)", []],
    ["a symbol past the window", "`src/a.js:14` (`main`)", ["cite"]],
    ["a line past the end", "`src/a.js:99`", ["cite"]],
    ["a missing file", "`src/gone.js:1`", ["cite"]],
    ["a citation without a line", "`src/gone.js`", []],
    ["a rule citation that is not a path", "`user decision`", []],
]) {
    test(`lintCitations: ${name}`, () => {
        assert.deepEqual(lintCitations(`- **Evidence:** ${citation} \u00b7 [source](x.md)`, readSource).map((e) => e.rule), expected);
    });
}

test("--repo checks citations in topic pages against the checkout and ignores the rest", () => {
    const repo = mkdtempSync(path.join(tmpdir(), "repo-"));
    mkdirSync(path.join(repo, "src"));
    writeFileSync(path.join(repo, "src", "store.js"), "a\nb\nc\nd\n");
    const hq = makeHq((h) => h.change(DUE, (t) => t.replace("`src/store.js:3`", "`src/store.js:3`, `src/store.js:40`, `../outside.js:1`")));
    const out = lint(hq, ["orgs/acme/todo"], { repo });
    assert.deepEqual(out.errors.map((e) => [e.rule, e.message.slice(0, 40)]), [["cite", "src/store.js:40 is past the end of the f"], ["cite", "../outside.js does not exist in the chec"]]);
    assert.deepEqual(rules(hq, "orgs/acme/todo"), []);
});

test("CLI prints JSON and exits 1 on violations, 0 when clean, 2 without a wiki", () => {
    const run = (hq, ...a) => spawnSync(process.execPath, [SCRIPT, hq, ...a], { encoding: "utf8" });
    const clean = run(makeHq());
    assert.equal(clean.status, 0);
    assert.equal(JSON.parse(clean.stdout).total, 0);
    const dirty = run(makeHq((h) => h.change(DUE, (t) => t + "a — b\n")));
    assert.equal(dirty.status, 1);
    assert.deepEqual(JSON.parse(dirty.stdout).byRule, { "em-dash": 1 });
    assert.equal(run(path.join(tmpdir(), "no-such-hq")).status, 2);
    const withRepo = spawnSync(process.execPath, [SCRIPT, makeHq(), "orgs/acme/todo", "--repo", tmpdir()], { encoding: "utf8" });
    assert.equal(withRepo.status, 1);
    assert.deepEqual(Object.keys(JSON.parse(withRepo.stdout).byRule), ["cite"]);
    assert.equal(spawnSync(process.execPath, [SCRIPT, makeHq(), "--repo"], { encoding: "utf8" }).status, 2);
});
