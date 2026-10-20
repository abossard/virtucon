import assert from "node:assert/strict";
const { repo } = globalThis.__probe;
const { inventoryDocuments } = await import(`${repo}/src/index.mjs`);
const fence = "`".repeat(3);
const managed = (slug) => [
  "# Doc", "", `<!-- diagrammo:sync ${slug} -->`, "![x](out/x.svg)", "", "<!-- diagrammo:source",
  fence + "mermaid", "graph TD", "a--&gt;b", fence, "-->", `<!-- /diagrammo:sync ${slug} -->`, "",
].join("\n");
const malformed = ["# Bad", "", "<!-- diagrammo:sync Bad_Slug -->", "text", ""].join("\n");
const unclosed = ["# Open", "", fence + "mermaid", "graph TD", "a-->b", ""].join("\n");
const inv = inventoryDocuments([
  { name: "one.md", source: managed("same") },
  { name: "bad.md", source: malformed },
  { name: "two.md", source: managed("same") },
  { name: "open.md", source: unclosed },
]);
assert.deepEqual(inv.documents.map((d) => d.name), ["one.md", "bad.md", "two.md", "open.md"]);
const [one, bad, two, open] = inv.documents;
assert.deepEqual(one.diagnostics, []);
assert.equal(one.blocks.length, 1);
assert.equal(bad.blocks.length, 0);
assert.equal(bad.diagnostics.length, 1);
assert.equal(bad.diagnostics[0].level, "error");
assert.equal(bad.diagnostics[0].line, 3);
assert.match(bad.diagnostics[0].message, /managed marker/);
assert.equal(two.blocks.length, 0);
assert.equal(two.diagnostics[0].level, "error");
assert.equal(two.diagnostics[0].scope, "batch");
assert.match(two.diagnostics[0].message, /same/);
assert.equal(open.diagnostics.length, 0);
assert.equal(open.blocks[0].closeLine, null);
assert.equal(open.blocks[0].issues.length, 1);
assert.equal(open.blocks[0].issues[0].level, "warn");
assert.equal(open.blocks[0].issues[0].line, 3);
