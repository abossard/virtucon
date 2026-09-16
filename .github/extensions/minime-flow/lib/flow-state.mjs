import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { listOpenBlueprints, readBlueprint } from "./blueprints.mjs";

export const phaseDescriptors = JSON.parse(
    readFileSync(new URL("../phases.json", import.meta.url), "utf8"),
);

const phaseIds = new Set(phaseDescriptors.map((phase) => phase.id));
const ACTIVE_RUN_STATUSES = new Set(["launching", "queued", "running"]);
const ACTIVE_NATIVE_TASK_STATUSES = new Set(["running"]);
const MAX_SUBAGENT_EVENTS = 200;

function now() {
    return new Date().toISOString();
}

function asObject(value) {
    return value && typeof value === "object" ? value : {};
}

function normalizePhase(phase) {
    return typeof phase === "string" && phaseIds.has(phase) ? phase : null;
}

function phaseFromExplicitText(text) {
    if (typeof text !== "string") return null;
    const match = text.match(/\b(?:phase|minimePhase)\s*[:=]\s*(blueprint|replicate|inspect|extract)\b/i);
    if (!match) return null;
    return normalizePhase(match[1]?.toLowerCase());
}

function phaseFromAgentType(agentType) {
    if (agentType === "minime:frau") return "inspect";
    if (agentType === "minime:dr-evil") return "blueprint";
    return null;
}

function phaseFromTaskArguments(args) {
    const payload = asObject(args);
    const explicit = normalizePhase(payload.phase) ?? normalizePhase(payload.minimePhase);
    if (explicit) return explicit;
    if (typeof payload.name === "string") {
        const fromName = normalizePhase(payload.name.trim().toLowerCase());
        if (fromName) return fromName;
    }
    if (typeof payload.agent_type === "string") {
        const fromType = phaseFromAgentType(payload.agent_type);
        if (fromType) return fromType;
    }
    return null;
}

function phaseFromSubagentData(data) {
    const payload = asObject(data);
    if (typeof payload.phase === "string") {
        const explicit = normalizePhase(payload.phase);
        if (explicit) return explicit;
    }
    if (typeof payload.agentDisplayName === "string") {
        const fromDisplayName = normalizePhase(payload.agentDisplayName.trim().toLowerCase());
        if (fromDisplayName) return fromDisplayName;
    }
    if (typeof payload.agentType === "string") {
        const fromAgentType = phaseFromAgentType(payload.agentType);
        if (fromAgentType) return fromAgentType;
    }
    if (typeof payload.agentName === "string") {
        const fromAgentName = phaseFromAgentType(payload.agentName);
        if (fromAgentName) return fromAgentName;
    }
    return null;
}

function phaseFromTaskListInfo(task) {
    if (typeof task?.displayName === "string") {
        const fromDisplayName = normalizePhase(task.displayName.trim().toLowerCase());
        if (fromDisplayName) return fromDisplayName;
    }
    const fromDescription = phaseFromExplicitText(task?.description);
    if (fromDescription) return fromDescription;
    const fromPrompt = phaseFromExplicitText(task?.prompt);
    if (fromPrompt) return fromPrompt;
    if (typeof task?.agentType === "string") {
        const fromAgentType = phaseFromAgentType(task.agentType);
        if (fromAgentType) return fromAgentType;
    }
    return null;
}

function normalizeBlueprintHint(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    return value.trim().replace(/\\/g, "/").replace(/^\.?\//, "");
}

function blueprintHintFromText(text) {
    if (typeof text !== "string") return null;
    const pathMatch = text.match(/\bblueprintPath\s*[:=]\s*([^\s,;]+)/i);
    if (pathMatch) return normalizeBlueprintHint(pathMatch[1]);
    const fileMatch = text.match(/\bblueprint\s*[:=]\s*([^\s,;]+)/i);
    if (fileMatch) return normalizeBlueprintHint(fileMatch[1]);
    return null;
}

function blueprintHintFromTask(task) {
    return (
        blueprintHintFromText(task?.displayName) ??
        blueprintHintFromText(task?.description) ??
        blueprintHintFromText(task?.prompt)
    );
}

function blueprintMatchesSelection(hint, selection) {
    if (!hint) return true;
    const normalizedPath = normalizeBlueprintHint(selection?.blueprintPath);
    if (normalizedPath && hint === normalizedPath) return true;
    const selectedFilename = selection?.filename;
    if (typeof selectedFilename === "string" && selectedFilename) {
        return basename(hint) === selectedFilename;
    }
    return false;
}

function runStatusFromTaskStatus(status) {
    if (status === "running") return "running";
    if (status === "idle") return "completed";
    if (status === "completed" || status === "failed" || status === "cancelled") return status;
    return null;
}

function runName(toolName, args) {
    const payload = asObject(args);
    if (typeof payload.name === "string" && payload.name.trim()) return payload.name.trim();
    if (typeof payload.agent_type === "string" && payload.agent_type.trim()) return payload.agent_type.trim();
    return toolName ?? "Agent activity";
}

function currentRunStatus(runs) {
    if (runs.some((run) => run.status === "running")) return "running";
    if (runs.some((run) => run.status === "launching")) return "launching";
    if (runs.some((run) => run.status === "queued")) return "queued";
    if (runs.some((run) => run.status === "failed")) return "failed";
    if (runs.some((run) => run.status === "cancelled")) return "cancelled";
    if (runs.some((run) => run.status === "completed")) return "completed";
    return "waiting";
}

function latestFlowRun(runs) {
    const flowRuns = runs.filter((run) => run.flowOwned && run.phase);
    if (flowRuns.length === 0) return null;
    return flowRuns.at(-1);
}

function emptyCurrentWork() {
    return {
        phase: "unknown",
        criterionId: null,
        criterion: "Unknown criterion.",
        needsInput: false,
        evidence: [],
        history: [],
        agents: [],
        status: "unknown",
        requestId: null,
    };
}

function publicDocument(document) {
    if (!document) return null;
    return {
        filename: document.filename,
        path: document.path,
        revision: document.revision,
        draft: document.draft
            ? {
                baseRevision: document.draft.baseRevision ?? null,
                revision: document.draft.revision,
                status: document.draft.status ?? "saved",
                requestId: document.draft.requestId ?? null,
            }
            : null,
    };
}

export class FlowState {
    constructor({ root, repository, selectedBlueprint }) {
        this.root = root;
        this.repository = repository;
        this.selectedBlueprint = selectedBlueprint;
        this.revision = 0;
        this.runs = new Map();
        this.runsByAgentId = new Map();
        this.subscribers = new Set();
        this.apply = { state: "idle", message: "Ready for draft save or apply.", requestId: null };
        this.currentWorkReport = emptyCurrentWork();
        this.subagentEvents = [];
        this.sessionState = { status: "idle", message: "Waiting for session activity.", at: now() };
        this.blueprints = [];
        this.blueprint = null;
        this.document = null;
        this.refresh();
    }

    refresh() {
        this.blueprints = listOpenBlueprints(this.root);
        this.selectedBlueprint ??= this.blueprints[0]?.filename ?? null;
        this.blueprint = this.selectedBlueprint
            ? readBlueprint(this.root, this.selectedBlueprint).model
            : null;
        return this.publish();
    }

    select(filename) {
        const selected = readBlueprint(this.root, filename).model;
        this.selectedBlueprint = selected.filename;
        this.blueprint = selected;
        return this.publish();
    }

    selectedFile() {
        if (!this.selectedBlueprint) throw new Error("No open blueprint is selected.");
        return readBlueprint(this.root, this.selectedBlueprint);
    }

    setDocument(document) {
        this.document = publicDocument(document);
        return this.publish();
    }

    setApply(state, message, requestId = null) {
        this.apply = { state, message, requestId };
        return this.publish();
    }

    reportProgress(report = {}) {
        const payload = asObject(report);
        const reportedPhase = normalizePhase(payload.phase);
        const runId =
            (typeof payload.toolCallId === "string" && payload.toolCallId) ||
            (typeof payload.agentId === "string" && this.runsByAgentId.get(payload.agentId));
        if (runId && this.runs.has(runId) && reportedPhase) {
            const run = this.runs.get(runId);
            run.phase = reportedPhase;
            run.flowOwned = true;
        }
        this.currentWorkReport = {
            phase: reportedPhase ?? "unknown",
            criterionId: typeof payload.criterionId === "string" ? payload.criterionId : null,
            criterion: typeof payload.criterion === "string" && payload.criterion.trim()
                ? payload.criterion.trim()
                : "Unknown criterion.",
            needsInput: Boolean(payload.needsInput),
            evidence: Array.isArray(payload.evidence) ? payload.evidence : [],
            history: Array.isArray(payload.history) ? payload.history : [],
            agents: Array.isArray(payload.agents) ? payload.agents : [],
            status: typeof payload.status === "string" ? payload.status : "unknown",
            requestId: typeof payload.requestId === "string" ? payload.requestId : null,
            updatedAt: now(),
        };
        return this.publish();
    }

    recordSubagentEvent(type, event, data) {
        this.subagentEvents.push({
            type,
            agentId: typeof event?.agentId === "string" ? event.agentId : null,
            data,
            timestamp: typeof event?.timestamp === "string" ? event.timestamp : now(),
        });
        if (this.subagentEvents.length > MAX_SUBAGENT_EVENTS) this.subagentEvents.shift();
    }

    createRun(data) {
        const toolName = String(data.toolName ?? "tool");
        const phase = toolName === "task" ? phaseFromTaskArguments(data.arguments) : null;
        const run = {
            id: String(data.toolCallId ?? `${Date.now()}`),
            tool: toolName,
            name: runName(toolName, data.arguments),
            phase,
            flowOwned: phase !== null,
            status: toolName === "task" ? "launching" : "running",
            startedAt: now(),
            agentId: null,
            parentAgentId: null,
            configuredModel: null,
            effectiveModel: null,
            configuredModelPreference: null,
            explicitModelOverride: null,
            firstDispatchedModel: null,
            totalToolCalls: null,
            totalTokens: null,
            durationMs: null,
            multiTurn: null,
            executionMode: null,
            nativeTaskStatus: null,
            cancelled: false,
        };
        this.runs.set(run.id, run);
        return run;
    }

    syncNativeTasks(tasks, selection = {}) {
        const taskList = Array.isArray(tasks) ? tasks : [];
        const activeAgentIds = new Set();
        const activeToolCallIds = new Set();
        let changed = false;

        for (const task of taskList) {
            if (!task || task.type !== "agent") continue;
            const toolCallId = typeof task.toolCallId === "string" && task.toolCallId ? task.toolCallId : null;
            const agentId = typeof task.id === "string" && task.id ? task.id : null;
            let run = toolCallId ? this.runs.get(toolCallId) : null;
            if (!run && agentId && this.runsByAgentId.has(agentId)) {
                run = this.runs.get(this.runsByAgentId.get(agentId));
            }

            const inferredPhase = run?.phase ?? phaseFromTaskListInfo(task);
            if (!run && !inferredPhase) continue;
            if (!blueprintMatchesSelection(blueprintHintFromTask(task), selection)) continue;

            if (!run) {
                run = this.createRun({
                    toolCallId: toolCallId ?? `task-${agentId ?? Date.now()}`,
                    toolName: "task",
                    arguments: {
                        name:
                            (typeof task.displayName === "string" && task.displayName) ||
                            inferredPhase ||
                            task.agentType ||
                            "task",
                        phase: inferredPhase ?? undefined,
                        agent_type: task.agentType ?? undefined,
                    },
                });
                changed = true;
            }
            if (!run.phase && inferredPhase) {
                run.phase = inferredPhase;
                run.flowOwned = true;
                changed = true;
            }
            if (agentId && run.agentId !== agentId) {
                run.agentId = agentId;
                this.runsByAgentId.set(agentId, run.id);
                changed = true;
            }
            if (typeof task.agentType === "string" && run.agentName !== task.agentType) {
                run.agentName = task.agentType;
                changed = true;
            }
            if (typeof task.displayName === "string" && task.displayName && run.agentDisplayName !== task.displayName) {
                run.agentDisplayName = task.displayName;
                changed = true;
            }
            if (typeof task.executionMode === "string" && run.executionMode !== task.executionMode) {
                run.executionMode = task.executionMode;
                changed = true;
            }
            if (typeof task.model === "string" && run.configuredModel !== task.model) {
                run.configuredModel = task.model;
                changed = true;
            }
            const effectiveModel =
                (typeof task.resolvedModel === "string" && task.resolvedModel) ||
                (typeof task.model === "string" && task.model) ||
                run.effectiveModel;
            if (effectiveModel && run.effectiveModel !== effectiveModel) {
                run.effectiveModel = effectiveModel;
                changed = true;
            }
            if (typeof task.status === "string" && run.nativeTaskStatus !== task.status) {
                run.nativeTaskStatus = task.status;
                changed = true;
            }
            const mappedStatus = runStatusFromTaskStatus(task.status);
            if (mappedStatus && run.status !== mappedStatus) {
                run.status = mappedStatus;
                changed = true;
            }
            if (typeof task.error === "string" && task.error && run.error !== task.error) {
                run.error = task.error;
                changed = true;
            }
            if (typeof task.startedAt === "string" && run.startedAt !== task.startedAt) {
                run.startedAt = task.startedAt;
                changed = true;
            }
            if (typeof task.completedAt === "string" && run.completedAt !== task.completedAt) {
                run.completedAt = task.completedAt;
                changed = true;
            }

            if (run.flowOwned && ACTIVE_NATIVE_TASK_STATUSES.has(task.status)) {
                if (agentId) activeAgentIds.add(agentId);
                if (toolCallId) activeToolCallIds.add(toolCallId);
            }
        }

        if (changed) this.publish();
        return {
            activeAgentIds: [...activeAgentIds],
            activeToolCallIds: [...activeToolCallIds],
        };
    }

    onToolStart(data) {
        const payload = asObject(data);
        if (!payload.toolCallId) return;
        const existing = this.runs.get(payload.toolCallId);
        if (!existing) this.createRun(payload);
        this.publish();
    }

    onToolComplete(data) {
        const payload = asObject(data);
        const run = this.runs.get(payload.toolCallId);
        if (!run) return;
        if (run.tool === "task") {
            if (!payload.success) {
                run.status = "failed";
                run.success = false;
                run.error = payload.error?.message ?? "Task launch failed.";
                run.completedAt = now();
            } else if (!run.agentId) {
                run.status = "queued";
            }
        } else {
            run.status = payload.success ? "completed" : "failed";
            run.success = Boolean(payload.success);
            run.completedAt = now();
            if (!payload.success) run.error = payload.error?.message ?? "Tool execution failed.";
        }
        this.publish();
    }

    findRunBySubagent(event) {
        const agentId = event?.agentId;
        if (agentId && this.runsByAgentId.has(agentId)) {
            return this.runs.get(this.runsByAgentId.get(agentId));
        }
        const toolCallId = event?.data?.toolCallId;
        if (toolCallId && this.runs.has(toolCallId)) return this.runs.get(toolCallId);
        return null;
    }

    onSubagentStarted(event) {
        const payload = asObject(event?.data);
        let run = this.findRunBySubagent(event);
        if (!run && payload.toolCallId) {
            run = this.createRun({
                toolCallId: payload.toolCallId,
                toolName: "task",
                arguments: {
                    name: payload.agentDisplayName ?? payload.agentName,
                    agent_type: payload.agentType ?? payload.agentName,
                },
            });
        }
        if (!run) return;
        if (!run.phase) run.phase = phaseFromSubagentData(payload);
        if (run.phase) run.flowOwned = true;
        run.status = "running";
        run.agentId = event?.agentId ?? run.agentId;
        run.parentAgentId = payload.parentId ?? run.parentAgentId;
        run.agentName = payload.agentName ?? run.agentName;
        run.agentDisplayName = payload.agentDisplayName ?? run.agentDisplayName;
        run.effectiveModel = payload.model ?? run.effectiveModel;
        if (event?.agentId) this.runsByAgentId.set(event.agentId, run.id);
        this.recordSubagentEvent("subagent.started", event, {
            toolCallId: typeof payload.toolCallId === "string" ? payload.toolCallId : null,
            agentName: typeof payload.agentName === "string" ? payload.agentName : null,
            agentDisplayName: typeof payload.agentDisplayName === "string" ? payload.agentDisplayName : null,
            model: typeof payload.model === "string" ? payload.model : null,
            executionMode: typeof payload.executionMode === "string" ? payload.executionMode : null,
            parentId: typeof payload.parentId === "string" ? payload.parentId : null,
        });
        this.publish();
    }

    onSubagentConfigured(event) {
        const payload = asObject(event?.data);
        const run = this.findRunBySubagent(event);
        if (!run) return;
        run.configuredModel = payload.model ?? run.configuredModel;
        run.effectiveModel = payload.model ?? run.effectiveModel;
        run.multiTurn = typeof payload.multiTurn === "boolean" ? payload.multiTurn : run.multiTurn;
        this.recordSubagentEvent("subagent.configured", event, {
            model: typeof payload.model === "string" ? payload.model : null,
            multiTurn: typeof payload.multiTurn === "boolean" ? payload.multiTurn : null,
        });
        this.publish();
    }

    onSubagentCompleted(event) {
        const payload = asObject(event?.data);
        const run = this.findRunBySubagent(event);
        if (!run) return;
        run.cancelled = Boolean(payload.cancelled);
        run.status = run.cancelled ? "cancelled" : "completed";
        run.completedAt = now();
        run.configuredModelPreference =
            payload.configuredModelPreference ?? run.configuredModelPreference;
        run.explicitModelOverride = payload.explicitModelOverride ?? run.explicitModelOverride;
        run.firstDispatchedModel = payload.firstDispatchedModel ?? run.firstDispatchedModel;
        run.totalToolCalls =
            typeof payload.totalToolCalls === "number" ? payload.totalToolCalls : run.totalToolCalls;
        run.totalTokens =
            typeof payload.totalTokens === "number" ? payload.totalTokens : run.totalTokens;
        run.durationMs =
            typeof payload.durationMs === "number" ? payload.durationMs : run.durationMs;
        run.effectiveModel =
            payload.firstDispatchedModel ??
            payload.model ??
            run.effectiveModel ??
            run.configuredModel ??
            "unknown";
        this.recordSubagentEvent("subagent.completed", event, {
            toolCallId: typeof payload.toolCallId === "string" ? payload.toolCallId : null,
            agentName: typeof payload.agentName === "string" ? payload.agentName : null,
            agentDisplayName: typeof payload.agentDisplayName === "string" ? payload.agentDisplayName : null,
            model: typeof payload.model === "string" ? payload.model : null,
            firstDispatchedModel: typeof payload.firstDispatchedModel === "string" ? payload.firstDispatchedModel : null,
            explicitModelOverride: typeof payload.explicitModelOverride === "string" ? payload.explicitModelOverride : null,
            totalToolCalls: typeof payload.totalToolCalls === "number" ? payload.totalToolCalls : null,
            totalTokens: typeof payload.totalTokens === "number" ? payload.totalTokens : null,
            durationMs: typeof payload.durationMs === "number" ? payload.durationMs : null,
            cancelled: Boolean(payload.cancelled),
        });
        this.publish();
    }

    onSubagentFailed(event) {
        const payload = asObject(event?.data);
        const run = this.findRunBySubagent(event);
        if (!run) return;
        run.status = "failed";
        run.completedAt = now();
        run.error = payload.error ?? "Sub-agent failed.";
        run.configuredModelPreference =
            payload.configuredModelPreference ?? run.configuredModelPreference;
        run.explicitModelOverride = payload.explicitModelOverride ?? run.explicitModelOverride;
        run.firstDispatchedModel = payload.firstDispatchedModel ?? run.firstDispatchedModel;
        run.totalToolCalls =
            typeof payload.totalToolCalls === "number" ? payload.totalToolCalls : run.totalToolCalls;
        run.totalTokens =
            typeof payload.totalTokens === "number" ? payload.totalTokens : run.totalTokens;
        run.durationMs =
            typeof payload.durationMs === "number" ? payload.durationMs : run.durationMs;
        run.effectiveModel =
            payload.firstDispatchedModel ??
            payload.model ??
            run.effectiveModel ??
            run.configuredModel ??
            "unknown";
        this.recordSubagentEvent("subagent.failed", event, {
            toolCallId: typeof payload.toolCallId === "string" ? payload.toolCallId : null,
            agentName: typeof payload.agentName === "string" ? payload.agentName : null,
            agentDisplayName: typeof payload.agentDisplayName === "string" ? payload.agentDisplayName : null,
            model: typeof payload.model === "string" ? payload.model : null,
            firstDispatchedModel: typeof payload.firstDispatchedModel === "string" ? payload.firstDispatchedModel : null,
            explicitModelOverride: typeof payload.explicitModelOverride === "string" ? payload.explicitModelOverride : null,
            totalToolCalls: typeof payload.totalToolCalls === "number" ? payload.totalToolCalls : null,
            totalTokens: typeof payload.totalTokens === "number" ? payload.totalTokens : null,
            durationMs: typeof payload.durationMs === "number" ? payload.durationMs : null,
            error: typeof payload.error === "string" ? payload.error : "Sub-agent failed.",
        });
        this.publish();
    }

    onPermissionRequested(event) {
        const payload = asObject(event?.data);
        const request = asObject(payload.permissionRequest);
        const summary = request.intention ?? `Permission required for ${request.kind ?? "action"}.`;
        this.reportProgress({
            ...this.currentWorkReport,
            needsInput: true,
            status: "needs_input",
            requestId: payload.requestId ?? this.currentWorkReport.requestId,
            evidence: [{ label: "needs-you", detail: summary }],
        });
    }

    onSessionState(status, message) {
        this.sessionState = { status, message, at: now() };
        if (status === "completed" || status === "aborted") {
            this.currentWorkReport = { ...this.currentWorkReport, needsInput: false };
        }
        this.publish();
    }

    hasActiveFlowWorkers() {
        return [...this.runs.values()].some(
            (run) => run.flowOwned && ACTIVE_RUN_STATUSES.has(run.status),
        );
    }

    subscribe(callback) {
        this.subscribers.add(callback);
        callback(this.snapshot());
        return () => this.subscribers.delete(callback);
    }

    publish() {
        this.revision += 1;
        const snapshot = this.snapshot();
        for (const subscriber of this.subscribers) subscriber(snapshot);
        return snapshot;
    }

    snapshot() {
        const runs = [...this.runs.values()].map((run) => ({ ...run }));
        const latest = latestFlowRun(runs);
        const reportPhase = this.currentWorkReport.phase ?? "unknown";
        const activeAgents = runs
            .filter((run) => run.flowOwned && run.agentId)
            .map((run) => ({
                agentId: run.agentId,
                parentAgentId: run.parentAgentId ?? null,
                name: run.agentDisplayName ?? run.agentName ?? run.name,
                phase: run.phase ?? "unknown",
                status: run.status,
                effectiveModel: run.effectiveModel ?? "unknown",
            }));
        const currentWork = {
            ...emptyCurrentWork(),
            ...this.currentWorkReport,
            phase: reportPhase === "unknown" ? (latest?.phase ?? "unknown") : reportPhase,
            history: this.currentWorkReport.history?.length
                ? this.currentWorkReport.history
                : [],
            agents: this.currentWorkReport.agents?.length
                ? this.currentWorkReport.agents
                : activeAgents,
            session: this.sessionState,
            unmappedRuns: runs.filter((run) => run.phase === null),
        };
        const blueprint = this.blueprint
            ? {
                ...this.blueprint,
                path:
                    this.document?.filename === this.blueprint.filename
                        ? this.document.path
                        : this.blueprint.path ?? null,
                revision:
                    this.document?.filename === this.blueprint.filename
                        ? this.document.revision
                        : this.blueprint.revision ?? null,
            }
            : null;
        return {
            revision: this.revision,
            project: { org: this.repository.org, repo: this.repository.repo },
            phases: phaseDescriptors.map((descriptor) => {
                const phaseRuns = runs.filter((run) => run.phase === descriptor.id);
                return {
                    ...descriptor,
                    status: currentRunStatus(phaseRuns),
                    runs: phaseRuns,
                };
            }),
            blueprint,
            blueprints: this.blueprints,
            comment: this.apply,
            apply: this.apply,
            document: this.document,
            currentWork,
            subagentEvents: this.subagentEvents.map((event) => ({
                ...event,
                data: { ...event.data },
            })),
            agentEvents: this.subagentEvents.map((event) => ({
                ...event,
                data: { ...event.data },
            })),
        };
    }
}
