export {
    RUNTIME_ARMS,
    SUITE_IDS,
    RUNTIME_MODEL_DEFAULT,
    RUNTIME_REASONING_DEFAULT,
    RUNTIME_SOFT_CREDIT_CAP_TARGET,
    TASK_TIME_BUDGET_SECONDS,
    WRAPPER_TEARDOWN_GRACE_SECONDS,
    RESULT_KIND,
    createRuntimeBudget,
    createRuntimeInfraError,
    createCodingOutcome,
    isRuntimeInfraError,
    isCodingOutcome,
} from "./runtime/contracts.mjs";

export {
    buildRuntimeArmSpecs,
    buildDockerRunPlan,
    ensureLocalRuntimeReady,
    createTaskRuntimeContext,
    runMinimeCompatibilityProbe,
    runManagedRuntimeCommand,
} from "./runtime/launch.mjs";

export { createLineageBase, nextMinimeLineage } from "./runtime/isolation.mjs";

import path from "node:path";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
    RUNTIME_ARMS,
    SUITE_IDS,
    isRuntimeInfraError,
} from "./runtime/contracts.mjs";
import {
    buildRuntimeArmSpecs,
    buildDockerRunPlan,
    createTaskRuntimeContext,
    ensureLocalRuntimeReady,
    runMinimeCompatibilityProbe,
    runManagedRuntimeCommand,
} from "./runtime/launch.mjs";
import { runTaskProbeInContainer } from "./probe.mjs";
import { loadVerifiedCandidate, resolveCandidateSelection } from "./runtime/candidate.mjs";
import {
    auditDirectBlueprint,
    auditQualification,
    classifyLearning,
    knowledgeFields,
    observeHq,
    observeNativeRecords,
    readNativeRecords,
    summarizeKnowledge,
} from "./runtime/qualification.mjs";
import {
    validateScenarioManifest,
    verifySourcePinAuthority,
    verifyTaskAttempt,
} from "./verify.mjs";

const compatibilityCache = new Map();
const repeatSequenceBySuite = new Map();

function runProcess(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, options);
        let stdout = "";
        let stderr = "";
        child.stdout?.on("data", (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr?.on("data", (chunk) => {
            stderr += chunk.toString();
        });
        child.on("error", reject);
        child.on("close", (code, signal) => {
            resolve({ code, signal, stdout, stderr });
        });
    });
}

function resolveRepeatIndex({ suiteKey, context }) {
    const explicit = repeatIndexFromContext(context);
    if (explicit !== null) return explicit;
    const current = repeatSequenceBySuite.get(suiteKey) ?? 0;
    repeatSequenceBySuite.set(suiteKey, current + 1);
    return current;
}

async function clonePinnedSource({ sourcePin, destination }) {
    const authority = await verifySourcePinAuthority(sourcePin);
    if (!authority.ok) {
        throw new Error("Source authority verification failed before clone.");
    }
    const repo = `https://github.com/${sourcePin.repository}.git`;
    const clone = await runProcess("git", ["clone", "--quiet", repo, destination], { stdio: ["ignore", "pipe", "pipe"] });
    if (clone.code !== 0) {
        throw new Error(`git clone failed: ${clone.stderr || clone.stdout}`);
    }
    const checkout = await runProcess("git", ["-C", destination, "checkout", "--quiet", sourcePin.commit], {
        stdio: ["ignore", "pipe", "pipe"],
    });
    if (checkout.code !== 0) {
        throw new Error(`git checkout failed: ${checkout.stderr || checkout.stdout}`);
    }
}

function suiteIdFromManifest(manifest) {
    return manifest.suite.role === "smoke" ? SUITE_IDS.SMOKE : SUITE_IDS.HARD;
}

async function assertCalibrationReceiptCurrent({ suite }) {
    const receiptPath = process.env.PROMPTFOO_CALIBRATION_RECEIPT;
    if (!receiptPath) {
        throw new Error("Missing PROMPTFOO_CALIBRATION_RECEIPT for content-bound calibration gating.");
    }
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    const validation = validateScenarioManifest(suite);
    const identity = receipt.identity ?? {};
    const hashes = Object.fromEntries(
        Object.entries(suite.tasks ?? {}).map(([taskKey, taskDef]) => [taskKey, taskDef.definitionHash ?? null]),
    );
    const matches = receipt.ok === true
        && identity.suite === suite.suite.reportingKey
        && identity.manifestDigest === validation.manifestDigest
        && JSON.stringify(identity.sourcePin ?? {}) === JSON.stringify(suite.sourcePin ?? {})
        && JSON.stringify(identity.taskDefinitionHashes ?? {}) === JSON.stringify(hashes);
    if (!matches) {
        throw new Error(`Calibration receipt mismatch at ${receiptPath}. Re-run validate for ${suite.suite.reportingKey} before model execution.`);
    }
    return receipt;
}

async function collectFiles(root, depth = 0) {
    if (depth > 5) return [];
    const entries = await readdir(root, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const absolute = path.join(root, entry.name);
        if (entry.isDirectory()) {
            files.push(...await collectFiles(absolute, depth + 1));
        } else if (entry.isFile()) {
            files.push(absolute);
        }
    }
    return files;
}

async function buildNativeCompatibilityProbe({
    runtimeRoot,
    suite,
    runtimeProfile,
    armSpecs,
    abortSignal,
}) {
    const suiteId = suiteIdFromManifest(suite);
    const task = suite.orderedTasks[0];
    const taskKey = `${task.id}@${task.version}`;
    const taskDefinition = suite.tasks[taskKey];
    const context = await createTaskRuntimeContext({
        runtimeRoot,
        suiteId,
        repeatIndex: 0,
        taskId: `${task.id}-compat`,
        arm: RUNTIME_ARMS.MINIME,
    });
    await clonePinnedSource({ sourcePin: suite.sourcePin, destination: context.paths.sourceRoot });
    const prompt = [
        "Native compatibility probe.",
        "Run the full minime flow with distinct blueprint, replicate, inspect (with Frau), and extract phases.",
        "Do not modify repository source files.",
        "Write minimal phase evidence to the managed HQ and then finish immediately.",
        "Keep tool usage minimal and call task_complete after recording phase evidence.",
    ].join("\n");
    const launchPlan = buildDockerRunPlan({
        arm: RUNTIME_ARMS.MINIME,
        context,
        armSpecs,
        prompt,
    });
    const runtimeOutcome = await runManagedRuntimeCommand({
        command: launchPlan.command,
        args: launchPlan.args,
        cwd: process.cwd(),
        env: process.env,
        context,
        suiteId,
        arm: RUNTIME_ARMS.MINIME,
        taskId: `${task.id}-compat`,
        abortSignal,
        taskTimeoutMs: Math.min(runtimeProfile.taskTimeoutSeconds * 1000, 600_000),
        wrapperTimeoutMs: Math.min(runtimeProfile.taskTimeoutSeconds * 1000 + 30_000, 660_000),
        teardownGraceMs: 500,
        launchReceiptPath: path.join(context.paths.receiptsRoot, "launch.json"),
        usageReceiptPath: path.join(context.paths.receiptsRoot, "usage.json"),
        teardownReceiptPath: path.join(context.paths.receiptsRoot, "teardown.json"),
    });
    if (isRuntimeInfraError(runtimeOutcome)) {
        return {
            ok: false,
            message: runtimeOutcome.message,
            missingPrerequisites: ["minime-native-launch"],
            capabilityChecks: [{ id: "minime-native-launch", status: "failed", reason: runtimeOutcome.code }],
            evidence: [JSON.stringify(runtimeOutcome.blockerEvidence ?? {})],
        };
    }
    const runtimeUsagePath = path.join(context.paths.runtimeRoot, "usage.json");
    const usageReceiptPath = path.join(context.paths.receiptsRoot, "usage.json");
    const teardownReceiptPath = path.join(context.paths.receiptsRoot, "teardown.json");
    let runtimeUsage = null;
    let usageReceipt = null;
    let teardownReceipt = null;
    try {
        runtimeUsage = JSON.parse(await readFile(runtimeUsagePath, "utf8"));
    } catch {}
    try {
        usageReceipt = JSON.parse(await readFile(usageReceiptPath, "utf8"));
    } catch {}
    try {
        teardownReceipt = JSON.parse(await readFile(teardownReceiptPath, "utf8"));
    } catch {}

    const hasUsage = Boolean(usageReceipt?.available && usageReceipt?.payload?.providerModelMetrics);
    const nativeDiagnostics = teardownReceipt?.nativeDiagnostics ?? usageReceipt?.nativeDiagnostics ?? null;
    const hooks = nativeDiagnostics?.hooks ?? {};
    const fidelity = runtimeOutcome.fidelity ?? null;
    const phaseWorkers = fidelity?.phaseWorkers ?? [];
    const softCapExhausted = /ai_credit_soft_cap_exhausted/i.test(
        `${teardownReceipt?.stdoutTail ?? ""}\n${teardownReceipt?.stderrTail ?? ""}`,
    );
    const hqFiles = await collectFiles(context.paths.hqRoot);
    const hqPopulated = hqFiles.length > 0;
    const compatibilityRuntimeCompleted = runtimeOutcome.status === "completed"
        || softCapExhausted
        || (runtimeOutcome.status === "failed" && hqPopulated && hasUsage);
    const hookOk = Boolean(hooks?.loadedPromptMode) && !hooks?.reloadFailed && hqPopulated;

    const checks = [
        {
            id: "minime-runtime-completed",
            status: compatibilityRuntimeCompleted ? "ok" : "failed",
            reason: runtimeOutcome.status === "completed"
                ? "runtime_completed"
                : softCapExhausted
                    ? "runtime_soft_cap_exhausted_with_evidence"
                    : (runtimeOutcome.status === "failed" && hqPopulated && hasUsage)
                    ? "runtime_failed_with_required_usage_evidence"
                    : `runtime_${runtimeOutcome.status}`,
        },
        { id: "minime-hook-ready", status: hookOk ? "ok" : "failed", reason: hookOk ? "hooks_loaded" : "hook_reload_failed" },
        { id: "minime-hq-populated", status: hqPopulated ? "ok" : "failed", reason: hqPopulated ? "hq_files_present" : "hq_empty" },
        { id: "usage-output-emitted", status: hasUsage ? "ok" : "failed", reason: hasUsage ? "usage_json_present" : "usage_json_missing" },
    ];
    const ok = checks.every((entry) => entry.status === "ok");
    const missingPrerequisites = checks.filter((entry) => entry.status === "failed").map((entry) => entry.id);
    const accountingScope = hasUsage
        ? "usage-output-file emitted by runtime process; includes model and agent metrics as reported by CLI, descendant completeness not externally proven"
        : null;
    return {
        ok,
        message: ok ? "Native MINIME compatibility probe passed." : "Native MINIME compatibility probe failed.",
        missingPrerequisites,
        capabilityChecks: checks,
        evidence: [
            `runtime_usage_path=${runtimeUsagePath}`,
            `usage_receipt_path=${usageReceiptPath}`,
            `hq_files=${hqFiles.length}`,
            `fidelity=${JSON.stringify(fidelity)}`,
            `phase_workers=${JSON.stringify(phaseWorkers)}`,
            `hook_state=${JSON.stringify(hooks)}`,
            `teardown_receipt=${teardownReceiptPath}`,
        ],
        accountingScope,
    };
}

function toTaskPrompt(task, taskDefinition) {
    const definition = taskDefinition?.definition ?? {};
    const publicPrompt = typeof definition.prompt === "string" && definition.prompt.trim().length > 0
        ? definition.prompt.trim()
        : null;
    const requiredExports = definition.api?.requiredExports ?? [];
    const apiChecks = (definition.api?.checks ?? []).map((check) => check.name);
    const allowlist = taskDefinition?.pathAllowlist ?? [];
    const contractLines = Array.isArray(definition.agentContract?.requirements)
        ? definition.agentContract.requirements
        : [];
    return [
        `Task ${task.id}@${task.version}`,
        definition.title ?? task.id,
        `Contract: ${definition.contractVersion ?? "unknown"}`,
        `Allowed paths: ${allowlist.join(", ") || "none"}`,
        `API module: ${definition.api?.module ?? "./src/index.mjs"}`,
        `Required exports: ${requiredExports.join(", ") || "none"}`,
        `API checks: ${apiChecks.join(", ") || "none"}`,
        `CLI target: ${definition.cli?.command ?? "none"}`,
        `Preservation command: ${definition.preservation?.command ?? "none"}`,
        publicPrompt ? `Task requirements:\n${publicPrompt}` : null,
        contractLines.length > 0 ? `Public contract:\n- ${contractLines.join("\n- ")}` : null,
        "Constraints: implement only task-required behavior, keep preservation checks passing, and avoid unrelated file edits.",
    ].filter(Boolean).join("\n");
}

async function defaultCompatibilityProbe({ runtimeRoot, suite, runtimeProfile, armSpecs, abortSignal }) {
    const docker = await runProcess("docker", ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    const copilot = await runProcess("copilot", ["--help"], { stdio: ["ignore", "pipe", "pipe"] });
    const hasCredits = copilot.stdout.includes("--max-ai-credits");
    const hasUsage = copilot.stdout.includes("--usage-output-file");
    const flagsOk = docker.code === 0 && copilot.code === 0 && hasUsage;
    if (!flagsOk) {
        return {
            ok: false,
            missingPrerequisites: ["docker-copilot-compatibility"],
            capabilityChecks: [
                { id: "docker", status: docker.code === 0 ? "ok" : "failed" },
                { id: "copilot-help", status: copilot.code === 0 ? "ok" : "failed" },
                { id: "max-ai-credits-flag", status: hasCredits ? "ok" : "optional-missing" },
                { id: "usage-output-file-flag", status: hasUsage ? "ok" : "failed" },
            ],
            evidence: [
                docker.stdout.trim() || docker.stderr.trim(),
                `copilot-help flags: max-ai-credits=${hasCredits}, usage-output-file=${hasUsage}`,
            ],
            accountingScope: "probe-checked-flags-only",
        };
    }
    return buildNativeCompatibilityProbe({
        runtimeRoot,
        suite,
        runtimeProfile,
        armSpecs,
        abortSignal,
    });
}

function compatibilityCacheKey({ suite, runtimeProfile, candidate = null }) {
    return JSON.stringify({
        candidateManifestSha256: candidate?.approvedCandidateManifestSha256 ?? null,
        suite: suite.suite.reportingKey,
        commit: suite.sourcePin?.commit ?? null,
        payloadCommit: process.env.MINIME_PAYLOAD_COMMIT ?? null,
        model: runtimeProfile.model,
        reasoningEffort: runtimeProfile.reasoningEffort,
        maxAiCredits: runtimeProfile.maxAiCredits,
        timeout: runtimeProfile.taskTimeoutSeconds,
    });
}

function runtimeStatusForTask(task) {
    if (task?.runtimeOutcome?.kind === "runtime_infra_error") return "infra_error";
    return task?.runtimeOutcome?.status ?? "unknown";
}

function toComponent(taskKey, verification, runtimeOutcome) {
    const runtimeStatus = runtimeStatusForTask({ runtimeOutcome });
    const runtimeCompleted = runtimeStatus === "completed";
    const verifierPass = verification.classification.classification === "pass";
    const pass = runtimeCompleted && verifierPass;
    return {
        id: taskKey,
        pass,
        reason: pass
            ? "Runtime completed and verifier contract passed."
            : !runtimeCompleted
                ? `runtime:${runtimeStatus}`
                : `${verification.classification.classification}:${verification.classification.kind ?? "unknown"}`,
    };
}

function overallStatus(armResults, { expectedTaskCount, aborted }) {
    const allTasks = armResults.flatMap((armResult) => armResult.tasks ?? []);
    if (aborted || allTasks.length < expectedTaskCount) return "infrastructure_error";
    const infra = allTasks.some((task) => {
        const classification = task.verification?.classification?.classification;
        const runtimeStatus = runtimeStatusForTask(task);
        return classification === "infrastructure_failure" || runtimeStatus === "infra_error";
    });
    if (infra) return "infrastructure_error";
    const codePass = allTasks.every((task) => {
        const classification = task.verification?.classification?.classification;
        const runtimeStatus = runtimeStatusForTask(task);
        return classification === "pass" && runtimeStatus === "completed";
    });
    return codePass ? "completed" : "failed";
}

function repeatIndexFromContext(context) {
    const candidates = [
        context?.vars?.repeatIndex,
        context?.repeatIndex,
        context?.testIndex,
        context?.vars?.testIndex,
    ];
    for (const raw of candidates) {
        const parsed = Number(raw);
        if (Number.isInteger(parsed) && parsed >= 0) return parsed;
    }
    return null;
}

function armOrderForRepeat(repeatIndex) {
    return repeatIndex % 2 === 0
        ? [RUNTIME_ARMS.DEFAULT, RUNTIME_ARMS.MINIME]
        : [RUNTIME_ARMS.MINIME, RUNTIME_ARMS.DEFAULT];
}

function summarizeArm(armResult) {
    const tasks = armResult.tasks ?? [];
    const completed = tasks.filter((task) => runtimeStatusForTask(task) === "completed").length;
    const infraFailures = tasks.filter((task) => task.verification?.classification?.classification === "infrastructure_failure").length;
    const codingFailures = tasks.filter((task) => task.verification?.classification?.classification === "coding_failure").length;
    const minimeFidelity = armResult.arm === RUNTIME_ARMS.MINIME
        ? tasks.map((task) => {
            const fidelity = task.runtimeOutcome?.fidelity ?? task.runtimeOutcome?.receipt?.fidelity ?? null;
            if (!fidelity) return { task: task.task, status: "unknown" };
            return {
                task: task.task,
                status: fidelity.complete ? "pass" : "failed",
                failure: fidelity.failure ?? null,
                missing: fidelity.missing ?? [],
                phaseWorkers: fidelity.phaseWorkers ?? [],
            };
        })
        : "not_applicable";
    const snapshots = tasks.map((task) => ({
        task: task.task,
        restoredInput: Boolean(task.runtimeOutcome?.receipt?.lineage?.inputSnapshotRestored),
        inputSnapshotMissing: Boolean(task.runtimeOutcome?.receipt?.lineage?.inputSnapshotMissing),
        inputSnapshotFailure: task.runtimeOutcome?.receipt?.lineage?.inputSnapshotFailure ?? null,
        outputSnapshotId: task.runtimeOutcome?.receipt?.lineage?.outputSnapshotId ?? null,
        lastCompletedSnapshotId: task.runtimeOutcome?.receipt?.lineage?.lastCompletedSnapshotId ?? null,
        quarantined: Boolean(task.runtimeOutcome?.snapshot?.quarantined),
        quarantineReasons: task.runtimeOutcome?.snapshot?.quarantineReasons ?? [],
        fidelityComplete: task.runtimeOutcome?.fidelity?.complete ?? null,
        ...knowledgeFields(task, armResult.arm),
    }));
    const elapsedMsTotal = tasks.reduce((sum, task) => sum + Number(task.runtimeOutcome?.metrics?.durationMs ?? 0), 0);
    const timeoutCount = tasks.filter((task) => runtimeStatusForTask(task) === "timeout").length;
    const usage = tasks.map((task) => ({
        task: task.task,
        available: Boolean(task.runtimeOutcome?.usage?.available),
        reason: task.runtimeOutcome?.usage?.reason ?? (task.runtimeOutcome?.usage?.available ? null : "usage-unavailable"),
        nativeResult: task.runtimeOutcome?.usage?.nativeResult ?? null,
        providerModelMetrics: task.runtimeOutcome?.usage?.providerModelMetrics ?? null,
        agentModelMetrics: task.runtimeOutcome?.usage?.agentModelMetrics ?? null,
    }));
    return {
        arm: armResult.arm,
        taskCount: tasks.length,
        completed,
        infraFailures,
        codingFailures,
        timeoutCount,
        elapsedMsTotal,
        failedRuntimeCount: tasks.filter((task) => runtimeStatusForTask(task) === "failed").length,
        minimeFidelity,
        snapshots,
        usage,
    };
}

function infrastructureResult({ suite, code, message, missing, check }) {
    return {
        output: {
            suite: suite.suite.reportingKey,
            status: "infrastructure_error",
            armResults: [],
            runtimeInfra: {
                kind: "runtime_infra_error",
                code,
                message,
                blockerEvidence: {
                    missingPrerequisites: missing,
                    capabilityChecks: [check],
                    evidence: [message],
                },
            },
        },
        metadata: {
            summary: message,
            componentResults: [{ id: "code-correctness", pass: false, reason: message }],
        },
        error: message,
    };
}

async function resolveCandidateOrInfra({ suite, candidate }) {
    try {
        const selection = resolveCandidateSelection(candidate ?? {});
        if (selection) await loadVerifiedCandidate(selection);
        return { selection, result: null };
    } catch (error) {
        return {
            selection: null,
            result: infrastructureResult({
                suite,
                code: "candidate-invalid",
                message: `Explicit candidate rejected before model execution: ${String(error?.message ?? error)}`,
                missing: ["verified-approved-candidate"],
                check: { id: "candidate-verification", status: "failed", reason: "candidate_rejected" },
            }),
        };
    }
}

async function runTaskAttempt({
    suite,
    task,
    arm,
    suiteId,
    repeatIndex,
    runtimeRoot,
    previousMinimeLineage = null,
    armSpecs,
    runtimeProfile,
    abortSignal,
    runtimeReady,
    prompt = null,
    grade = true,
}) {
    const taskKey = `${task.id}@${task.version}`;
    const taskDefinition = suite.tasks[taskKey];
    const context = await createTaskRuntimeContext({
        runtimeRoot,
        suiteId,
        repeatIndex,
        taskId: task.id,
        arm,
        previousMinimeLineage,
    });
    await clonePinnedSource({ sourcePin: suite.sourcePin, destination: context.paths.sourceRoot });
    const hqBefore = arm === RUNTIME_ARMS.MINIME ? await observeHq(context.paths.hqRoot) : null;
    const launchPlan = buildDockerRunPlan({
        arm,
        context,
        armSpecs,
        prompt: prompt ?? toTaskPrompt(task, taskDefinition),
    });
    const images = runtimeReady?.images ?? {};
    const runtimeOutcome = await runManagedRuntimeCommand({
        command: launchPlan.command,
        args: launchPlan.args,
        cwd: process.cwd(),
        env: process.env,
        context,
        suiteId,
        arm,
        taskId: task.id,
        abortSignal,
        taskTimeoutMs: runtimeProfile.taskTimeoutSeconds * 1000,
        wrapperTimeoutMs: runtimeProfile.taskTimeoutSeconds * 1000 + 30_000,
        teardownGraceMs: 500,
        candidate: images.candidate ?? null,
        runtimeImage: arm === RUNTIME_ARMS.MINIME
            ? { image: armSpecs[arm].image, payloadHash: images.payloadHash ?? null, payloadCommit: images.payloadCommit ?? null }
            : { image: armSpecs[arm].image, defaultImageId: runtimeReady?.defaultImageId ?? null },
        launchReceiptPath: path.join(context.paths.receiptsRoot, "launch.json"),
        usageReceiptPath: path.join(context.paths.receiptsRoot, "usage.json"),
        teardownReceiptPath: path.join(context.paths.receiptsRoot, "teardown.json"),
    });
    let observation = null;
    let infraFailure = null;
    if (isRuntimeInfraError(runtimeOutcome)) {
        infraFailure = { kind: "runtime", detail: runtimeOutcome.message };
    } else if (grade) {
        try {
            const probeEvaluation = await runTaskProbeInContainer({
                taskDefinition: {
                    id: task.id,
                    version: task.version,
                    ...taskDefinition,
                },
                sourceRoot: context.paths.sourceRoot,
                sourcePinCommit: suite.sourcePin.commit,
                image: armSpecs[arm].image,
                abortSignal,
            });
            observation = probeEvaluation.runtimeObservation;
        } catch (error) {
            infraFailure = {
                kind: "verifier",
                detail: `Isolated probe execution failed: ${error.message}`,
            };
        }
    }
    const verification = grade
        ? verifyTaskAttempt({
            manifest: suite,
            taskId: task.id,
            taskVersion: task.version,
            observation,
            infraFailure,
        })
        : null;
    const { knowledge, inventories } = await observeKnowledge({ arm, context, hqBefore, runtimeOutcome });
    return { context, runtimeOutcome, verification, knowledge, inventories };
}

// Measures post-run HQ state against the pre-launch observation and persists the full inventories as a hash-linked receipt.
export async function observeKnowledge({ arm, context, hqBefore, runtimeOutcome }) {
    try {
        const hqAfter = arm === RUNTIME_ARMS.MINIME ? await observeHq(context.paths.hqRoot) : null;
        let records = [];
        let phaseAudit = null;
        let nativeTrace = { status: "observed" };
        if (arm === RUNTIME_ARMS.MINIME) {
            try {
                ({ records, trace: nativeTrace } = await observeNativeRecords(context.paths.runtimeRoot));
                phaseAudit = auditQualification({ jsonRecords: records });
            } catch (error) {
                nativeTrace = { status: "unavailable", error: String(error?.message ?? error).slice(0, 200) };
            }
        }
        const lineage = context.lineage
            ? { inputSnapshotId: context.lineage.inputSnapshotId ?? null, inputSnapshotRestored: Boolean(runtimeOutcome?.receipt?.lineage?.inputSnapshotRestored), restoredFileCount: context.snapshotRestore?.fileCount ?? 0, outputSnapshotId: runtimeOutcome?.receipt?.lineage?.outputSnapshotId ?? null }
            : null;
        const { fullDetail, ...summary } = summarizeKnowledge({ arm, before: hqBefore, after: hqAfter, records, phaseAudit, lineage, nativeTrace });
        if (arm !== RUNTIME_ARMS.MINIME) return { knowledge: summary, inventories: null };
        const receiptPath = path.join(context.paths.receiptsRoot, "knowledge-observation.json");
        const body = JSON.stringify({ summary, detail: fullDetail ?? null, inventories: { before: hqBefore?.files ?? null, after: hqAfter?.files ?? null } }, null, 2);
        try {
            await writeFile(receiptPath, body);
            summary.receipt = { path: receiptPath, sha256: createHash("sha256").update(body).digest("hex") };
        } catch (error) {
            summary.receipt = { path: null, sha256: null, error: String(error?.message ?? error).slice(0, 200) };
        }
        return { knowledge: summary, inventories: { before: hqBefore, after: hqAfter } };
    } catch (error) {
        return { knowledge: { arm, generation: { status: "unavailable", reason: "observer-failed" }, retrieval: { status: "unavailable", reason: "observer-failed" }, error: String(error?.message ?? error).slice(0, 200) }, inventories: null };
    }
}

const DIRECT_BLUEPRINT_PREFIX = [
    "Invoke ONLY the standalone blueprint skill (skill: blueprint) for the task below, then return its result.",
    "Do not implement code and do not invoke replicate, inspect or extract.",
    "",
].join("\n");

// Bounded single-task qualification: no paid compatibility prelude, exactly one model launch.
export async function runQualification({
    suite,
    taskKey,
    arm = RUNTIME_ARMS.MINIME,
    candidate,
    runtimeProfile,
    abortSignal,
    directPhase = null,
    runtimeReadiness = ensureLocalRuntimeReady,
    attempt = runTaskAttempt,
    env = process.env,
}) {
    if (arm !== RUNTIME_ARMS.MINIME) throw new Error("qualify supports only the MINIME arm.");
    if (directPhase !== null && directPhase !== "blueprint") throw new Error("--direct-phase supports only blueprint.");
    const task = suite.orderedTasks.find((item) => `${item.id}@${item.version}` === taskKey);
    if (!task) throw new Error(`Unknown task ${taskKey} for suite ${suite.suite.reportingKey}.`);
    if (!candidate?.candidateManifestPath) {
        return infrastructureResult({
            suite,
            code: "candidate-required",
            message: "Qualification requires --candidate-manifest and --approved-candidate-manifest-sha256.",
            missing: ["approved-candidate"],
            check: { id: "candidate-verification", status: "failed", reason: "candidate_absent" },
        });
    }
    const candidateCheck = await resolveCandidateOrInfra({ suite, candidate });
    if (candidateCheck.result) return candidateCheck.result;
    if (!(env.COPILOT_GITHUB_TOKEN || env.GH_TOKEN || env.GITHUB_TOKEN)) {
        return infrastructureResult({
            suite,
            code: "missing-auth",
            message: "Missing COPILOT_GITHUB_TOKEN for qualification.",
            missing: ["COPILOT_GITHUB_TOKEN"],
            check: { id: "auth-presence", status: "failed", reason: "token_absent" },
        });
    }
    const runtimeReady = await runtimeReadiness({
        projectRoot: path.resolve(process.cwd(), "..", ".."),
        cwd: process.cwd(),
        candidate: candidateCheck.selection,
    });
    if (isRuntimeInfraError(runtimeReady)) {
        return infrastructureResult({
            suite,
            code: runtimeReady.code,
            message: runtimeReady.message,
            missing: runtimeReady.blockerEvidence?.missingPrerequisites ?? [],
            check: { id: "runtime-readiness", status: "failed", reason: runtimeReady.code },
        });
    }
    const evaluationId = randomUUID();
    const suiteId = suiteIdFromManifest(suite);
    const runtimeRoot = path.join(process.cwd(), "artifacts", "runtime", evaluationId);
    await mkdir(runtimeRoot, { recursive: true });
    const armSpecs = buildRuntimeArmSpecs({
        images: runtimeReady.images,
        model: runtimeProfile.model,
        reasoningEffort: runtimeProfile.reasoningEffort,
        softCreditCapTarget: runtimeProfile.maxAiCredits,
        omitAgent: directPhase !== null,
    });
    const publicPrompt = toTaskPrompt(task, suite.tasks[taskKey]);
    const outcome = await attempt({
        suite,
        task,
        arm,
        suiteId,
        repeatIndex: 0,
        runtimeRoot,
        armSpecs,
        runtimeProfile,
        abortSignal,
        runtimeReady,
        prompt: directPhase ? `${DIRECT_BLUEPRINT_PREFIX}${publicPrompt}` : publicPrompt,
        grade: directPhase === null,
    });
    const runtimeRootForTask = outcome.context?.paths?.runtimeRoot ?? runtimeRoot;
    const hqRoot = outcome.context?.paths?.hqRoot ?? null;
    const records = await readNativeRecords(runtimeRootForTask);
    const phaseAudit = directPhase ? auditDirectBlueprint({ jsonRecords: records }) : auditQualification({ jsonRecords: records });
    const knowledge = outcome.knowledge ?? null;
    const before = outcome.inventories?.before;
    const after = outcome.inventories?.after;
    const preStateObserved = before?.status === "observed" && after?.status === "observed";
    // Without both measured inventories there is no baseline: learning stays not-observed, never classified from an invented empty one.
    const learning = directPhase
        ? null
        : preStateObserved
            ? { ...classifyLearning({ hqBefore: before.files, hqAfter: after.files, auditResult: phaseAudit }), preStateObserved }
            : { status: "not-observed", ok: false, demonstrated: false, reason: "hq-inventory-unavailable", preStateObserved: false };
    const infra = isRuntimeInfraError(outcome.runtimeOutcome) ? outcome.runtimeOutcome : null;
    return {
        output: {
            suite: suite.suite.reportingKey,
            status: infra ? "infrastructure_error" : "qualification_observed",
            mode: directPhase ? "direct-blueprint-control" : "qualification",
            task: taskKey,
            arm,
            candidate: runtimeReady.images?.candidate ?? null,
            defaultImageId: runtimeReady.defaultImageId ?? null,
            verification: outcome.verification ?? null,
            phaseAudit,
            learning,
            knowledge,
            runtimeRoot: runtimeRootForTask,
            modelLaunches: 1,
        },
        metadata: { summary: "Qualification observed; audit is observational.", note: "Audit fixtures are not model compliance proof." },
        error: infra ? infra.message : undefined,
    };
}

export async function runEpisode({
    suite,
    context = {},
    runtimeProfile,
    abortSignal,
    compatibilityProbe = defaultCompatibilityProbe,
    runtimeReadiness = ensureLocalRuntimeReady,
    candidate = null,
}) {
    if (abortSignal?.aborted) {
        return {
            output: {
                suite: suite.suite.reportingKey,
                status: "infrastructure_error",
                armResults: [],
                runtimeInfra: {
                    kind: "runtime_infra_error",
                    code: "episode-aborted-before-runtime",
                    message: "Episode aborted before runtime preparation.",
                    blockerEvidence: { missingPrerequisites: [], capabilityChecks: [], evidence: [] },
                },
            },
            metadata: {
                summary: "Episode aborted before runtime preparation.",
                componentResults: [{ id: "code-correctness", pass: false, reason: "Episode aborted before runtime preparation." }],
            },
            error: "Episode aborted before runtime preparation.",
        };
    }
    const candidateCheck = await resolveCandidateOrInfra({ suite, candidate });
    if (candidateCheck.result) return candidateCheck.result;
    const candidateSelection = candidateCheck.selection;
    try {
        await assertCalibrationReceiptCurrent({ suite });
    } catch (error) {
        return {
            output: {
                suite: suite.suite.reportingKey,
                status: "infrastructure_error",
                armResults: [],
                runtimeInfra: {
                    kind: "runtime_infra_error",
                    code: "calibration-receipt-invalid",
                    message: String(error?.message ?? error),
                    blockerEvidence: {
                        missingPrerequisites: ["content-bound-calibration"],
                        capabilityChecks: [{ id: "calibration-receipt", status: "failed", reason: "missing_or_stale" }],
                        evidence: [String(error?.message ?? error)],
                    },
                },
            },
            metadata: {
                summary: String(error?.message ?? error),
                componentResults: [{ id: "code-correctness", pass: false, reason: String(error?.message ?? error) }],
            },
            error: String(error?.message ?? error),
        };
    }
    const evaluationId = randomUUID();
    const suiteId = suiteIdFromManifest(suite);
    const runtimeRoot = path.join(process.cwd(), "artifacts", "runtime", evaluationId);
    await mkdir(runtimeRoot, { recursive: true });
    const runtimeReady = await runtimeReadiness({
        projectRoot: path.resolve(process.cwd(), "..", ".."),
        cwd: process.cwd(),
        candidate: candidateSelection,
    });
    if (isRuntimeInfraError(runtimeReady)) {
        return {
            output: {
                suite: suite.suite.reportingKey,
                status: "infrastructure_error",
                armResults: [],
                runtimeInfra: {
                    kind: runtimeReady.kind,
                    code: runtimeReady.code,
                    message: runtimeReady.message,
                    blockerEvidence: runtimeReady.blockerEvidence,
                },
            },
            metadata: {
                summary: runtimeReady.message,
                componentResults: [{
                    id: "code-correctness",
                    pass: false,
                    reason: runtimeReady.message,
                    blockerEvidence: runtimeReady.blockerEvidence,
                }],
                runtimeInfra: runtimeReady,
            },
            error: runtimeReady.message,
        };
    }

    const token = process.env.COPILOT_GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";
    const armSpecs = buildRuntimeArmSpecs({
        images: runtimeReady.images,
        model: runtimeProfile.model,
        reasoningEffort: runtimeProfile.reasoningEffort,
        softCreditCapTarget: runtimeProfile.maxAiCredits,
    });
    const compatibilityKey = compatibilityCacheKey({ suite, runtimeProfile, candidate: candidateSelection });
    let compatibility = compatibilityCache.get(compatibilityKey);
    const reusedCompatibility = Boolean(compatibility) && !isRuntimeInfraError(compatibility);
    if (!compatibility || isRuntimeInfraError(compatibility)) {
        compatibility = await runMinimeCompatibilityProbe({
            token,
            capabilityProbe: () => compatibilityProbe({
                runtimeRoot,
                suite,
                runtimeProfile,
                armSpecs,
                abortSignal,
            }),
            probeId: "minime-native-launch",
        });
        compatibilityCache.set(compatibilityKey, compatibility);
    }
    if (isRuntimeInfraError(compatibility)) {
        return {
            output: {
                suite: suite.suite.reportingKey,
                status: "infrastructure_error",
                armResults: [],
                runtimeInfra: {
                    kind: compatibility.kind,
                    code: compatibility.code,
                    message: compatibility.message,
                    blockerEvidence: compatibility.blockerEvidence,
                },
            },
            metadata: {
                summary: compatibility.message,
                componentResults: [{
                    id: "code-correctness",
                    pass: false,
                    reason: compatibility.message,
                    blockerEvidence: compatibility.blockerEvidence,
                }],
                runtimeInfra: compatibility,
                runtimeImageBuild: runtimeReady.buildEvidence,
                runtimeImageReadiness: runtimeReady.readinessEvidence,
            },
            error: compatibility.message,
        };
    }

    const armResults = [];
    const componentResults = [];
    const repeatIndex = resolveRepeatIndex({ suiteKey: suite.suite.reportingKey, context });
    const armOrder = armOrderForRepeat(repeatIndex);
    let aborted = false;
    for (const arm of armOrder) {
        const taskResults = [];
        let previousMinimeLineage = null;
        for (const task of suite.orderedTasks) {
            if (abortSignal?.aborted) {
                aborted = true;
                break;
            }
            const taskKey = `${task.id}@${task.version}`;
            const { runtimeOutcome, verification, knowledge } = await runTaskAttempt({
                suite,
                task,
                arm,
                suiteId,
                repeatIndex,
                runtimeRoot,
                previousMinimeLineage,
                armSpecs,
                runtimeProfile,
                abortSignal,
                runtimeReady,
            });
            taskResults.push({ task: taskKey, runtimeOutcome, verification, knowledge });
            componentResults.push(toComponent(`${arm}:${taskKey}`, verification, runtimeOutcome));
            if (
                arm === RUNTIME_ARMS.MINIME
                && runtimeOutcome.status === "completed"
                && runtimeOutcome.receipt?.lineage?.outputSnapshotId
            ) {
                previousMinimeLineage = runtimeOutcome.receipt.lineage;
            }
        }
        armResults.push({ arm, tasks: taskResults });
        if (aborted) break;
    }

    const codePass = componentResults.every((item) => item.pass);
    const status = overallStatus(armResults, {
        expectedTaskCount: suite.orderedTasks.length * 2,
        aborted,
    });
    componentResults.unshift({
        id: "code-correctness",
        pass: status === "completed",
        reason: status === "completed"
            ? "All task verifier checks passed."
            : status === "infrastructure_error"
                ? "One or more task attempts failed due to infrastructure or verifier execution errors."
                : "One or more verifier checks failed.",
    });

    const armMetrics = armResults.map((armResult) => summarizeArm(armResult));
    const defaultMetrics = armMetrics.find((entry) => entry.arm === RUNTIME_ARMS.DEFAULT);
    const minimeMetrics = armMetrics.find((entry) => entry.arm === RUNTIME_ARMS.MINIME);
    const pairedDeltas = (defaultMetrics && minimeMetrics)
        ? {
            elapsedMs: minimeMetrics.elapsedMsTotal - defaultMetrics.elapsedMsTotal,
            completed: minimeMetrics.completed - defaultMetrics.completed,
            codingFailures: minimeMetrics.codingFailures - defaultMetrics.codingFailures,
            infraFailures: minimeMetrics.infraFailures - defaultMetrics.infraFailures,
            timeouts: minimeMetrics.timeoutCount - defaultMetrics.timeoutCount,
        }
        : null;
    const taskDefinitionHashes = Object.fromEntries(
        Object.entries(suite.tasks ?? {}).map(([taskKey, taskDef]) => [taskKey, taskDef.definitionHash ?? null]),
    );
    const reportIdentity = {
        suite: suite.suite.reportingKey,
        role: suite.suite.role,
        sourcePin: suite.sourcePin,
        manifestDigest: validateScenarioManifest(suite).manifestDigest,
        taskDefinitionHashes,
    };

    return {
        output: {
            suite: suite.suite.reportingKey,
            repeatIndex,
            armOrder,
            status,
            effectiveProfile: {
                model: runtimeProfile.model,
                reasoningEffort: runtimeProfile.reasoningEffort,
                maxAiCredits: runtimeProfile.maxAiCredits,
                taskTimeoutSeconds: runtimeProfile.taskTimeoutSeconds,
            },
            armResults,
            armMetrics,
            pairedDeltas,
            compatibility: {
                probeId: compatibility.probeId,
                reusedFromCache: reusedCompatibility,
                accountingScope: compatibility.accountingScope ?? null,
                evidence: compatibility.evidence ?? [],
            },
            reportIdentity,
            candidate: runtimeReady.images?.candidate ?? null,
            runtimeInfra: null,
        },
        metadata: {
            summary: `${suite.suite.reportingKey} ${status} (${runtimeProfile.model}, ${runtimeProfile.reasoningEffort})`,
            componentResults,
            compatibilityProbe: compatibility,
            runtimeImageBuild: runtimeReady.buildEvidence,
            runtimeImageReadiness: runtimeReady.readinessEvidence,
        },
        error: status === "infrastructure_error"
            ? "Infrastructure error during runtime or verifier execution."
            : undefined,
    };
}
