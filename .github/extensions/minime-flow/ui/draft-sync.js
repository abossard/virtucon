function hasText(value) {
    return typeof value === "string" && value.length > 0;
}

const APPLY_PENDING = new Set(["queued", "pending", "applying"]);
const APPLY_SUCCESS = new Set(["committed", "success"]);
const APPLY_FAILED = new Set(["failed", "error", "conflict", "rejected"]);

export function statusForApplyState(applyStateRaw, requestId = null) {
    if (!hasText(applyStateRaw)) return null;
    const applyState = applyStateRaw.toLowerCase();
    if (applyState === "idle") {
        return { kind: "", text: "No local edits." };
    }
    if (applyState === "saved") {
        return { kind: "success", text: "Draft saved." };
    }
    if (APPLY_SUCCESS.has(applyState)) {
        const request = hasText(requestId) ? requestId : "request id not provided";
        return { kind: "success", text: `Apply committed (${request}).` };
    }
    if (APPLY_PENDING.has(applyState)) {
        return { kind: "", text: `Apply requested (${applyState}). Waiting for commit.` };
    }
    if (APPLY_FAILED.has(applyState)) {
        return { kind: "error", text: `Apply ${applyState}. Review draft and retry.` };
    }
    return { kind: "", text: `Apply status: ${applyStateRaw}.` };
}

function mergeApplyStatus(next, draftStatusRaw) {
    const status = statusForApplyState(draftStatusRaw, next.remoteRequestId);
    if (!status) return;
    next.status = status;
}

export function mergeRemoteDraftState(local, payload, sentClientRevision = null) {
    const draft = payload?.draft && typeof payload.draft === "object" ? payload.draft : null;
    const remoteDraftStatus = draft ? (hasText(draft.status) ? draft.status : "unknown") : "none";
    const draftStatus = hasText(remoteDraftStatus) ? remoteDraftStatus.toLowerCase() : "";
    const committedDraft = APPLY_SUCCESS.has(draftStatus);
    const remoteMarkdown = committedDraft ? payload?.markdown : draft?.markdown ?? payload?.markdown;
    const revisionMatches =
        sentClientRevision === null ? !local.dirty : local.clientRevision === sentClientRevision;
    const adoptRemoteContent = typeof remoteMarkdown === "string" && revisionMatches;
    const acknowledgeSave = sentClientRevision !== null;

    const next = {
        ...local,
        path: hasText(payload?.path) ? payload.path : local.path,
        documentRevision: payload?.revision ?? local.documentRevision,
        baseRevision: adoptRemoteContent
            ? committedDraft
                ? payload?.revision ?? draft?.baseRevision ?? local.baseRevision
                : draft?.baseRevision ?? payload?.revision ?? local.baseRevision
            : local.baseRevision,
        expectedDraftRevision: adoptRemoteContent || acknowledgeSave
            ? hasText(draft?.revision) ? draft.revision : null
            : local.expectedDraftRevision,
        remoteDraftStatus,
        remoteRequestId: hasText(draft?.requestId) ? draft.requestId : local.remoteRequestId,
        saving: false,
        applying: false,
    };

    if (adoptRemoteContent) {
        next.markdown = remoteMarkdown;
        next.dirty = false;
    }

    if (sentClientRevision !== null) {
        next.status = local.clientRevision === sentClientRevision
            ? { kind: "success", text: "Draft saved." }
            : { kind: "", text: "Draft saved. Newer local edits are still unsaved." };
    } else {
        mergeApplyStatus(next, draft?.status);
    }

    return next;
}
