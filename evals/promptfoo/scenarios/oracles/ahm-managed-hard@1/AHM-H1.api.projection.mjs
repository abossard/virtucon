import assert from "node:assert/strict";
const { repo } = globalThis.__probe;
const { inventoryDocuments } = await import(`${repo}/src/index.mjs`);
const fence = "`".repeat(3);
const lf = [
  "## Checkout", "",
  fence + 'mermaid swimlane theme=midnight title="Hi"',
  "flowchart BT",
  '    a["A<br/>healthy"] --> b["B<br/>healthy"]',
  fence, "",
  "## Plain",
  fence + "mermaid",
  "graph TD",
  "x-->y",
  fence, "",
].join("\n");
const managed = [
  "# Doc", "",
  "<!-- diagrammo:sync orders -->",
  "![Orders](out/orders.svg)", "",
  "<!-- diagrammo:source",
  fence + "mermaid",
  "flowchart BT",
  '    a["A<br/>healthy"] --&gt; b["B<br/>healthy"]',
  "    classDef green fill:#f2f8f2,stroke:#a0d8a0;",
  "    class a,b green;",
  fence,
  "-->",
  "<!-- /diagrammo:sync orders -->", "",
].join("\n");
const none = ["# Nothing", "", fence + "text", "<!-- diagrammo:sync fake -->", fence, ""].join("\n");
const plainA = ["## Plain", "", fence + "mermaid", "graph TD", "p-->q", fence, ""].join("\n");
const inputs = [
  { name: "a.md", source: lf }, { name: "m.md", source: managed },
  { name: "none.md", source: none }, { name: "p1.md", source: plainA }, { name: "p2.md", source: plainA },
];
const snapshot = structuredClone(inputs);
const inv = inventoryDocuments(inputs, { theme: "candy" });
assert.deepEqual(inputs, snapshot, "inputs must not be mutated");
assert.equal(inv.schemaVersion, 1);
assert.deepEqual(inv.documents.map((d) => d.name), inputs.map((i) => i.name), "input order");
for (const d of inv.documents) {
  assert.ok(Array.isArray(d.blocks) && Array.isArray(d.diagnostics), `${d.name} shape`);
}
const [a, m, n, p1, p2] = inv.documents;
for (const doc of [a]) {
  assert.deepEqual(doc.blocks.map((b) => b.slug), ["hi", "plain"], doc.name);
  assert.deepEqual(doc.blocks.map((b) => [b.line, b.closeLine]), [[3, 6], [9, 12]], doc.name);
  assert.deepEqual(doc.blocks.map((b) => b.location), [{ beginLine: 3, endLine: 6 }, { beginLine: 9, endLine: 12 }], doc.name);
  assert.deepEqual(doc.blocks.map((b) => b.renderer), ["swimlane", "mermaid"], doc.name);
  assert.equal(doc.blocks[0].effectiveOptions.theme, "midnight");
  assert.equal(doc.blocks[0].effectiveOptions.title, "Hi");
  assert.equal(doc.blocks[1].effectiveOptions.theme, "candy");
  assert.equal(doc.blocks[1].effectiveOptions.title, "Plain");
  assert.deepEqual(doc.blocks.map((b) => b.issues), [[], []]);
  assert.deepEqual(doc.diagnostics, []);
}
assert.equal(m.blocks.length, 1);
assert.equal(m.blocks[0].slug, "orders");
assert.deepEqual([m.blocks[0].line, m.blocks[0].closeLine], [7, 12]);
assert.deepEqual(m.blocks[0].location, { beginLine: 3, endLine: 14 });
assert.equal(m.blocks[0].renderer, "swimlane");
assert.equal(m.blocks[0].effectiveOptions.theme, "candy");
assert.equal(m.blocks[0].effectiveOptions.title, "Doc");
assert.deepEqual(n.blocks, []);
assert.deepEqual(n.diagnostics, []);
assert.deepEqual(p1.blocks.map((b) => b.slug), ["plain-2"]);
assert.deepEqual(p2.blocks.map((b) => b.slug), ["plain-3"], "deterministic suffix across the batch");
const json = JSON.parse(JSON.stringify(inv));
assert.deepEqual(json.documents.map((d) => d.name), inputs.map((i) => i.name), "JSON-serializable");
const second = inventoryDocuments(inputs, { theme: "candy" });
assert.deepEqual(JSON.parse(JSON.stringify(second)), json, "deterministic");
const defaultsOnly = inventoryDocuments([{ name: "a.md", source: lf }]);
assert.equal(defaultsOnly.documents[0].blocks[1].effectiveOptions.theme, "portal");
