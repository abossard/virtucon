import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
const { repo } = globalThis.__probe;
const { inventoryDocuments } = await import(`${repo}/src/index.mjs`);
const fence = "`".repeat(3);
const tree = (dir) => Object.fromEntries(fs.readdirSync(dir, { recursive: true }).sort().map((f) => {
  const p = path.join(dir, f);
  return [f, fs.statSync(p).isFile() ? crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex") : "dir"];
}));
const cli = (cwd, ...args) => spawnSync(process.execPath, [`${repo}/bin/diagrammo.mjs`, ...args], { cwd, encoding: "utf8" });

const files = {
  "a.md": ["## Checkout", "", fence + 'mermaid swimlane theme=midnight title="Hi"', "flowchart BT",
    '    a["A<br/>healthy"] --> b["B<br/>healthy"]', fence, "", "## Plain", fence + "mermaid", "graph TD", "x-->y", fence, ""].join("\n"),
  "m.md": ["# Doc", "", "<!-- diagrammo:sync orders -->", "![Orders](out/orders.svg)", "", "<!-- diagrammo:source", fence + "mermaid",
    "flowchart BT", '    a["A<br/>healthy"] --&gt; b["B<br/>healthy"]', "    classDef green fill:#f2f8f2,stroke:#a0d8a0;",
    "    class a,b green;", fence, "-->", "<!-- /diagrammo:sync orders -->", ""].join("\n"),
  "c.md": ["# Nothing", "", "text only", ""].join("\n"),
};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "h1cli-"));
for (const [n, s] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), s);
const before = tree(dir);

const json = cli(dir, "--list", "--format", "json", "a.md", "m.md", "c.md");
assert.equal(json.status, 0, json.stderr);
const parsed = JSON.parse(json.stdout);
assert.equal(parsed.schemaVersion, 1);
assert.deepEqual(parsed.documents.map((d) => d.name), ["a.md", "m.md", "c.md"]);
const expected = inventoryDocuments(Object.entries(files).map(([name, source]) => ({ name, source })), { theme: "portal", renderer: "auto" });
const pick = (inv) => inv.documents.map((d) => ({ name: d.name, blocks: d.blocks.map((b) => [b.slug, b.line, b.closeLine, b.location, b.renderer, b.effectiveOptions.theme, b.effectiveOptions.title]), diagnostics: d.diagnostics }));
assert.deepEqual(pick(parsed), pick(JSON.parse(JSON.stringify(expected))), "CLI JSON agrees with the API projection");
assert.deepEqual(parsed.documents[0].blocks.map((b) => b.slug), ["hi", "plain"]);
assert.deepEqual(parsed.documents[1].blocks[0].location, { beginLine: 3, endLine: 14 });
assert.deepEqual(parsed.documents[2].blocks, []);
assert.deepEqual(tree(dir), before, "no file or directory created or changed");

const textDefault = cli(dir, "--list", "a.md", "m.md", "c.md");
const textExplicit = cli(dir, "--list", "--format", "text", "a.md", "m.md", "c.md");
assert.equal(textDefault.status, 0);
assert.equal(textExplicit.status, 0);
assert.equal(textExplicit.stdout, textDefault.stdout);
assert.match(textDefault.stdout, /a\.md: 2 mermaid blocks/);
assert.throws(() => JSON.parse(textDefault.stdout));

const withSync = cli(dir, "--list", "--format", "json", "--sync-markdown", "-o", "never", "a.md", "m.md");
assert.equal(withSync.status, 0, withSync.stderr);
assert.equal(JSON.parse(withSync.stdout).documents.length, 2);
assert.deepEqual(tree(dir), before, "JSON inventory never renders, syncs or creates an output directory");
assert.ok(!fs.existsSync(path.join(dir, "never")) && !fs.existsSync(path.join(dir, "diagrams")));
