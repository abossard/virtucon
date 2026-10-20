import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
const { repo } = globalThis.__probe;
const fence = "`".repeat(3);
const tree = (dir) => Object.fromEntries(fs.readdirSync(dir, { recursive: true }).sort().map((f) => {
  const p = path.join(dir, f);
  return [f, fs.statSync(p).isFile() ? crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex") : "dir"];
}));
const cli = (cwd, ...args) => spawnSync(process.execPath, [`${repo}/bin/diagrammo.mjs`, ...args], { cwd, encoding: "utf8" });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "h1err-"));
const files = {
  "ok.md": ["## Ok", "", fence + "mermaid", "graph TD", "a-->b", fence, ""].join("\n"),
  "open.md": ["## Open", "", fence + "mermaid", "graph TD", "a-->b", ""].join("\n"),
  "bad.md": ["# Bad", "", "<!-- diagrammo:sync Bad_Slug -->", "text", ""].join("\n"),
};
for (const [n, s] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), s);
const before = tree(dir);

const missing = cli(dir, "--list", "--format", "json", "ok.md", "gone.md", "open.md");
assert.equal(missing.status, 1);
const m = JSON.parse(missing.stdout);
assert.deepEqual(m.documents.map((d) => d.name), ["ok.md", "gone.md", "open.md"]);
assert.deepEqual(m.documents[1].blocks, []);
assert.equal(m.documents[1].diagnostics[0].level, "error");
assert.equal(m.documents[0].blocks.length, 1);

const warnOnly = cli(dir, "--list", "--format", "json", "open.md");
assert.equal(warnOnly.status, 0, "warnings alone do not fail");
assert.equal(JSON.parse(warnOnly.stdout).documents[0].blocks[0].issues[0].level, "warn");
const strict = cli(dir, "--list", "--format", "json", "--strict", "open.md");
assert.equal(strict.status, 1, "strict promotes warnings to a failing exit");
JSON.parse(strict.stdout);

const bad = cli(dir, "--list", "--format", "json", "bad.md", "ok.md");
assert.equal(bad.status, 1);
const b = JSON.parse(bad.stdout);
assert.equal(b.documents[0].diagnostics[0].level, "error");
assert.equal(b.documents[0].diagnostics[0].line, 3);
assert.equal(b.documents[1].blocks.length, 1);

const unknown = cli(dir, "--list", "--format", "xml", "ok.md");
assert.notEqual(unknown.status, 0);
assert.equal(unknown.stdout.trim().startsWith("{"), false);
const notList = cli(dir, "--format", "json", "ok.md");
assert.notEqual(notList.status, 0);
assert.equal(notList.stdout.trim().startsWith("{"), false);
const notListSync = cli(dir, "--format", "json", "--sync-markdown", "ok.md");
assert.notEqual(notListSync.status, 0);
assert.deepEqual(tree(dir), before, "failed invocations write nothing");
