function hasText(value) {
    return typeof value === "string" && value.length > 0;
}

function textOr(value, fallback) {
    return hasText(value) ? value : fallback;
}

function nonEmptyArray(value) {
    return Array.isArray(value) && value.length > 0;
}

const TYPE_TO_STATUS = {
    "subagent.started": "started",
    "subagent.configured": "configured",
    "subagent.completed": "completed",
    "subagent.failed": "failed",
};

function asRecord(value) {
    return value && typeof value === "object" ? value : {};
}

function normalizeRecord(record) {
    const envelope = asRecord(record);
    const data = asRecord(envelope.data);
    if (Object.keys(data).length === 0) return envelope;
    return {
        ...envelope,
        ...data,
        agentId: textOr(envelope.agentId, data.agentId),
        type: textOr(envelope.type, data.type),
    };
}

export function collectAgentRecords(flow, currentWork) {
    const work = asRecord(currentWork);
    if (nonEmptyArray(flow?.subagentEvents)) return flow.subagentEvents;
    if (nonEmptyArray(flow?.agentEvents)) return flow.agentEvents;
    if (nonEmptyArray(work.agents)) return work.agents;
    if (nonEmptyArray(work.subagentEvents)) return work.subagentEvents;
    if (nonEmptyArray(work.agentEvents)) return work.agentEvents;
    return [];
}

export function toAgentSummary(record) {
    const normalized = normalizeRecord(record);
    const status =
        textOr(
            normalized.status,
            TYPE_TO_STATUS[textOr(normalized.type, "")] ?? "unknown",
        );
    const model = textOr(
        normalized.model,
        textOr(
            normalized.firstDispatchedModel,
            textOr(normalized.effectiveModel, "model not provided"),
        ),
    );
    const name = textOr(
        normalized.agentDisplayName,
        textOr(
            normalized.agentName,
            textOr(
                normalized.name,
                textOr(normalized.agentId, textOr(normalized.id, "Unknown agent")),
            ),
        ),
    );

    const details = [];
    details.push(hasText(normalized.agentId) ? `agentId ${normalized.agentId}` : "agentId not provided");
    if (hasText(normalized.toolCallId)) details.push(`toolCallId ${normalized.toolCallId}`);
    if (hasText(normalized.parentId)) details.push(`parentId ${normalized.parentId}`);
    if (hasText(normalized.executionMode)) details.push(`mode ${normalized.executionMode}`);
    if (typeof normalized.multiTurn === "boolean") details.push(`multiTurn ${normalized.multiTurn}`);
    if (typeof normalized.explicitModelOverride === "boolean" || hasText(normalized.explicitModelOverride)) {
        details.push(`explicitModelOverride ${normalized.explicitModelOverride}`);
    }
    if (typeof normalized.cancelled === "boolean") details.push(`cancelled ${normalized.cancelled}`);
    if (hasText(normalized.error)) details.push(`error ${normalized.error}`);
    if (typeof normalized.totalToolCalls === "number") details.push(`toolCalls ${normalized.totalToolCalls}`);
    if (typeof normalized.totalTokens === "number") details.push(`tokens ${normalized.totalTokens}`);
    if (typeof normalized.durationMs === "number") details.push(`durationMs ${normalized.durationMs}`);

    return {
        name,
        status,
        model,
        description: details.join(" · "),
    };
}
