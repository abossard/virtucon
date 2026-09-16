import { randomBytes } from "node:crypto";
import { watch } from "node:fs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { basename, extname, isAbsolute, resolve } from "node:path";
import { deriveRepository, readBlueprint, repositoryBlueprintRoot } from "./blueprints.mjs";
import {
    commitQueuedDocument,
    queueDocumentApply,
    readDocumentDraftState,
    readDocumentWithDraft,
    resolveQueuedDocument,
    saveDocumentDraft,
} from "./document-store.mjs";
import { FlowState } from "./flow-state.mjs";

const UI_ROOT = resolve(new URL("../ui", import.meta.url).pathname);
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MIME = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
};
const ACTIVE_FLOW_STATUSES = new Set(["launching", "queued", "running"]);
const ACTIVE_TASK_STATUSES = new Set(["running"]);

function json(res, status, value) {
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
    });
    res.end(JSON.stringify(value));
}

function fail(res, status, message, extra = {}) {
    json(res, status, { ok: false, error: message, ...extra });
}

function body(req, limit) {
    return new Promise((resolveBody, reject) => {
        let settled = false;
        const rejectOnce = (error) => {
            if (settled) return;
            settled = true;
            reject(error);
        };
        if (Number(req.headers["content-length"] ?? 0) > limit) {
            req.resume();
            rejectOnce(Object.assign(new Error("Request body is too large."), { status: 413 }));
            return;
        }
        const chunks = [];
        let size = 0;
        const onData = (chunk) => {
            size += chunk.length;
            if (size > limit) {
                chunks.length = 0;
                req.off("data", onData);
                req.resume();
                rejectOnce(Object.assign(new Error("Request body is too large."), { status: 413 }));
                return;
            }
            chunks.push(chunk);
        };
        req.on("data", onData);
        req.on("end", () => {
            if (settled) return;
            try {
                const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                settled = true;
                resolveBody(parsed);
            } catch {
                settled = true;
                reject(Object.assign(new Error("Request body must be valid JSON."), { status: 400 }));
            }
        });
        req.on("error", rejectOnce);
    });
}

const safeEqual = (left, right) =>
    typeof left === "string" &&
    typeof right === "string" &&
    left.length === right.length &&
    left === right;

function correctionPrompt({ requestId, path, expectedRevision }) {
    return [
        "A blueprint apply request is queued for the active minime flow owner.",
        `requestId: ${requestId}`,
        `blueprint: ${path}`,
        `expectedRevision: ${expectedRevision}`,
        "Wait until active workers in this minime-flow run are drained.",
        "Then call canvas action commit_apply with requestId and expectedRevision.",
        "Preserve original request, archive, and correction text verbatim while committing the queued draft.",
        "If the draft base is stale, use read_document to read current markdown, draft markdown, and draft.baseMarkdown.",
        "Merge the requested correction with worker evidence, then call resolve_apply with that markdown, expectedRevision from the current document, and expectedDraftRevision from the queued draft.",
        "Resolution preserves the submission and does not write the blueprint. Commit the resolved request, reread it, and resume the remaining work.",
    ].join("\n");
}

function createError(status, message, extra = {}) {
    return Object.assign(new Error(message), { status, ...extra });
}

function canonicalBlueprintPath({ org, repo }, filename) {
    return `${org}/_${repo}/blueprints/${filename}`;
}

function normalizeBlueprintPathInput(blueprintPath) {
    if (typeof blueprintPath !== "string" || !blueprintPath.trim()) {
        throw createError(422, "blueprintPath must be a non-empty string.");
    }
    const trimmed = blueprintPath.trim();
    if (trimmed.includes("\0")) throw createError(422, "blueprintPath is invalid.");
    return trimmed;
}

function shortValue(value) {
    if (value === null || value === undefined) return "null";
    return String(value);
}

export async function startCanvasServer({
    session,
    selectedBlueprint,
    selectedBlueprintPath,
    repository,
    root,
}) {
    const project = repository ?? deriveRepository();
    const projectRoot = root ?? repositoryBlueprintRoot(project);
    const resolveSelectionFromPath = ({ blueprintPath, blueprint }) => {
        const raw = normalizeBlueprintPathInput(blueprintPath);
        const requestedFilename = basename(raw);
        if (blueprint && blueprint !== requestedFilename) {
            throw createError(422, "blueprint and blueprintPath refer to different files.");
        }
        const selected = readBlueprint(projectRoot, requestedFilename);
        const expectedCanonical = canonicalBlueprintPath(project, requestedFilename);
        if (isAbsolute(raw)) {
            if (resolve(raw) !== selected.path) {
                throw createError(422, "blueprintPath points outside this repository's blueprint root.");
            }
        } else {
            const normalized = raw.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/^\/+/, "");
            if (normalized !== expectedCanonical) {
                throw createError(422, "blueprintPath does not match this repository scope.");
            }
        }
        return {
            filename: selected.model.filename,
            path: selected.path,
            blueprintPath: expectedCanonical,
        };
    };
    const initialSelection =
        selectedBlueprintPath != null
            ? resolveSelectionFromPath({
                blueprintPath: selectedBlueprintPath,
                blueprint: selectedBlueprint,
            })
            : null;
    const state = new FlowState({
        root: projectRoot,
        repository: project,
        selectedBlueprint: initialSelection?.filename ?? selectedBlueprint,
    });
    const nonce = randomBytes(24).toString("base64url");
    const clients = new Set();
    const cleanups = [];
    const applyRequests = new Map();
    const editorSessionId = session.sessionId ?? `session-${process.pid}`;
    let taskRecoveryState = {
        status: "unknown",
        source: "session.rpc.tasks.list",
        error: "Native task recovery has not run yet.",
        activeAgentIds: [],
        activeToolCallIds: [],
    };
    let origin;

    const selectedDocument = ({ blueprint, blueprintPath } = {}) => {
        if (blueprintPath != null) {
            return resolveSelectionFromPath({ blueprintPath, blueprint });
        }
        const filename = blueprint ?? state.selectedBlueprint;
        if (!filename) throw createError(404, "No open blueprint is selected.");
        const selected = readBlueprint(projectRoot, filename);
        return {
            filename,
            path: selected.path,
            blueprintPath: canonicalBlueprintPath(project, filename),
        };
    };

    const selectDocument = ({ blueprint, blueprintPath } = {}) => {
        const selected = selectedDocument({ blueprint, blueprintPath });
        const snapshot = state.select(selected.filename);
        return { selected, snapshot };
    };

    const readDocument = ({ blueprint, blueprintPath } = {}) => {
        const selected = selectedDocument({ blueprint, blueprintPath });
        const document = readDocumentWithDraft({
            draftRoot: projectRoot,
            documentPath: selected.path,
            sessionId: editorSessionId,
        });
        state.setDocument(document);
        return document;
    };

    const saveDraft = async ({ blueprint, blueprintPath, markdown, baseRevision, expectedDraftRevision }) => {
        const selected = selectedDocument({ blueprint, blueprintPath });
        const document = await saveDocumentDraft({
            draftRoot: projectRoot,
            documentPath: selected.path,
            sessionId: editorSessionId,
            markdown,
            baseRevision,
            expectedDraftRevision,
        });
        state.setDocument(document);
        state.setApply("saved", "Draft saved.", document.draft?.requestId ?? null);
        return document;
    };

    const activeApplyContext = (selected) => {
        const snapshot = state.snapshot();
        const runs = snapshot?.phases
            ?.flatMap((phase) => phase.runs ?? [])
            ?.filter((run) => ACTIVE_FLOW_STATUSES.has(run.status)) ?? [];
        const activeAgentIds = [];
        const activeToolCallIds = [];
        for (const run of runs) {
            if (typeof run.agentId === "string" && run.agentId) activeAgentIds.push(run.agentId);
            if (typeof run.id === "string" && run.id) activeToolCallIds.push(run.id);
        }
        return {
            phase: typeof snapshot?.currentWork?.phase === "string" ? snapshot.currentWork.phase : "unknown",
            blueprintPath: selected.blueprintPath,
            activeAgentIds: [...new Set(activeAgentIds)],
            activeToolCallIds: [...new Set(activeToolCallIds)],
        };
    };

    const queueApply = async ({ blueprint, blueprintPath, expectedDraftRevision }) => {
        const selected = selectedDocument({ blueprint, blueprintPath });
        const applyContext = activeApplyContext(selected);
        const current = readDocument({
            blueprint: selected.filename,
        });
        const queued = await queueDocumentApply({
            draftRoot: projectRoot,
            documentPath: selected.path,
            sessionId: editorSessionId,
            expectedDraftRevision,
            applyContext,
        });
        const requestExpectedRevision =
            queued.baseRevision ??
            current.draft?.baseRevision ??
            null;
        applyRequests.set(queued.requestId, {
            requestId: queued.requestId,
            blueprint: selected.filename,
            blueprintPath: selected.blueprintPath,
            path: selected.path,
            status: "queued",
            expectedRevision: requestExpectedRevision,
            applyContext: queued.applyContext ?? applyContext,
            recovered: false,
            queuedAt: new Date().toISOString(),
        });
        state.setApply("queued", `Apply queued (${queued.requestId}).`, queued.requestId);
        readDocument({ blueprint: selected.filename });
        try {
            await session.send({
                prompt: correctionPrompt({
                    requestId: queued.requestId,
                    path: selected.path,
                    expectedRevision: shortValue(requestExpectedRevision),
                }),
            });
        } catch (error) {
            applyRequests.set(queued.requestId, {
                ...applyRequests.get(queued.requestId),
                status: "dispatch_failed",
                error: error?.message ?? "Unable to queue owner notification.",
            });
            state.setApply(
                "error",
                `Apply queued but owner notification failed: ${error?.message ?? "unknown error"}`,
                queued.requestId,
            );
            throw createError(502, "Apply request was saved, but owner notification failed.");
        }
        return queued;
    };

    const recoveryConflictError = (recovery = taskRecoveryState) =>
        createError(
            409,
            "Native task recovery is unavailable. Apply is blocked until recovery succeeds.",
            {
                conflict: {
                    workerState: "unknown",
                    replayError: recovery.error ?? "Native task recovery failed.",
                    activeAgentIds: recovery.activeAgentIds ?? [],
                    activeToolCallIds: recovery.activeToolCallIds ?? [],
                },
            },
        );

    const selectedForRecovery = (request = null) => {
        const scopedPath = request?.applyContext?.blueprintPath ?? request?.blueprintPath;
        if (request?.blueprint && scopedPath) {
            return {
                filename: request.blueprint,
                blueprintPath: scopedPath,
            };
        }
        try {
            const selected = selectedDocument();
            return {
                filename: selected.filename,
                blueprintPath: selected.blueprintPath,
            };
        } catch {
            return { filename: null, blueprintPath: null };
        }
    };

    const refreshTaskRecovery = async (request = null) => {
        const listTasks = session?.rpc?.tasks?.list;
        if (typeof listTasks !== "function") {
            taskRecoveryState = {
                status: "unknown",
                source: "session.rpc.tasks.list",
                error: "Native task recovery API is unavailable.",
                activeAgentIds: [],
                activeToolCallIds: [],
                at: new Date().toISOString(),
            };
            return taskRecoveryState;
        }
        try {
            const result = await listTasks();
            if (!Array.isArray(result?.tasks)) throw new Error("Native task list is invalid.");
            const taskList = result.tasks;
            const active = state.syncNativeTasks(taskList, selectedForRecovery(request));
            const activeAgentIds = new Set(active.activeAgentIds);
            const activeToolCallIds = new Set(active.activeToolCallIds);
            const runningTasks = taskList.filter(
                (task) => task?.type === "agent" && ACTIVE_TASK_STATUSES.has(task.status),
            );
            const contextAgentIds = new Set(request?.applyContext?.activeAgentIds ?? []);
            const contextToolCallIds = new Set(request?.applyContext?.activeToolCallIds ?? []);
            for (const task of runningTasks) {
                if (contextAgentIds.has(task.id) && typeof task.id === "string") {
                    activeAgentIds.add(task.id);
                }
                if (contextToolCallIds.has(task.toolCallId) && typeof task.toolCallId === "string") {
                    activeToolCallIds.add(task.toolCallId);
                }
            }

            const hasRecoveredContext =
                Boolean(request?.recovered) &&
                (contextAgentIds.size > 0 || contextToolCallIds.size > 0);
            const foundContextTask =
                taskList.some(
                    (task) => contextAgentIds.has(task.id) || contextToolCallIds.has(task.toolCallId),
                );
            const ambiguousRecoveredContext = hasRecoveredContext && !foundContextTask && runningTasks.length > 0;
            taskRecoveryState = {
                status: ambiguousRecoveredContext ? "unknown" : "ready",
                source: "session.rpc.tasks.list",
                error: ambiguousRecoveredContext
                    ? "Native task association is unresolved after reload."
                    : null,
                activeAgentIds: [...activeAgentIds],
                activeToolCallIds: [...activeToolCallIds],
                at: new Date().toISOString(),
            };
            return taskRecoveryState;
        } catch (error) {
            taskRecoveryState = {
                status: "unknown",
                source: "session.rpc.tasks.list",
                error: error?.message ?? "Native task recovery failed.",
                activeAgentIds: [],
                activeToolCallIds: [],
                at: new Date().toISOString(),
            };
            return taskRecoveryState;
        }
    };

    const resolveApplyRequest = ({ requestId, blueprint }) => {
        const existing = applyRequests.get(requestId);
        const candidateBlueprints = [];
        if (blueprint) candidateBlueprints.push(blueprint);
        if (existing?.blueprint) candidateBlueprints.push(existing.blueprint);
        if (state.selectedBlueprint) candidateBlueprints.push(state.selectedBlueprint);
        for (const item of state.blueprints) candidateBlueprints.push(item.filename);
        for (const filename of new Set(candidateBlueprints)) {
            let selected;
            try {
                selected = selectedDocument({ blueprint: filename });
            } catch (error) {
                if (error?.status === 404) continue;
                throw error;
            }
            const document = readDocumentWithDraft({
                draftRoot: projectRoot,
                documentPath: selected.path,
                sessionId: editorSessionId,
            });
            if (document.draft?.requestId !== requestId) continue;
            const draftState = readDocumentDraftState({
                draftRoot: projectRoot,
                documentPath: selected.path,
                sessionId: editorSessionId,
            });
            const resolved = {
                requestId,
                blueprint: selected.filename,
                blueprintPath: selected.blueprintPath,
                path: selected.path,
                status: draftState?.status ?? document.draft.status ?? "queued",
                expectedRevision: draftState?.baseRevision ?? document.draft.baseRevision ?? document.revision,
                applyContext: draftState?.applyContext ?? existing?.applyContext ?? null,
                recovered: existing?.recovered ?? !existing,
            };
            applyRequests.set(requestId, resolved);
            return resolved;
        }
        if (!existing) return null;
        const resolved = {
            requestId,
            blueprint: existing.blueprint,
            blueprintPath: existing.blueprintPath ?? canonicalBlueprintPath(project, existing.blueprint),
            path: existing.path,
            status: existing.status ?? "queued",
            expectedRevision: existing.expectedRevision,
            applyContext: existing.applyContext ?? null,
            recovered: existing.recovered ?? false,
        };
        applyRequests.set(requestId, resolved);
        return resolved;
    };

    const requireDrainedWorkers = async (request) => {
        const recovery = await refreshTaskRecovery(request);
        if (recovery.status !== "ready") throw recoveryConflictError(recovery);
        if (recovery.activeAgentIds.length > 0 || recovery.activeToolCallIds.length > 0) {
            throw createError(409, "Active minime-flow workers are still running.", {
                conflict: {
                    activeAgentIds: recovery.activeAgentIds,
                    activeToolCallIds: recovery.activeToolCallIds,
                },
            });
        }
        if (state.hasActiveFlowWorkers()) {
            throw createError(409, "Active minime-flow workers are still running.");
        }
    };

    const resolveApply = async ({ requestId, blueprint, expectedRevision, expectedDraftRevision, markdown }) => {
        const request = resolveApplyRequest({ requestId, blueprint });
        if (!request) throw createError(404, "Unknown apply request.");
        await requireDrainedWorkers(request);
        const document = await resolveQueuedDocument({
            draftRoot: projectRoot, documentPath: request.path, sessionId: editorSessionId,
            requestId, expectedRevision, expectedDraftRevision, markdown,
        });
        applyRequests.set(requestId, { ...request, expectedRevision: document.revision, status: "queued" });
        state.setDocument(document);
        state.setApply("queued", "Correction reconciled. Commit the queued request to apply it.", requestId);
        return document;
    };

    const commitApply = async ({ requestId, blueprint, expectedRevision }) => {
        const request = resolveApplyRequest({ requestId, blueprint });
        if (!request) throw createError(404, "Unknown apply request.");
        await requireDrainedWorkers(request);
        try {
            const committed = await commitQueuedDocument({
                draftRoot: projectRoot,
                documentPath: request.path,
                sessionId: editorSessionId,
                requestId,
                expectedRevision: expectedRevision ?? request.expectedRevision,
            });
            const document = readDocument({ blueprint: request.blueprint });
            const result = {
                requestId,
                status: "committed",
                proof: {
                    path: document.path,
                    revision: document.revision,
                },
            };
            applyRequests.set(requestId, result);
            state.setDocument(document);
            state.setApply("success", "Queued draft committed and reread from disk.", requestId);
            return { ...committed, ...result };
        } catch (error) {
            applyRequests.set(requestId, {
                ...request,
                status: "failed",
                error: error?.message ?? "Commit failed.",
            });
            state.setApply("error", error?.message ?? "Commit failed.", requestId);
            throw error;
        }
    };

    const reportProgress = (input = {}) => state.reportProgress(input).currentWork;

    const applySessionEvent = (type, event) => {
        switch (type) {
        case "tool.execution_start":
            state.onToolStart(event?.data);
            break;
        case "tool.execution_complete":
            state.onToolComplete(event?.data);
            break;
        case "subagent.started":
            state.onSubagentStarted(event);
            break;
        case "subagent.configured":
            state.onSubagentConfigured(event);
            break;
        case "subagent.completed":
            state.onSubagentCompleted(event);
            break;
        case "subagent.failed":
            state.onSubagentFailed(event);
            break;
        case "permission.requested":
            state.onPermissionRequested(event);
            break;
        case "assistant.turn_start":
            state.onSessionState("running", "Agent turn in progress.");
            break;
        case "session.idle":
            state.onSessionState(event?.data?.aborted ? "aborted" : "completed", "Agent turn finished.");
            break;
        case "session.error":
            state.onSessionState("error", event?.data?.message ?? "Session error.");
            break;
        default:
            break;
        }
    };

    const server = createServer(async (req, res) => {
        try {
            const url = new URL(req.url ?? "/", origin ?? "http://127.0.0.1");
            const requestOrigin = req.headers.origin;
            if (requestOrigin && requestOrigin !== origin) {
                fail(res, 403, "Cross-origin request rejected.");
                return;
            }
            if (req.method === "POST" && requestOrigin !== origin) {
                fail(res, 403, "A same-origin request is required.");
                return;
            }
            if (req.method === "GET" && url.pathname === "/") {
                const source = await readFile(resolve(UI_ROOT, "index.html"), "utf8");
                res.writeHead(200, {
                    "Content-Type": MIME[".html"],
                    "Cache-Control": "no-store",
                    "Content-Security-Policy": "default-src 'self'; connect-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'",
                    "Referrer-Policy": "no-referrer",
                    "X-Content-Type-Options": "nosniff",
                });
                res.end(source.replace("__MINIME_NONCE__", nonce));
                return;
            }
            if (req.method === "GET" && ["/app.css", "/app.js"].includes(url.pathname)) {
                const source = await readFile(resolve(UI_ROOT, url.pathname.slice(1)));
                res.writeHead(200, {
                    "Content-Type": MIME[extname(url.pathname)],
                    "Cache-Control": "no-store",
                    "X-Content-Type-Options": "nosniff",
                });
                res.end(source);
                return;
            }
            if (req.method === "GET" && url.pathname === "/favicon.ico") {
                res.writeHead(204, { "Cache-Control": "public, max-age=86400" });
                res.end();
                return;
            }
            const suppliedNonce = req.headers["x-minime-nonce"] ?? url.searchParams.get("nonce");
            if (!safeEqual(suppliedNonce, nonce)) {
                fail(res, 403, "Invalid request nonce.");
                return;
            }
            if (req.method === "GET" && url.pathname === "/api/state") {
                json(res, 200, state.snapshot());
                return;
            }
            if (req.method === "GET" && url.pathname === "/api/document") {
                json(res, 200, readDocument({ blueprint: url.searchParams.get("blueprint") }));
                return;
            }
            if (req.method === "GET" && url.pathname === "/events") {
                res.writeHead(200, {
                    "Content-Type": "text/event-stream",
                    "Cache-Control": "no-cache, no-transform",
                    Connection: "keep-alive",
                    "X-Accel-Buffering": "no",
                });
                const send = (snapshot) =>
                    res.write(`id: ${snapshot.revision}\nevent: state\ndata: ${JSON.stringify(snapshot)}\n\n`);
                const unsubscribe = state.subscribe(send);
                const heartbeat = setInterval(() => res.write(": keepalive\n\n"), 15_000);
                clients.add(res);
                req.on("close", () => {
                    clearInterval(heartbeat);
                    unsubscribe();
                    clients.delete(res);
                });
                return;
            }
            if (req.method === "POST" && url.pathname === "/api/select") {
                const input = await body(req, 1024);
                if (!safeEqual(input.nonce, nonce)) {
                    fail(res, 403, "Invalid request nonce.");
                    return;
                }
                const { selected, snapshot } = selectDocument({
                    blueprint: input.blueprint,
                    blueprintPath: input.blueprintPath,
                });
                readDocument({
                    blueprint: selected.filename,
                    blueprintPath: selected.blueprintPath,
                });
                json(res, 200, snapshot);
                return;
            }
            if (req.method === "POST" && url.pathname === "/api/draft") {
                const input = await body(req, MAX_BODY_BYTES);
                if (!safeEqual(input.nonce, nonce)) {
                    fail(res, 403, "Invalid request nonce.");
                    return;
                }
                json(res, 200, await saveDraft(input));
                return;
            }
            if (req.method === "POST" && url.pathname === "/api/apply") {
                const input = await body(req, 4096);
                if (!safeEqual(input.nonce, nonce)) {
                    fail(res, 403, "Invalid request nonce.");
                    return;
                }
                json(res, 200, await queueApply(input));
                return;
            }
            if (req.method === "POST" && url.pathname === "/api/comment") {
                fail(res, 410, "Use /api/draft and /api/apply.");
                return;
            }
            fail(res, 404, "Route not found.");
        } catch (error) {
            if (!res.headersSent) fail(res, error?.status ?? 500, error?.message ?? "Request failed.", {
                conflict: error?.conflict ?? null,
            });
            else res.end();
        }
    });

    await new Promise((resolveListen, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolveListen);
    });
    const address = server.address();
    origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    cleanups.push(
        session.on("tool.execution_start", (event) => applySessionEvent("tool.execution_start", event)),
        session.on("tool.execution_complete", (event) => applySessionEvent("tool.execution_complete", event)),
        session.on("subagent.started", (event) => applySessionEvent("subagent.started", event)),
        session.on("subagent.configured", (event) => applySessionEvent("subagent.configured", event)),
        session.on("subagent.completed", (event) => applySessionEvent("subagent.completed", event)),
        session.on("subagent.failed", (event) => applySessionEvent("subagent.failed", event)),
        session.on("permission.requested", (event) => applySessionEvent("permission.requested", event)),
        session.on("assistant.turn_start", (event) => applySessionEvent("assistant.turn_start", event)),
        session.on("session.idle", (event) => applySessionEvent("session.idle", event)),
        session.on("session.error", (event) => applySessionEvent("session.error", event)),
    );
    // Rehydration can open a canvas before joinSession finishes connecting.
    void refreshTaskRecovery().then((initialRecovery) => {
        if (initialRecovery.status !== "ready") {
            state.setApply("error", `Native task recovery unavailable: ${initialRecovery.error}`, null);
        }
    });
    try {
        readDocument();
    } catch (error) {
        if (error?.status !== 404) throw error;
    }

    let refreshTimer;
    const watcher = watch(projectRoot, () => {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
            try {
                state.refresh();
                try {
                    readDocument();
                } catch (error) {
                    if (error?.status !== 404) throw error;
                }
            } catch (error) {
                state.onSessionState("error", error?.message ?? "Blueprint refresh failed.");
            }
        }, 150);
    });
    cleanups.push(() => { clearTimeout(refreshTimer); watcher.close(); });

    return {
        nonce,
        url: `${origin}/`,
        refresh: () => state.refresh(),
        select: (input) => {
            const { selected, snapshot } = typeof input === "string"
                ? selectDocument({ blueprint: input })
                : selectDocument({
                    blueprint: input?.blueprint,
                    blueprintPath: input?.blueprintPath,
                });
            readDocument({
                blueprint: selected.filename,
                blueprintPath: selected.blueprintPath,
            });
            return snapshot;
        },
        readDocument,
        saveDraft,
        queueApply,
        resolveApply,
        commitApply,
        reportProgress,
        close: async () => {
            for (const cleanup of cleanups) cleanup();
            for (const client of clients) client.end();
            await new Promise((resolveClose) => server.close(resolveClose));
        },
    };
}
