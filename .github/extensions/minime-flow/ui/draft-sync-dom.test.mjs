import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { mergeRemoteDraftState } from "./draft-sync.js";

const COMMITTED_PAYLOAD = {
    revision: 11,
    markdown: "Applied blueprint A\n\nWorker change B",
    draft: {
        markdown: "Applied blueprint A",
        baseRevision: 10,
        revision: "draft-10",
        status: "committed",
        requestId: "req-10",
    },
};

const CLEAN_LOCAL = {
    filename: "demo.blueprint.md",
    path: "/blueprints/demo.blueprint.md",
    markdown: "Applied blueprint A",
    baseRevision: 10,
    documentRevision: 10,
    expectedDraftRevision: "draft-10",
    remoteDraftStatus: "queued",
    remoteRequestId: "req-10",
    dirty: false,
    saving: false,
    applying: true,
    clientRevision: 12,
    status: { kind: "", text: "Sending apply request…" },
};

test("DOM refresh shows applied markdown after committed draft and keeps dirty local edits", () => {
    const { document } = parseHTML(`
      <main>
        <textarea id="source-input"></textarea>
        <output id="base-revision"></output>
        <output id="draft-status"></output>
      </main>
    `);

    const sourceInput = document.getElementById("source-input");
    const baseRevision = document.getElementById("base-revision");
    const draftStatus = document.getElementById("draft-status");

    sourceInput.value = CLEAN_LOCAL.markdown;
    const merged = mergeRemoteDraftState(CLEAN_LOCAL, COMMITTED_PAYLOAD, null);
    sourceInput.value = merged.markdown;
    baseRevision.textContent = String(merged.baseRevision);
    draftStatus.textContent = merged.remoteDraftStatus;

    assert.equal(sourceInput.value, "Applied blueprint A\n\nWorker change B");
    assert.equal(baseRevision.textContent, "11");
    assert.equal(draftStatus.textContent, "committed");
    assert.equal(merged.expectedDraftRevision, "draft-10");

    const dirtyMerged = mergeRemoteDraftState(
        {
            ...CLEAN_LOCAL,
            markdown: "Applied blueprint A\n\nUnsaved local change C",
            dirty: true,
            applying: false,
            status: { kind: "", text: "Unsaved local edits." },
        },
        COMMITTED_PAYLOAD,
        null,
    );

    assert.equal(dirtyMerged.markdown, "Applied blueprint A\n\nUnsaved local change C");
    assert.equal(dirtyMerged.dirty, true);
    assert.equal(dirtyMerged.baseRevision, 10);
});
