import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
const { repo } = globalThis.__probe;
const { checkMarkdownSync } = await import(`${repo}/src/index.mjs`);
const MD = "## Checkout\n\n<!-- diagrammo:sync checkout -->\n![Checkout](out/checkout.svg)\n\n<!-- diagrammo:source\n```mermaid swimlane\nflowchart BT\n    a[\"A<br/>healthy\"] --&gt; b[\"B<br/>healthy\"]\n    classDef green fill:#f2f8f2,stroke:#a0d8a0;\n    class a,b green;\n```\n-->\n<!-- /diagrammo:sync checkout -->\n";
const SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"485\" height=\"324\" viewBox=\"0 0 485 324\" font-family=\"Segoe UI, -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif\">\n<defs><filter id=\"cs\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"1\" stdDeviation=\"1.3\" flood-color=\"#000\" flood-opacity=\"0.1\"/></filter></defs>\n<rect width=\"485\" height=\"324\" fill=\"#ffffff\"/>\n<rect x=\"0\" y=\"78.0\" width=\"485\" height=\"90.0\" fill=\"#ffffff\"/>\n<line x1=\"0\" y1=\"78.0\" x2=\"485\" y2=\"78.0\" stroke=\"#e6e4e2\"/>\n<text x=\"340.6\" y=\"127.5\" font-size=\"13\" font-weight=\"700\" fill=\"#323130\">Workload root</text>\n<rect x=\"0\" y=\"168.0\" width=\"485\" height=\"90.0\" fill=\"#faf9f8\"/>\n<line x1=\"0\" y1=\"168.0\" x2=\"485\" y2=\"168.0\" stroke=\"#e6e4e2\"/>\n<text x=\"340.6\" y=\"209.0\" font-size=\"13\" font-weight=\"700\" fill=\"#323130\">Application</text>\n<text x=\"340.6\" y=\"226.0\" font-size=\"13\" font-weight=\"700\" fill=\"#323130\">components</text>\n<line x1=\"0\" y1=\"275.5\" x2=\"485\" y2=\"275.5\" stroke=\"#e6e4e2\"/>\n<text x=\"40\" y=\"34\" font-size=\"18\" font-weight=\"700\" fill=\"#242424\">Checkout</text>\n<text x=\"40\" y=\"52\" font-size=\"12\" fill=\"#605e5c\">Signals live inside each entity; health rolls up to the workload root.</text>\n<text x=\"40.0\" y=\"314.0\" font-size=\"11.5\" font-weight=\"600\" fill=\"#605e5c\">Legend</text>\n<circle cx=\"99.7\" cy=\"310.0\" r=\"4.5\" fill=\"#4c9a2a\"/>\n<text x=\"109.7\" y=\"314.0\" font-size=\"11.5\" fill=\"#323130\">Healthy</text>\n<circle cx=\"165.5\" cy=\"310.0\" r=\"4.5\" fill=\"#c26a00\"/>\n<text x=\"175.5\" y=\"314.0\" font-size=\"11.5\" fill=\"#323130\">Degraded</text>\n<circle cx=\"243.0\" cy=\"310.0\" r=\"4.5\" fill=\"#c50f18\"/>\n<text x=\"253.0\" y=\"314.0\" font-size=\"11.5\" fill=\"#323130\">Unhealthy</text>\n<circle cx=\"321.8\" cy=\"310.0\" r=\"4.5\" fill=\"#8a8886\"/>\n<text x=\"331.8\" y=\"314.0\" font-size=\"11.5\" fill=\"#323130\">Unknown</text>\n<g transform=\"translate(390.7,303.0) scale(0.875)\"><rect x=\"1.5\" y=\"8\" width=\"2.6\" height=\"6\" rx=\"0.6\" fill=\"#8661c5\"/><rect x=\"5.7\" y=\"4.5\" width=\"2.6\" height=\"9.5\" rx=\"0.6\" fill=\"#0078D4\"/><rect x=\"9.9\" y=\"6.5\" width=\"2.6\" height=\"7.5\" rx=\"0.6\" fill=\"#3fb0ac\"/></g>\n<text x=\"408.7\" y=\"314.0\" font-size=\"11.5\" fill=\"#323130\">Metric</text>\n<g transform=\"translate(40.0,0)\">\n<g fill=\"none\" stroke-linecap=\"butt\" stroke-linejoin=\"round\">\n<path d=\"M84.0 186.0 L84.0 154.0\" stroke=\"#a0d8a0\" stroke-width=\"1.7\"/>\n</g>\n<g filter=\"url(#cs)\"><rect x=\"0.0\" y=\"186.0\" width=\"168\" height=\"58\" rx=\"10\" fill=\"#f2f8f2\" stroke=\"#a0d8a0\" stroke-width=\"2\"/></g><g transform=\"translate(6.0,205.16) scale(0.82)\"><path d=\"M12 3.2l7.6 4.4v8.8L12 20.8l-7.6-4.4V7.6z\" fill=\"none\" stroke=\"#605e5c\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M4.6 7.8l7.4 4.3 7.4-4.3M12 12.1v8.6\" fill=\"none\" stroke=\"#605e5c\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></g><text x=\"34.0\" y=\"218.5\" font-size=\"12.5\" font-weight=\"600\" fill=\"#242424\">A</text><rect x=\"95.7\" y=\"206.00\" width=\"64.3\" height=\"18\" rx=\"9\" fill=\"#ffffff\" stroke=\"#a0d8a0\" stroke-width=\"1\"/><circle cx=\"106.7\" cy=\"215.0\" r=\"6\" fill=\"#4c9a2a\"/><path d=\"M104.0 215.0 l1.9 1.9 l3.4 -3.9\" fill=\"none\" stroke=\"#ffffff\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><text x=\"115.7\" y=\"218.57\" font-size=\"10.5\" fill=\"#323130\">Healthy</text>\n<g filter=\"url(#cs)\"><rect x=\"0.0\" y=\"96.0\" width=\"168\" height=\"58\" rx=\"10\" fill=\"#f2f8f2\" stroke=\"#a0d8a0\" stroke-width=\"2\"/></g><g transform=\"translate(6.0,115.16) scale(0.82)\"><path d=\"M12 3.2l7.6 4.4v8.8L12 20.8l-7.6-4.4V7.6z\" fill=\"none\" stroke=\"#605e5c\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M4.6 7.8l7.4 4.3 7.4-4.3M12 12.1v8.6\" fill=\"none\" stroke=\"#605e5c\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></g><text x=\"34.0\" y=\"128.5\" font-size=\"12.5\" font-weight=\"600\" fill=\"#242424\">B</text><rect x=\"95.7\" y=\"116.00\" width=\"64.3\" height=\"18\" rx=\"9\" fill=\"#ffffff\" stroke=\"#a0d8a0\" stroke-width=\"1\"/><circle cx=\"106.7\" cy=\"125.0\" r=\"6\" fill=\"#4c9a2a\"/><path d=\"M104.0 125.0 l1.9 1.9 l3.4 -3.9\" fill=\"none\" stroke=\"#ffffff\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><text x=\"115.7\" y=\"128.57\" font-size=\"10.5\" fill=\"#323130\">Healthy</text>\n</g></svg>";
const F = "`".repeat(3);
const tree = (dir) => Object.fromEntries(fs.readdirSync(dir, { recursive: true }).sort().map((f) => {
  const p = path.join(dir, f);
  const stat = fs.statSync(p, { bigint: true });
  if (!stat.isFile()) return [f, "dir"];
  return [f, {
    sha: crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"),
    mtimeNs: String(stat.mtimeNs),
    ctimeNs: String(stat.ctimeNs),
    size: Number(stat.size),
  }];
}));
const cli = (cwd, ...args) => spawnSync(process.execPath, [`${repo}/bin/diagrammo.mjs`, ...args], { cwd, encoding: "utf8" });
const check = (inputs, readSvg, extra = {}) => checkMarkdownSync(inputs, { outDir: "out", readSvg, ...extra });
const have = () => SVG;
const doc = (source = MD, name = "d.md") => ({ name, source });
const wd = fs.mkdtempSync(path.join(os.tmpdir(), "h3api-"));
process.chdir(wd);
const ABS = path.resolve("out", "checkout.svg");

// API
let r = check([doc()], have);
assert.equal(r.status, "current");
assert.equal(r.documents[0].markdownStatus, "current");
assert.deepEqual(r.documents[0].artifacts.map((a) => [a.slug, a.status]), [["checkout", "current"]]);
assert.equal(r.documents[0].artifacts[0].path, ABS);

const seen = [];
check([doc()], (p) => { seen.push(p); return SVG; });
assert.deepEqual(seen, [ABS], "readSvg receives the absolute artifact path");

r = check([doc()], () => null);
assert.equal(r.status, "drift");
assert.equal(r.documents[0].artifacts[0].status, "missing");

r = check([doc()], () => SVG.replace("<svg", "<svg data-x=\"1\""));
assert.equal(r.status, "drift");
assert.equal(r.documents[0].artifacts[0].status, "stale");

r = check([doc(MD.replace('a["A<br/>healthy"]', 'a["A<br/>broken"]').replace("healthy\"] --&gt;", "broken\"] --&gt;"))], have);
assert.equal(r.status, "drift", "source label drift is stale against the stored SVG");
assert.equal(r.documents[0].artifacts[0].status, "stale");

r = check([doc(MD.replace("![Checkout](out/checkout.svg)", "![Old](out/checkout.svg)"))], have);
assert.equal(r.status, "drift");
assert.equal(r.documents[0].markdownStatus, "stale");
assert.equal(r.documents[0].artifacts[0].status, "current");

r = check([doc()], have, { theme: "midnight" });
assert.equal(r.status, "drift", "theme drift");
assert.equal(r.documents[0].artifacts[0].status, "stale");

r = check([doc()], have, { imageFormat: "learn" });
assert.equal(r.status, "drift", "image format drift changes the markdown");
assert.equal(r.documents[0].markdownStatus, "stale");

const mer = [F + "mermaid", "graph TD", "a-->b", F, ""].join("\n");
r = check([doc("## M\n\n" + mer.replace("mermaid", "mermaid mermaid"))], have);
assert.equal(r.status, "error", "a block that cannot be verified offline is an error");
assert.equal(r.documents[0].artifacts[0].status, "error");

r = check([doc()], () => { throw new Error("EACCES"); });
assert.equal(r.status, "error");
assert.equal(r.documents[0].artifacts[0].status, "error");
assert.ok(r.documents[0].diagnostics.some((d) => d.level === "error"));

r = check([doc("<!-- diagrammo:sync Bad_Slug -->\n")], have);
assert.equal(r.status, "error");
assert.equal(r.documents[0].markdownStatus, "error");

r = check([doc("# nothing\n")], () => { throw new Error("must not be called"); });
assert.equal(r.status, "current");
assert.deepEqual(r.documents[0].artifacts, []);

r = check([doc("# nothing\n", "n.md"), doc(MD.replace("![Checkout](out/checkout.svg)", "![Old](out/checkout.svg)"), "e.md")], have);
assert.equal(r.status, "drift");
assert.deepEqual(r.documents.map((d) => d.name), ["n.md", "e.md"]);
assert.deepEqual(r.documents.map((d) => d.markdownStatus), ["current", "stale"]);
r = check([doc("<!-- diagrammo:sync Bad_Slug -->\n", "x.md"), doc(MD, "e.md")], () => null);
assert.equal(r.status, "error", "error outranks drift");
assert.deepEqual(fs.readdirSync(wd), [], "API check does not touch the filesystem");

// CLI
const mk = (md, svg) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "h3cli-"));
  fs.writeFileSync(path.join(dir, "d.md"), md);
  if (svg != null) { fs.mkdirSync(path.join(dir, "out")); fs.writeFileSync(path.join(dir, "out", "checkout.svg"), svg); }
  return dir;
};
const args = ["--check-sync", "-o", "out", "d.md"];
let dir = mk(MD, SVG);
let before = tree(dir);
let c = cli(dir, ...args);
assert.equal(c.status, 0, c.stderr);
assert.deepEqual(tree(dir), before);

dir = mk(MD, null);
before = tree(dir);
c = cli(dir, ...args);
assert.equal(c.status, 1, "missing SVG is drift");
assert.deepEqual(tree(dir), before, "no output directory or file is created");
assert.ok(!fs.existsSync(path.join(dir, "out")));

dir = mk(MD, SVG + "\n<!-- edited -->");
before = tree(dir);
assert.equal(cli(dir, ...args).status, 1);
assert.deepEqual(tree(dir), before);

dir = mk(MD.replace("![Checkout](out/checkout.svg)", "![Old](out/checkout.svg)"), SVG);
before = tree(dir);
assert.equal(cli(dir, ...args).status, 1);
assert.deepEqual(tree(dir), before);

dir = mk(MD, SVG);
before = tree(dir);
assert.equal(cli(dir, "--check-sync", "-o", "out", "-t", "midnight", "d.md").status, 1, "theme drift");
assert.deepEqual(tree(dir), before);

dir = mk("<!-- diagrammo:sync Bad_Slug -->\n", SVG);
before = tree(dir);
assert.equal(cli(dir, ...args).status, 2, "invalid managed markdown is an error");
assert.deepEqual(tree(dir), before);

dir = mk(MD, SVG);
before = tree(dir);
assert.equal(cli(dir, "--check-sync", "-o", "out", "d.md", "gone.md").status, 2, "unreadable input is an error");
assert.deepEqual(tree(dir), before);

for (const extra of [["--list"], ["--sync-markdown"], ["--restore-markdown"]]) {
  dir = mk(MD, SVG);
  before = tree(dir);
  c = cli(dir, ...args, ...extra);
  assert.notEqual(c.status, 0, `rejects ${extra}`);
  assert.deepEqual(tree(dir), before);
}
