import test from "node:test";
import assert from "node:assert/strict";
import {
    applySectionEdits,
    containsMermaidFence,
    extractEditableSections,
    findLevelTwoSections,
} from "./document-model.js";

function buildBlueprint(fence) {
    return `# Blueprint: Demo

Created: 2026-09-16 07:00 +02:00 | Status: implementing | Repo: o/r

## Goal

Keep this exact heading parser.

## Active criteria

- [ ] C0-1 When this runs, preserve untouched bytes.
- [ ] C0-2 Keep fenced headings inside code blocks.

${fence}mermaid
flowchart LR
  A["## This is not a heading"] --> B["Still inside fence"]
${fence}

## Plan summary

### Design

Use one canonical markdown draft.

## Constraints / non-negotiables

- no guessing
`;
}

const BASE_BLUEPRINT = buildBlueprint("```");

for (const fence of ["```", "~~~"]) {
    test(`findLevelTwoSections ignores headings in ${fence} fences`, () => {
        const sections = findLevelTwoSections(buildBlueprint(fence));
        const names = sections.map((section) => section.headingText);

        assert.deepEqual(names, [
            "Goal",
            "Active criteria",
            "Plan summary",
            "Constraints / non-negotiables",
        ]);
        assert.equal(sections[1].body.includes("## This is not a heading"), true);
    });
}

test("extractEditableSections returns the three editable sections", () => {
    const sections = extractEditableSections(BASE_BLUEPRINT);

    assert.equal(sections.goal.includes("Keep this exact heading parser."), true);
    assert.equal(sections.activeCriteria.includes("C0-1"), true);
    assert.equal(sections.planSummary.includes("### Design"), true);
});

test("containsMermaidFence detects plan-summary diagram without requiring heading text", () => {
    const sections = extractEditableSections(BASE_BLUEPRINT);
    assert.equal(containsMermaidFence(sections.planSummary), false);

    const withDiagram = `${sections.planSummary}\n\`\`\`mermaid\ngraph TD;A-->B;\n\`\`\`\n`;
    assert.equal(containsMermaidFence(withDiagram), true);
});

test("applySectionEdits changes only edited section bytes", () => {
    const edited = applySectionEdits(BASE_BLUEPRINT, {
        goal: "\nUpdated goal.\n",
    });
    const editedSections = extractEditableSections(edited);
    const originalSections = extractEditableSections(BASE_BLUEPRINT);

    assert.equal(editedSections.goal, "\nUpdated goal.\n");
    assert.equal(editedSections.activeCriteria, originalSections.activeCriteria);
    assert.equal(editedSections.planSummary, originalSections.planSummary);
    assert.equal(edited.includes("## Constraints / non-negotiables"), true);
});

test("applySectionEdits preserves section boundaries when textbox value has no edge newlines", () => {
    const edited = applySectionEdits(BASE_BLUEPRINT, {
        goal: "Edited fixture goal. Preserve every other section.",
    });
    const expectedBoundary = "## Goal\n\nEdited fixture goal. Preserve every other section.\n\n## Active criteria";

    assert.equal(edited.includes(expectedBoundary), true);
    assert.equal(
        extractEditableSections(edited).activeCriteria,
        extractEditableSections(BASE_BLUEPRINT).activeCriteria,
    );
});

test("applying extracted sections is a lossless round-trip", () => {
    const extracted = extractEditableSections(BASE_BLUEPRINT);
    const roundTripped = applySectionEdits(BASE_BLUEPRINT, {
        goal: extracted.goal,
        activeCriteria: extracted.activeCriteria,
        planSummary: extracted.planSummary,
    });

    assert.equal(roundTripped, BASE_BLUEPRINT);
});
