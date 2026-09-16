import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { renderPreview } from "./preview.js";

test("renderPreview sanitizes html and replaces mermaid fences with svg", async () => {
    const { document } = parseHTML(`<main><section id="preview"></section></main>`);
    const target = document.getElementById("preview");
    const calls = [];

    await renderPreview({
        target,
        markdown: "ignored",
        parseMarkdown: () =>
            `<p>safe</p><script>window.bad=true</script><pre><code class="language-mermaid">graph TD;A-->B;</code></pre>`,
        sanitizeHtml: (html) => html.replace(/<script[\s\S]*?<\/script>/g, ""),
        renderMermaid: async (source, id) => {
            calls.push({ source, id });
            return { svg: `<svg data-id="${id}"><text>${source}</text></svg>` };
        },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].source, "graph TD;A-->B;");
    assert.equal(target.querySelector("script"), null);
    assert.equal(target.querySelector("svg")?.getAttribute("data-id"), "diagram-0");
    assert.equal(target.textContent.includes("safe"), true);
});

test("renderPreview keeps mermaid source visible on render failure", async () => {
    const { document } = parseHTML(`<main><section id="preview"></section></main>`);
    const target = document.getElementById("preview");

    await renderPreview({
        target,
        markdown: "ignored",
        parseMarkdown: () =>
            `<pre><code class="language-mermaid">graph TD;A-->B;</code></pre>`,
        sanitizeHtml: (html) => html,
        renderMermaid: async () => {
            throw new Error("bad diagram");
        },
    });

    const error = target.querySelector('[role="status"]');
    assert.equal(error?.textContent?.includes("bad diagram"), true);
    assert.equal(target.textContent.includes("graph TD;A-->B;"), true);
});
