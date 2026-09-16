import { joinSession, createCanvas } from "@github/copilot-sdk/extension";
import { startCanvasServer } from "./lib/server.mjs";
import { guardPhaseDispatch } from "./lib/dispatch-gate.mjs";

const instances = new Map();
let session;
const pendingListeners = new Set();

function runtimeFor(sessionId) {
    if (session) return session;
    return {
        sessionId,
        send: async (input) => (await sessionReady).send(input),
        rpc: { tasks: { list: async () => (await sessionReady).rpc.tasks.list() } },
        on(type, handler) {
            const entry = { type, handler, unsubscribe: null };
            pendingListeners.add(entry);
            return () => {
                pendingListeners.delete(entry);
                entry.unsubscribe?.();
            };
        },
    };
}

function instanceFor(instanceId) {
    const instance = instances.get(instanceId);
    if (!instance) throw new Error("Canvas instance is not open.");
    return instance;
}

const sessionReady = joinSession({
    hooks: {
        onPreToolUse: (input, invocation) =>
            guardPhaseDispatch(input, { sessionId: invocation.sessionId }),
    },
    canvases: [
        createCanvas({
            id: "minime-flow",
            displayName: "Minime flow",
            description: "View live minime phases, edit blueprint drafts, and apply guarded corrections.",
            inputSchema: {
                type: "object",
                properties: {
                    blueprint: { type: "string" },
                    blueprintPath: { type: "string" },
                },
                additionalProperties: false,
            },
            actions: [
                {
                    name: "refresh",
                    description: "Refresh blueprint and live flow state.",
                    handler: ({ instanceId }) => {
                        return instanceFor(instanceId).refresh();
                    },
                },
                {
                    name: "select_blueprint",
                    description: "Select an open repository blueprint by filename.",
                    inputSchema: {
                        type: "object",
                        required: ["blueprint"],
                        properties: { blueprint: { type: "string" } },
                        additionalProperties: false,
                    },
                    handler: ({ instanceId, input }) => {
                        return instanceFor(instanceId).select(input?.blueprint);
                    },
                },
                {
                    name: "read_document",
                    description: "Read the selected blueprint with revision and draft metadata.",
                    inputSchema: {
                        type: "object",
                        properties: { blueprint: { type: "string" } },
                        additionalProperties: false,
                    },
                    handler: ({ instanceId, input }) =>
                        instanceFor(instanceId).readDocument({ blueprint: input?.blueprint }),
                },
                {
                    name: "save_draft",
                    description: "Save a draft without mutating the applied blueprint revision.",
                    inputSchema: {
                        type: "object",
                        required: ["blueprint", "markdown", "baseRevision", "expectedDraftRevision"],
                        properties: {
                            blueprint: { type: "string" },
                            markdown: { type: "string" },
                            baseRevision: { type: "string" },
                            expectedDraftRevision: { type: ["string", "null"] },
                        },
                        additionalProperties: false,
                    },
                    handler: ({ instanceId, input }) =>
                        instanceFor(instanceId).saveDraft({
                            blueprint: input?.blueprint,
                            markdown: input?.markdown,
                            baseRevision: input?.baseRevision,
                            expectedDraftRevision: input?.expectedDraftRevision,
                        }),
                },
                {
                    name: "apply_draft",
                    description: "Queue an apply request for the saved draft and notify the owner asynchronously.",
                    inputSchema: {
                        type: "object",
                        required: ["blueprint", "expectedDraftRevision"],
                        properties: {
                            blueprint: { type: "string" },
                            expectedDraftRevision: { type: "string" },
                        },
                        additionalProperties: false,
                    },
                    handler: ({ instanceId, input }) =>
                        instanceFor(instanceId).queueApply({
                            blueprint: input?.blueprint,
                            expectedDraftRevision: input?.expectedDraftRevision,
                        }),
                },
                {
                    name: "resolve_apply",
                    description: "Reconcile a queued correction with newer worker changes after reading current, draft, and base markdown. Does not modify the applied blueprint.",
                    inputSchema: {
                        type: "object",
                        required: ["requestId", "expectedRevision", "expectedDraftRevision", "markdown"],
                        properties: {
                            requestId: { type: "string" },
                            blueprint: { type: "string" },
                            expectedRevision: { type: "string" },
                            expectedDraftRevision: { type: "string" },
                            markdown: { type: "string" },
                        },
                        additionalProperties: false,
                    },
                    handler: ({ instanceId, input }) => instanceFor(instanceId).resolveApply(input),
                },
                {
                    name: "commit_apply",
                    description: "Commit a queued apply request after flow workers are drained.",
                    inputSchema: {
                        type: "object",
                        required: ["requestId"],
                        properties: {
                            requestId: { type: "string" },
                            blueprint: { type: "string" },
                            expectedRevision: { type: "string" },
                        },
                        additionalProperties: false,
                    },
                    handler: ({ instanceId, input }) =>
                        instanceFor(instanceId).commitApply({
                            requestId: input?.requestId,
                            blueprint: input?.blueprint,
                            expectedRevision: input?.expectedRevision,
                        }),
                },
                {
                    name: "report_progress",
                    description: "Report current phase, criterion, needs-you status, and evidence links.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            phase: { type: "string" },
                            toolCallId: { type: "string" },
                            agentId: { type: "string" },
                            criterionId: { type: "string" },
                            criterion: { type: "string" },
                            needsInput: { type: "boolean" },
                            status: { type: "string" },
                            requestId: { type: "string" },
                            evidence: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        label: { type: "string" },
                                        detail: { type: "string" },
                                        url: { type: "string" },
                                    },
                                    additionalProperties: true,
                                },
                            },
                        },
                        additionalProperties: true,
                    },
                    handler: ({ instanceId, input }) =>
                        instanceFor(instanceId).reportProgress(input),
                },
            ],
            open: async ({ instanceId, sessionId, input }) => {
                let instance = instances.get(instanceId);
                if (!instance) {
                    instance = await startCanvasServer({
                        session: runtimeFor(sessionId),
                        selectedBlueprint: input?.blueprint,
                        selectedBlueprintPath: input?.blueprintPath,
                    });

                    session = await sessionReady;
                    for (const entry of pendingListeners) {
                        entry.unsubscribe = session.on(entry.type, entry.handler);
                    }
                    pendingListeners.clear();
                    instances.set(instanceId, instance);
                } else if (input?.blueprint || input?.blueprintPath) {
                    instance.select({
                        blueprint: input?.blueprint,
                        blueprintPath: input?.blueprintPath,
                    });
                }
                return { title: "Minime flow", url: instance.url, status: "ready" };
            },
            onClose: async ({ instanceId }) => {
                const instance = instances.get(instanceId);
                if (!instance) return;
                instances.delete(instanceId);
                await instance.close();
            },
        }),
    ],
});
