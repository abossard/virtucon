import { randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import {
    clearDocumentDraft,
    commitQueuedDocument,
    queueDocumentApply,
    readDocumentWithDraft,
    saveDocumentDraft,
} from "./document-store.mjs";

function fail(status, message, extra = {}) {
    return Object.assign(new Error(message), { status, ...extra });
}

function hasOpaqueRevision(value) {
    if (value === null || value === undefined) return false;
    if (typeof value === "string") return value.trim().length > 0;
    return true;
}

function resolveRequest(input, { requireDraftSession = false } = {}) {
    if (!input || typeof input !== "object") throw fail(422, "Input object is required.");
    if (typeof input.root !== "string" || !input.root.trim()) {
        throw fail(422, "root is required.");
    }
    const relPath =
        (typeof input.relPath === "string" && input.relPath.trim()) ||
        (typeof input.path === "string" && input.path.trim()) ||
        null;
    if (!relPath) throw fail(422, "relPath or path is required.");
    const draftSessionKey =
        typeof input.draftSessionKey === "string" && input.draftSessionKey.trim()
            ? input.draftSessionKey.trim()
            : null;
    if (requireDraftSession && !draftSessionKey) {
        throw fail(422, "draftSessionKey is required.");
    }
    return {
        root: input.root,
        relPath,
        documentPath: isAbsolute(relPath) ? relPath : resolve(input.root, relPath),
        draftSessionKey,
    };
}

function normalizeDraftInput(draft) {
    if (!draft || typeof draft !== "object") return null;
    const content =
        typeof draft.content === "string"
            ? draft.content
            : typeof draft.markdown === "string"
                ? draft.markdown
                : null;
    if (content === null) return null;
    return {
        content,
        baseRevision: draft.baseRevision ?? null,
        revision: draft.revision ?? null,
    };
}

function toDraftShape(draft) {
    if (!draft) return null;
    return {
        content: draft.markdown,
        baseRevision: draft.baseRevision ?? null,
        revision: draft.revision ?? null,
        status: draft.status ?? null,
        requestId: draft.requestId ?? null,
        updatedAt: draft.updatedAt ?? null,
    };
}

function readCurrent({ root, documentPath, draftSessionKey, allowMissing = false }) {
    return readDocumentWithDraft({
        draftRoot: root,
        documentPath,
        sessionId: draftSessionKey ?? `documents-read:${process.pid}:${randomUUID()}`,
        allowMissing,
    });
}

export async function readDocument(input) {
    const request = resolveRequest(input);
    const document = readCurrent({
        root: request.root,
        documentPath: request.documentPath,
        draftSessionKey: request.draftSessionKey,
        allowMissing: Boolean(input?.allowMissing),
    });
    return {
        content: document.markdown,
        revision: document.revision,
        draft: toDraftShape(document.draft),
    };
}

export async function readDraft(input) {
    const request = resolveRequest(input, { requireDraftSession: true });
    const document = readCurrent({
        root: request.root,
        documentPath: request.documentPath,
        draftSessionKey: request.draftSessionKey,
        allowMissing: true,
    });
    return toDraftShape(document.draft);
}

export async function saveDraft(input) {
    const request = resolveRequest(input, { requireDraftSession: true });
    const draft = normalizeDraftInput(input?.draft);
    if (!draft) throw fail(422, "draft content is required.");

    const current = readCurrent({
        root: request.root,
        documentPath: request.documentPath,
        draftSessionKey: request.draftSessionKey,
        allowMissing: true,
    });
    const baseRevision = draft.baseRevision ?? input?.baseRevision ?? current.revision ?? null;
    if (!hasOpaqueRevision(baseRevision)) {
        throw fail(422, "baseRevision is required.");
    }
    const saved = await saveDocumentDraft({
        draftRoot: request.root,
        documentPath: request.documentPath,
        sessionId: request.draftSessionKey,
        markdown: draft.content,
        baseRevision,
        expectedDraftRevision:
            input?.expectedDraftRevision ?? draft.revision ?? current.draft?.revision ?? null,
        createIfMissing: current.revision === null,
    });
    return toDraftShape(saved.draft);
}

export async function clearDraft(input) {
    const request = resolveRequest(input, { requireDraftSession: true });
    return clearDocumentDraft({
        draftRoot: request.root,
        documentPath: request.documentPath,
        sessionId: request.draftSessionKey,
        allowMissing: true,
    });
}

export async function replaceDocument(input) {
    const request = resolveRequest(input);
    if (!hasOpaqueRevision(input?.expectedRevision)) {
        throw fail(422, "expectedRevision is required.");
    }
    if (typeof input?.content !== "string") {
        throw fail(422, "content is required.");
    }
    const draftSessionKey =
        request.draftSessionKey ?? `documents-replace:${process.pid}:${randomUUID()}`;
    const current = readCurrent({
        root: request.root,
        documentPath: request.documentPath,
        draftSessionKey,
        allowMissing: true,
    });
    const draft = normalizeDraftInput(input?.draft) ?? {
        content: input.content,
        baseRevision: input.expectedRevision,
        revision: null,
    };
    const createIfMissing = current.revision === null;
    try {
        const saved = await saveDocumentDraft({
            draftRoot: request.root,
            documentPath: request.documentPath,
            sessionId: draftSessionKey,
            markdown: draft.content,
            baseRevision: draft.baseRevision ?? input.expectedRevision,
            expectedDraftRevision:
                input?.expectedDraftRevision ?? draft.revision ?? current.draft?.revision ?? null,
            createIfMissing,
        });
        const queued = await queueDocumentApply({
            draftRoot: request.root,
            documentPath: request.documentPath,
            sessionId: draftSessionKey,
            expectedDraftRevision: saved.draft?.revision,
            createIfMissing,
        });
        const committed = await commitQueuedDocument({
            draftRoot: request.root,
            documentPath: request.documentPath,
            sessionId: draftSessionKey,
            requestId: queued.requestId,
            expectedRevision: input.expectedRevision,
            createIfMissing,
        });
        await clearDocumentDraft({
            draftRoot: request.root,
            documentPath: request.documentPath,
            sessionId: draftSessionKey,
            allowMissing: true,
        });
        return { revision: committed.proof?.revision ?? null };
    } catch (error) {
        if (Number(error?.status) !== 409) throw error;
        const latest = readCurrent({
            root: request.root,
            documentPath: request.documentPath,
            allowMissing: true,
        });
        return {
            conflict: true,
            currentRevision: error?.conflict?.currentRevision ?? latest.revision ?? null,
            currentContent: error?.conflict?.currentContent ?? latest.markdown ?? "",
        };
    }
}
