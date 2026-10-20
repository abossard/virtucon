import { isAbsolute, resolve } from "node:path";

export const RUNTIME_ARMS = Object.freeze({
    DEFAULT: "DEFAULT",
    MINIME: "MINIME",
});

export const SUITE_IDS = Object.freeze({
    SMOKE: "smoke",
    HARD: "hard",
});

export const RUNTIME_MODEL_DEFAULT = "GPT-5.3-Codex";
export const RUNTIME_REASONING_DEFAULT = "high";
export const RUNTIME_SOFT_CREDIT_CAP_TARGET = null;
export const RUNTIME_PAYLOAD_COMMIT = "8fdc75eb7ee1c7eb5eb12240fa38fcb1e1234136";

export const TASK_TIME_BUDGET_SECONDS = Object.freeze({
    [SUITE_IDS.SMOKE]: 900,
    [SUITE_IDS.HARD]: 2700,
});

export const WRAPPER_TEARDOWN_GRACE_SECONDS = 30;

export const RESULT_KIND = Object.freeze({
    INFRA_ERROR: "runtime_infra_error",
    CODING_OUTCOME: "coding_outcome",
});

const CODING_OUTCOME_STATUSES = new Set(["completed", "failed", "timeout", "cancelled", "incomplete"]);

function assertString(value, label) {
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`${label} must be a non-empty string.`);
    }
}

function ensureAbsolutePath(pathLike, label) {
    assertString(pathLike, label);
    return isAbsolute(pathLike) ? pathLike : resolve(pathLike);
}

export function assertArm(arm) {
    if (arm !== RUNTIME_ARMS.DEFAULT && arm !== RUNTIME_ARMS.MINIME) {
        throw new Error(`Unknown runtime arm: ${String(arm)}.`);
    }
    return arm;
}

export function assertSuiteId(suiteId) {
    if (suiteId !== SUITE_IDS.SMOKE && suiteId !== SUITE_IDS.HARD) {
        throw new Error(`Unknown suite id: ${String(suiteId)}.`);
    }
    return suiteId;
}

export function taskBudgetSecondsForSuite(suiteId) {
    const suite = assertSuiteId(suiteId);
    return TASK_TIME_BUDGET_SECONDS[suite];
}

export function createRuntimeBudget({ suiteId, teardownGraceSeconds = WRAPPER_TEARDOWN_GRACE_SECONDS } = {}) {
    assertSuiteId(suiteId);
    const taskSeconds = taskBudgetSecondsForSuite(suiteId);
    const wrapperSeconds = taskSeconds + Number(teardownGraceSeconds);
    return {
        suiteId,
        taskSeconds,
        wrapperSeconds,
        teardownGraceSeconds: Number(teardownGraceSeconds),
        descendantInclusiveConfigured: true,
        descendantInclusiveProven: false,
        retriesAllowed: false,
    };
}

export function createLaunchReceipt({
    arm,
    suiteId,
    taskId,
    sessionId,
    budgets,
    paths,
    evidence,
    lineage,
    status,
    timing,
}) {
    assertArm(arm);
    assertSuiteId(suiteId);
    assertString(taskId, "taskId");
    assertString(sessionId, "sessionId");
    return {
        arm,
        suiteId,
        taskId,
        sessionId,
        status: status ?? "prepared",
        budgets: {
            taskSeconds: Number(budgets?.taskSeconds ?? 0),
            wrapperSeconds: Number(budgets?.wrapperSeconds ?? 0),
            descendantInclusiveConfigured: true,
            descendantInclusiveProven: false,
            retriesAllowed: false,
        },
        paths: {
            workspaceRoot: ensureAbsolutePath(paths.workspaceRoot, "paths.workspaceRoot"),
            sourceRoot: ensureAbsolutePath(paths.sourceRoot, "paths.sourceRoot"),
            runtimeRoot: ensureAbsolutePath(paths.runtimeRoot, "paths.runtimeRoot"),
            home: ensureAbsolutePath(paths.home, "paths.home"),
            copilotHome: ensureAbsolutePath(paths.copilotHome, "paths.copilotHome"),
            cacheRoot: ensureAbsolutePath(paths.cacheRoot, "paths.cacheRoot"),
            hqRoot: paths.hqRoot ? ensureAbsolutePath(paths.hqRoot, "paths.hqRoot") : null,
        },
        evidence: {
            authority: "host",
            transcriptsAuthoritative: false,
            launchReceiptPath: ensureAbsolutePath(evidence.launchReceiptPath, "evidence.launchReceiptPath"),
            usageReceiptPath: ensureAbsolutePath(evidence.usageReceiptPath, "evidence.usageReceiptPath"),
            teardownReceiptPath: ensureAbsolutePath(evidence.teardownReceiptPath, "evidence.teardownReceiptPath"),
        },
        lineage: {
            suiteId: lineage?.suiteId ?? null,
            repeatIndex: lineage?.repeatIndex ?? null,
            inputSnapshotId: lineage?.inputSnapshotId ?? null,
            outputSnapshotId: lineage?.outputSnapshotId ?? null,
            lastCompletedSnapshotId: lineage?.lastCompletedSnapshotId ?? null,
        },
        timing: {
            startedAt: timing?.startedAt ?? null,
            endedAt: timing?.endedAt ?? null,
            durationMs: timing?.durationMs ?? null,
        },
    };
}

export function createRuntimeInfraError({
    code,
    message,
    blockerEvidence,
    receipt = null,
}) {
    assertString(code, "code");
    assertString(message, "message");
    return {
        kind: RESULT_KIND.INFRA_ERROR,
        ok: false,
        code,
        message,
        blockerEvidence: {
            missingPrerequisites: Array.isArray(blockerEvidence?.missingPrerequisites)
                ? blockerEvidence.missingPrerequisites
                : [],
            capabilityChecks: Array.isArray(blockerEvidence?.capabilityChecks)
                ? blockerEvidence.capabilityChecks
                : [],
            evidence: Array.isArray(blockerEvidence?.evidence)
                ? blockerEvidence.evidence
                : [],
        },
        receipt,
        codingOutcome: null,
    };
}

export function createCodingOutcome({
    status,
    message,
    receipt,
    metrics = {},
    fidelity = null,
    snapshot = null,
    usage = null,
}) {
    if (!CODING_OUTCOME_STATUSES.has(status)) {
        throw new Error(`Unknown coding outcome status: ${String(status)}.`);
    }
    return {
        kind: RESULT_KIND.CODING_OUTCOME,
        ok: status === "completed",
        status,
        message: message ?? null,
        receipt: receipt ?? null,
        fidelity,
        snapshot,
        usage,
        metrics: {
            durationMs: metrics.durationMs ?? null,
            exitCode: metrics.exitCode ?? null,
            signal: metrics.signal ?? null,
        },
        infraError: null,
    };
}

export function isRuntimeInfraError(result) {
    return result?.kind === RESULT_KIND.INFRA_ERROR;
}

export function isCodingOutcome(result) {
    return result?.kind === RESULT_KIND.CODING_OUTCOME;
}
