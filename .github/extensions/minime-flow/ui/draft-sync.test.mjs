import test from "node:test";
import assert from "node:assert/strict";
import { mergeRemoteDraftState, statusForApplyState } from "./draft-sync.js";

const BASE_STATE = {
    filename: "demo.blueprint.md",
    path: "/blueprints/demo.blueprint.md",
    markdown: "local",
    baseRevision: 4,
    documentRevision: 4,
    expectedDraftRevision: "draft-4",
    remoteDraftStatus: "pending",
    remoteRequestId: null,
    dirty: true,
    saving: true,
    applying: false,
    clientRevision: 8,
    status: { kind: "", text: "Saving draft…" },
};

test("mergeRemoteDraftState keeps newer local markdown after stale save response", () => {
    const merged = mergeRemoteDraftState(
        BASE_STATE,
        {
            revision: 5,
            markdown: "applied",
            draft: {
                markdown: "server",
                baseRevision: 5,
                revision: "draft-5",
                status: "saved",
            },
        },
        7,
    );

    assert.equal(merged.markdown, "local");
    assert.equal(merged.dirty, true);
    assert.deepEqual(merged.status, {
        kind: "",
        text: "Draft saved. Newer local edits are still unsaved.",
    });
    assert.equal(merged.expectedDraftRevision, "draft-5");
    assert.equal(merged.baseRevision, BASE_STATE.baseRevision);
});

test("mergeRemoteDraftState replaces markdown when response matches latest local revision", () => {
    const merged = mergeRemoteDraftState(
        { ...BASE_STATE, dirty: true, markdown: "local-unchanged" },
        {
            revision: 6,
            markdown: "applied",
            draft: {
                markdown: "server-latest",
                baseRevision: 6,
                revision: "draft-6",
                status: "saved",
                requestId: "req-1",
            },
        },
        8,
    );

    assert.equal(merged.markdown, "server-latest");
    assert.equal(merged.dirty, false);
    assert.equal(merged.remoteRequestId, "req-1");
    assert.deepEqual(merged.status, { kind: "success", text: "Draft saved." });
});

test("mergeRemoteDraftState reports apply lifecycle from backend draft status", () => {
    const cases = [
        {
            status: "queued",
            kind: "",
            text: "Apply requested (queued). Waiting for commit.",
        },
        {
            status: "committed",
            kind: "success",
            text: "Apply committed (req-42).",
        },
        {
            status: "failed",
            kind: "error",
            text: "Apply failed. Review draft and retry.",
        },
        {
            status: "success",
            kind: "success",
            text: "Apply committed (req-42).",
        },
    ];

    for (const testCase of cases) {
        const merged = mergeRemoteDraftState(
            {
                ...BASE_STATE,
                dirty: false,
                saving: false,
                applying: true,
                remoteRequestId: "req-42",
                status: { kind: "", text: "Sending apply request…" },
            },
            {
                revision: 7,
                markdown: "same",
                draft: {
                    markdown: "same",
                    baseRevision: 7,
                    revision: "draft-7",
                    status: testCase.status,
                },
            },
            null,
        );

        assert.deepEqual(merged.status, { kind: testCase.kind, text: testCase.text });
    }
});

test("mergeRemoteDraftState treats committed draft as metadata and preserves dirty local edits", () => {
    const payload = {
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

    const cleanMerged = mergeRemoteDraftState(
        {
            ...BASE_STATE,
            markdown: "Applied blueprint A",
            baseRevision: 10,
            documentRevision: 10,
            expectedDraftRevision: "draft-10",
            dirty: false,
            saving: false,
            applying: true,
            remoteRequestId: "req-10",
            status: { kind: "", text: "Sending apply request…" },
        },
        payload,
        null,
    );

    assert.equal(cleanMerged.markdown, payload.markdown);
    assert.equal(cleanMerged.baseRevision, 11);
    assert.equal(cleanMerged.documentRevision, 11);
    assert.equal(cleanMerged.expectedDraftRevision, "draft-10");
    assert.equal(cleanMerged.remoteDraftStatus, "committed");
    assert.deepEqual(cleanMerged.status, { kind: "success", text: "Apply committed (req-10)." });

    const dirtyMerged = mergeRemoteDraftState(
        {
            ...BASE_STATE,
            markdown: "Applied blueprint A\n\nUnsaved local change C",
            baseRevision: 10,
            documentRevision: 10,
            expectedDraftRevision: "draft-10",
            dirty: true,
            saving: false,
            applying: false,
            remoteRequestId: "req-10",
            status: { kind: "", text: "Unsaved local edits." },
        },
        payload,
        null,
    );

    assert.equal(dirtyMerged.markdown, "Applied blueprint A\n\nUnsaved local change C");
    assert.equal(dirtyMerged.dirty, true);
    assert.equal(dirtyMerged.baseRevision, 10);
    assert.equal(dirtyMerged.documentRevision, 11);
    assert.equal(dirtyMerged.remoteDraftStatus, "committed");
    assert.equal(dirtyMerged.expectedDraftRevision, "draft-10");
});

for (const remoteStatus of ["saved", "committed", null]) {
    test(`unsolicited ${remoteStatus ?? "absent"} draft does not rebase dirty edits`, () => {
        const merged = mergeRemoteDraftState(BASE_STATE, {
            revision: 9,
            markdown: "Another worker's applied change",
            draft: remoteStatus && {
                markdown: "Another editor's draft",
                baseRevision: 9,
                revision: "draft-9",
                status: remoteStatus,
            },
        });

        assert.equal(merged.markdown, BASE_STATE.markdown);
        assert.equal(merged.dirty, true);
        assert.equal(merged.documentRevision, 9);
        assert.equal(merged.baseRevision, BASE_STATE.baseRevision);
        assert.equal(merged.expectedDraftRevision, BASE_STATE.expectedDraftRevision);
    });
}

test("statusForApplyState maps backend apply.state values", () => {
    const cases = [
        ["idle", null, { kind: "", text: "No local edits." }],
        ["saved", null, { kind: "success", text: "Draft saved." }],
        ["queued", null, { kind: "", text: "Apply requested (queued). Waiting for commit." }],
        ["success", "req-7", { kind: "success", text: "Apply committed (req-7)." }],
        ["error", null, { kind: "error", text: "Apply error. Review draft and retry." }],
    ];

    for (const [state, requestId, expected] of cases) {
        assert.deepEqual(statusForApplyState(state, requestId), expected);
    }
    assert.equal(statusForApplyState(null), null);
});
