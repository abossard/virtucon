import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { setEditorMode } from "./editor-dom.js";

function setup() {
    const { document } = parseHTML(`
      <main>
        <div role="tablist">
          <button id="mode-sections" data-mode-control="sections"></button>
          <button id="mode-source" data-mode-control="source"></button>
          <button id="mode-preview" data-mode-control="preview"></button>
        </div>
        <section data-mode-panel="sections"></section>
        <section data-mode-panel="source" hidden></section>
        <section data-mode-panel="preview" hidden></section>
      </main>
    `);
    return { document };
}

test("setEditorMode updates panel visibility and tab state", () => {
    const { document } = setup();

    setEditorMode(document, "preview");

    assert.equal(document.querySelector('[data-mode-panel="sections"]').hidden, true);
    assert.equal(document.querySelector('[data-mode-panel="source"]').hidden, true);
    assert.equal(document.querySelector('[data-mode-panel="preview"]').hidden, false);
    assert.equal(document.getElementById("mode-preview").getAttribute("aria-selected"), "true");
    assert.equal(document.getElementById("mode-sections").tabIndex, -1);
});

test("setEditorMode rejects unsupported modes", () => {
    const { document } = setup();

    assert.throws(() => setEditorMode(document, "unknown"), /Unsupported editor mode/);
});
