import assert from "node:assert/strict";
const { repo } = globalThis.__probe;
const { restoreMarkdown } = await import(`${repo}/src/index.mjs`);
const F = "`".repeat(3);
const L = (...lines) => lines.join("\n");
const span = (slug, ...body) => [`<!-- diagrammo:sync ${slug} -->`, `![${slug}](out/${slug}.svg)`, "", "<!-- diagrammo:source", ...body, "-->", `<!-- /diagrammo:sync ${slug} -->`];

const cases = [
  ["current span between prose", L("Intro", "", ...span("a", F + "mermaid theme=midnight", "graph TD", "x--&gt;y", F), "", "Outro", ""),
    L("Intro", "", F + "mermaid theme=midnight", "graph TD", "x-->y", F, "", "Outro", "")],
  ["CRLF, two spans, one-line gap, no final newline",
    L("# T", ...span("a", F + "mermaid", "graph TD", "p--&gt;q", F), ...span("b", F + "mermaid swimlane", "flowchart BT", "m--&gt;n", F), "end").replaceAll("\n", "\r\n"),
    L("# T", F + "mermaid", "graph TD", "p-->q", F, F + "mermaid swimlane", "flowchart BT", "m-->n", F, "end").replaceAll("\n", "\r\n")],
  ["tilde and longer fences keep marker, info and body",
    L(...span("t", "~~~~mermaid dark", "graph LR", "a--&gt;b", "~~~~"), ""),
    L("~~~~mermaid dark", "graph LR", "a-->b", "~~~~", "")],
  ["legacy details span", L("## C", "", "<!-- diagrammo:sync legacy -->", "![C](out/legacy.svg)", "", "<details>", "<summary>Mermaid source</summary>", "",
    F + "mermaid", "graph TD", "a-->b", F, "", "</details>", "<!-- /diagrammo:sync legacy -->", "tail", ""),
    L("## C", "", F + "mermaid", "graph TD", "a-->b", F, "tail", "")],
  ["learn embed format", L(...span("l", F + "mermaid", "graph TD", "a--&gt;b", F), "").replace("![l](out/l.svg)", ':::image type="content" source="out/l.svg" alt-text="l" lightbox="out/l.svg" border="false":::'),
    L(F + "mermaid", "graph TD", "a-->b", F, "")],
  ["marker examples inside other fences stay literal", L(F + "text", "<!-- diagrammo:sync fake -->", "<!-- /diagrammo:sync fake -->", F, "", ...span("r", F + "mermaid", "graph TD", "a--&gt;b", F), ""),
    L(F + "text", "<!-- diagrammo:sync fake -->", "<!-- /diagrammo:sync fake -->", F, "", F + "mermaid", "graph TD", "a-->b", F, "")],
  ["document without spans is unchanged", L("# P", "", F + "mermaid", "graph TD", "a-->b", F, "", "text --&gt; literal", ""), L("# P", "", F + "mermaid", "graph TD", "a-->b", F, "", "text --&gt; literal", "")],
  ["empty source", "", ""],
];
for (const [name, input, expected] of cases) {
  const out = restoreMarkdown(input);
  assert.equal(out, expected, name);
  assert.equal(restoreMarkdown(out), out, `${name}: idempotent`);
}

const invalid = [
  ["nested begin", L("<!-- diagrammo:sync a -->", ...span("b", F + "mermaid", "graph TD", F), "<!-- /diagrammo:sync a -->")],
  ["mismatched slugs", L("<!-- diagrammo:sync a -->", "x", "<!-- /diagrammo:sync b -->")],
  ["duplicate slug in one file", L(...span("a", F + "mermaid", "graph TD", F), ...span("a", F + "mermaid", "graph TD", F))],
  ["span without a fence", L("<!-- diagrammo:sync a -->", "![a](a.svg)", "<!-- /diagrammo:sync a -->")],
  ["span with two fences", L(...span("a", F + "mermaid", "graph TD", F, F + "mermaid", "graph LR", F))],
  ["begin without end", L("<!-- diagrammo:sync a -->", "![a](a.svg)")],
  ["incomplete hidden source", L("<!-- diagrammo:sync a -->", "<!-- diagrammo:source", F + "mermaid", "graph TD", F)],
  ["malformed marker", L("<!-- diagrammo:sync Bad_Slug -->")],
];
for (const [name, input] of invalid) assert.throws(() => restoreMarkdown(input), Error, name);
