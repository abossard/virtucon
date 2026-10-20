import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
const { repo } = globalThis.__probe;
const F = "`".repeat(3);
const L = (...lines) => lines.join("\n");
const tree = (dir) => Object.fromEntries(fs.readdirSync(dir, { recursive: true }).sort().map((f) => {
  const p = path.join(dir, f);
  return [f, fs.statSync(p).isFile() ? crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex") : "dir"];
}));
const cli = (cwd, ...args) => spawnSync(process.execPath, [`${repo}/bin/diagrammo.mjs`, ...args], { cwd, encoding: "utf8" });
const span = (slug, ...body) => [`<!-- diagrammo:sync ${slug} -->`, `![${slug}](out/${slug}.svg)`, "", "<!-- diagrammo:source", ...body, "-->", `<!-- /diagrammo:sync ${slug} -->`];
const fresh = (files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "h2cli-"));
  fs.mkdirSync(path.join(dir, "out"));
  fs.writeFileSync(path.join(dir, "out", "a.svg"), "<svg>a</svg>");
  for (const [n, s] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), s);
  return dir;
};
const good1 = L("one", "", ...span("a", F + "mermaid", "graph TD", "x--&gt;y", F), "");
const good1Restored = L("one", "", F + "mermaid", "graph TD", "x-->y", F, "");
const good2 = L("two", ...span("b", F + "mermaid", "graph LR", "p--&gt;q", F)).replaceAll("\n", "\r\n");
const good2Restored = L("two", F + "mermaid", "graph LR", "p-->q", F).replaceAll("\n", "\r\n");
const plain = L("# plain", "", F + "mermaid", "graph TD", "a-->b", F, "");
const bad = L("<!-- diagrammo:sync z -->", "no fence", "<!-- /diagrammo:sync z -->", "");

let dir = fresh({ "1.md": good1, "2.md": good2, "p.md": plain });
const svgBefore = fs.readFileSync(path.join(dir, "out", "a.svg"), "utf8");
let r = cli(dir, "--restore-markdown", "1.md", "2.md", "p.md");
assert.equal(r.status, 0, r.stderr);
assert.equal(fs.readFileSync(path.join(dir, "1.md"), "utf8"), good1Restored);
assert.equal(fs.readFileSync(path.join(dir, "2.md"), "utf8"), good2Restored);
assert.equal(fs.readFileSync(path.join(dir, "p.md"), "utf8"), plain);
assert.equal(fs.readFileSync(path.join(dir, "out", "a.svg"), "utf8"), svgBefore, "existing SVG untouched");
assert.deepEqual(Object.keys(tree(dir)).sort(), ["1.md", "2.md", "out", "out/a.svg", "p.md"], "no new artifacts, directories or temp files");
const afterFirst = tree(dir);
r = cli(dir, "--restore-markdown", "1.md", "2.md", "p.md");
assert.equal(r.status, 0, r.stderr);
assert.deepEqual(tree(dir), afterFirst, "second restore is byte-identical");

dir = fresh({ "1.md": good1, "bad.md": bad, "2.md": good2 });
let before = tree(dir);
r = cli(dir, "--restore-markdown", "1.md", "bad.md", "2.md");
assert.equal(r.status, 1);
assert.deepEqual(tree(dir), before, "late invalid input leaves every file unchanged");

dir = fresh({ "1.md": good1, "dup.md": good1.replace("one", "dup") });
before = tree(dir);
r = cli(dir, "--restore-markdown", "1.md", "dup.md");
assert.equal(r.status, 1, "duplicate managed slug across files");
assert.deepEqual(tree(dir), before);

dir = fresh({ "1.md": good1 });
before = tree(dir);
r = cli(dir, "--restore-markdown", "1.md", "missing.md");
assert.equal(r.status, 1, "unreadable input fails the batch");
assert.deepEqual(tree(dir), before);

for (const extra of [["--list"], ["--sync-markdown"], ["-o", "x"], ["--out", "x"], ["-t", "midnight"], ["--theme", "midnight"], ["-r", "swimlane"], ["--renderer", "swimlane"], ["--image-format", "learn"], ["--check-sync"]]) {
  dir = fresh({ "1.md": good1 });
  before = tree(dir);
  r = cli(dir, "--restore-markdown", "1.md", ...extra);
  assert.notEqual(r.status, 0, `rejects ${extra.join(" ")}`);
  assert.deepEqual(tree(dir), before, `${extra.join(" ")} leaves files unchanged`);
}
