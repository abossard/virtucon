import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { applySectionEdits, extractEditableSections } from "./document-model.js";

const BASE_MARKDOWN = `# Blueprint: DOM round-trip

Created: 2026-09-16 08:00 +02:00 | Status: implementing | Repo: o/r

## Goal

Original goal text.

## Active criteria

- [ ] C0-1 Preserve section boundaries.

## Plan summary

Plan body.
`;

test("DOM fill + save keeps section delimiters when edited goal has no newlines", () => {
    const { document, window } = parseHTML(`
      <form id="editor">
        <textarea id="goal-input"></textarea>
        <button id="save-draft" type="submit">Save draft</button>
      </form>
    `);

    const goalInput = document.getElementById("goal-input");
    const form = document.getElementById("editor");
    const entry = { markdown: BASE_MARKDOWN };
    let savedPayload = null;

    goalInput.value = extractEditableSections(entry.markdown).goal;
    goalInput.addEventListener("input", () => {
        entry.markdown = applySectionEdits(entry.markdown, { goal: goalInput.value });
    });
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        savedPayload = { markdown: entry.markdown };
    });

    goalInput.value = "Edited fixture goal. Preserve every other section.";
    goalInput.dispatchEvent(new window.Event("input", { bubbles: true }));
    form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));

    const expected = "## Goal\n\nEdited fixture goal. Preserve every other section.\n\n## Active criteria";
    assert.equal(savedPayload.markdown.includes(expected), true);
    assert.equal(
        extractEditableSections(savedPayload.markdown).activeCriteria,
        extractEditableSections(BASE_MARKDOWN).activeCriteria,
    );
});
