import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { guardPhaseDispatch } from "./dispatch-gate.mjs";
import { readDocumentWithDraft, saveDocumentDraft, queueDocumentApply, commitQueuedDocument } from "./document-store.mjs";

test("queued corrections block phase successors until commit, independent of canvas panels", async (t) => {
    const root = resolve(".github/extensions/minime-flow/lib/.test-work", `dispatch-${randomUUID()}`);
    await mkdir(root, { recursive: true });
    t.after(() => rm(root, { recursive: true, force: true }));
    const path = resolve(root, "fixture.blueprint.md");
    await writeFile(path, "# Blueprint: Fixture\n\n## Goal\n\nOriginal.\n");
    const scope = { draftRoot: root, documentPath: path, sessionId: "owner" };
    const original = readDocumentWithDraft(scope);
    const draft = await saveDocumentDraft({
        ...scope, markdown: original.markdown.replace("Original.", "Corrected."),
        baseRevision: original.revision, expectedDraftRevision: null,
    });
    const queued = await queueDocumentApply({ ...scope, expectedDraftRevision: draft.draft.revision });
    const context = { sessionId: "owner", blueprintRoot: root };
    for (const name of ["blueprint", "replicate", "inspect", "extract"]) {
        const result = guardPhaseDispatch({ toolName: "task", toolArgs: { name } }, context);
        assert.equal(result.permissionDecision, "deny");
        assert.match(result.permissionDecisionReason, new RegExp(queued.requestId));
    }
    assert.equal(guardPhaseDispatch({ toolName: "view", toolArgs: {} }, context), undefined);
    assert.equal(guardPhaseDispatch({ toolName: "task", toolArgs: { name: "research" } }, context), undefined);
    await commitQueuedDocument({ ...scope, requestId: queued.requestId, expectedRevision: original.revision });
    assert.equal(guardPhaseDispatch({ toolName: "task", toolArgs: { name: "inspect" } }, context), undefined);
});
