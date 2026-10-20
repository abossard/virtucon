import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
    collectCalibrationEvidenceForSuite,
    evaluateCalibrationMatrix,
    loadScenarioManifest,
    validateScenarioManifest,
    validateSuite,
    verifySourcePinAuthority,
    verifyTaskAttempt,
} from "./verify.mjs";
import { ensureLocalRuntimeReady, materializePayloadFromCommit } from "./runtime/launch.mjs";
import { prepareCandidate, resolveCandidateSelection } from "./runtime/candidate.mjs";
import { runQualification } from "./episode.mjs";
import { knowledgeFields } from "./runtime/qualification.mjs";

import { runTaskProbeInContainer } from "./probe.mjs";
import { buildRuntimeArmSpecs } from "./runtime/launch.mjs";
import { RUNTIME_ARMS, RUNTIME_SOFT_CREDIT_CAP_TARGET } from "./runtime/contracts.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_PROFILE = Object.freeze({
    model: "gpt-5.3-codex",
    reasoningEffort: "high",
    maxAiCredits: null,
    smokeTaskTimeoutSeconds: 900,
    hardTaskTimeoutSeconds: 2700,
});

function parseArg(flag, fallback = null) {
    const idx = process.argv.lastIndexOf(flag);
    if (idx === -1 || idx + 1 >= process.argv.length) {
        return fallback;
    }
    return process.argv[idx + 1];
}

function candidateFromArgs() {
    return resolveCandidateSelection({
        candidateManifestPath: parseArg("--candidate-manifest", process.env.PROMPTFOO_CANDIDATE_MANIFEST ?? null),
        approvedCandidateManifestSha256: parseArg(
            "--approved-candidate-manifest-sha256",
            process.env.PROMPTFOO_APPROVED_CANDIDATE_MANIFEST_SHA256 ?? null,
        ),
    });
}

function parseRepeat(defaultRepeat) {
    const value = parseArg("--repeat", String(defaultRepeat));
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`Invalid --repeat value: ${value}`);
    }
    return parsed;
}

function getSuiteFromArgs(fallbackSuite) {
    return parseArg("--suite", fallbackSuite);
}

async function discoverScenarioFiles() {
    const scenariosRoot = path.join(__dirname, "scenarios");
    const entries = await readdir(scenariosRoot, { withFileTypes: true });
    const suiteToFile = new Map();
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const suiteId = entry.name.replace(/\.json$/, "");
        suiteToFile.set(suiteId, entry.name);
    }
    return suiteToFile;
}

async function suiteFilePath(suiteId) {
    const suiteToFile = await discoverScenarioFiles();
    const file = suiteToFile.get(suiteId);
    if (!file) throw new Error(`Unknown suite: ${suiteId}`);
    return path.join(__dirname, "scenarios", file);
}

export async function loadSuiteManifest(suiteId) {
    const manifestPath = await suiteFilePath(suiteId);
    const { manifest, validation } = await loadScenarioManifest(manifestPath);
    if (!validation.ok) {
        const formatted = validation.issues.map((issue) => `${issue.code}: ${issue.message}`).join("\n");
        throw new Error(`Manifest validation failed for ${suiteId}\n${formatted}`);
    }
    return manifest;
}

export function resolveRuntimeProfile({ suite, model, reasoningEffort, maxAiCredits }) {
    const role = suite.suite.role;
    const isSmoke = role === "smoke";
    const resolvedCredits = maxAiCredits === undefined || maxAiCredits === null || String(maxAiCredits).trim() === ""
        ? null
        : Number(maxAiCredits);
    if (resolvedCredits !== null && (!Number.isFinite(resolvedCredits) || resolvedCredits <= 0)) {
        throw new Error(`Invalid maxAiCredits value: ${maxAiCredits}`);
    }
    return {
        model: model || DEFAULT_PROFILE.model,
        reasoningEffort: reasoningEffort || DEFAULT_PROFILE.reasoningEffort,
        maxAiCredits: resolvedCredits,
        taskTimeoutSeconds: isSmoke
            ? DEFAULT_PROFILE.smokeTaskTimeoutSeconds
            : DEFAULT_PROFILE.hardTaskTimeoutSeconds,
        smokeTaskTimeoutSeconds: DEFAULT_PROFILE.smokeTaskTimeoutSeconds,
        hardTaskTimeoutSeconds: DEFAULT_PROFILE.hardTaskTimeoutSeconds,
    };
}

function getTimestampSlug() {
    return new Date().toISOString().replace(/[:.]/g, "-");
}

function sha256Text(text) {
    return createHash("sha256").update(String(text)).digest("hex");
}

function parseTaskRef(taskRef) {
    const match = String(taskRef ?? "").match(/^(.+)@(.+)$/);
    if (!match) return null;
    return { id: match[1], version: match[2] };
}

async function ensureRunDirectory(suiteKey) {
    const root = path.join(__dirname, "artifacts", "evaluation", suiteKey, getTimestampSlug());
    await mkdir(root, { recursive: true });
    return root;
}

export async function writeRunManifest({ suite, runDir, repeat, runtimeProfile, candidate = null }) {
    const definitionDigests = Object.fromEntries(
        Object.entries(suite.tasks ?? {}).map(([taskKey, taskDef]) => [taskKey, taskDef.definitionHash ?? null]),
    );
    const publicPromptHashes = Object.fromEntries(
        Object.entries(suite.tasks ?? {}).map(([taskKey, taskDef]) => {
            const prompt = String(taskDef.definition?.prompt ?? "");
            return [taskKey, prompt ? `sha256:${createHash("sha256").update(prompt).digest("hex")}` : null];
        }),
    );
    const oracleHashes = Object.fromEntries(
        Object.entries(suite.tasks ?? {}).map(([taskKey, taskDef]) => {
            const checks = [
                ...(taskDef.definition?.api?.oracleChecks ?? []),
                ...(taskDef.definition?.cli?.oracleChecks ?? []),
            ].map((check) => ({ name: check.name, script: check.script, sha256: check.sha256 }));
            return [taskKey, checks];
        }),
    );
    const summary = {
        suite: suite.suite,
        sourcePin: suite.sourcePin,
        orderedTasks: suite.orderedTasks,
        taskDefinitions: suite.tasks,
        taskDefinitionHashes: definitionDigests,
        publicPromptHashes,
        oracleChecks: oracleHashes,
        repeat,
        runtimeProfile,
        ...(candidate
            ? {
                  candidate: {
                      ...candidate,
                      approvedCandidateManifestSha256: candidate.manifestSha256,
                      approvedPayloadSha256: candidate.payloadSha256,
                  },
              }
            : {}),
    };
    await writeFile(path.join(runDir, "run-manifest.json"), JSON.stringify(summary, null, 2));
}

function calibrationIdentity({ suite, manifestValidation, contracts, sourceAuthority }) {
    const taskDefinitionHashes = Object.fromEntries(
        Object.entries(suite.tasks ?? {}).map(([taskKey, taskDef]) => [taskKey, taskDef.definitionHash ?? null]),
    );
    return {
        suite: suite.suite.reportingKey,
        manifestDigest: manifestValidation.manifestDigest,
        sourcePin: suite.sourcePin,
        taskDefinitionHashes,
        sourceAuthority: sourceAuthority.observed,
        contractIssues: contracts.issues ?? [],
    };
}

async function ensureCalibrationReceipt({ suite, runtimeReady, suiteId }) {
    const contracts = await validateSuite({ manifest: suite });
    const manifestValidation = validateScenarioManifest(suite);
    const sourceAuthority = await verifySourcePinAuthority(suite.sourcePin);
    if (!sourceAuthority.ok) {
        throw new Error(`Live source authority mismatch for ${suite.suite.reportingKey}`);
    }
    const identity = calibrationIdentity({
        suite,
        manifestValidation,
        contracts: contracts.contracts,
        sourceAuthority,
    });
    const calibrationRoot = path.join(__dirname, "artifacts", "calibration", suiteId);
    const latestReceipt = path.join(calibrationRoot, "latest-receipt.json");
    let receipt = null;
    try {
        receipt = JSON.parse(await readFile(latestReceipt, "utf8"));
    } catch {}
    const sameIdentity = receipt && JSON.stringify(receipt.identity) === JSON.stringify(identity) && receipt.ok === true;
    if (!sameIdentity) {
        const calibration = await collectCalibrationEvidenceForSuite({
            manifest: suite,
            suiteRoot: __dirname,
            containerImage: runtimeReady.images.probe,
        });
        const matrix = evaluateCalibrationMatrix({ manifest: suite, calibrationByTask: calibration.calibrationByTask });
        const calibrationDir = path.join(calibrationRoot, getTimestampSlug());
        await mkdir(calibrationDir, { recursive: true });
        await writeFile(path.join(calibrationDir, "evidence.json"), JSON.stringify(calibration.evidence, null, 2));
        await writeFile(path.join(calibrationDir, "matrix.json"), JSON.stringify(matrix, null, 2));
        const receiptPath = path.join(calibrationDir, "receipt.json");
        receipt = {
            ok: matrix.ok,
            generatedAt: new Date().toISOString(),
            identity,
            matrixPath: path.join(calibrationDir, "matrix.json"),
            evidencePath: path.join(calibrationDir, "evidence.json"),
            receiptPath,
            sourceAuthority: calibration.sourceAuthority,
        };
        await writeFile(receiptPath, JSON.stringify(receipt, null, 2));
        await writeFile(latestReceipt, JSON.stringify(receipt, null, 2));
        if (!matrix.ok) {
            const failures = matrix.failures.map((failure) => `${failure.code}: ${failure.message}`).join("\n");
            throw new Error(`Calibration matrix failed for ${suiteId}\n${failures}`);
        }
    }
    if (!receipt.receiptPath) receipt.receiptPath = latestReceipt;
    return receipt;
}

async function runCommand({ command, args, env }) {
    return await new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd: __dirname, env, stdio: "inherit" });
        const forward = (signal) => {
            if (!child.killed) child.kill(signal);
        };
        process.once("SIGINT", forward);
        process.once("SIGTERM", forward);
        child.on("error", reject);
        child.on("close", (code) => {
            process.removeListener("SIGINT", forward);
            process.removeListener("SIGTERM", forward);
            if (code === 0 || code === 100) {
                resolve(code);
                return;
            }
            reject(new Error(`${path.basename(command)} failed with exit code ${code}`));
        });
    });
}

async function runPromptfoo({ suite, repeat, runDir, runtimeProfile, calibrationReceiptPath, candidate = null }) {
    const bin = path.join(__dirname, "node_modules", ".bin", "promptfoo");
    const resultJson = path.join(runDir, "results.json");
    const env = {
        ...process.env,
        PROMPTFOO_DISABLE_TELEMETRY: "1",
        PROMPTFOO_DISABLE_UPDATE: "1",
        PROMPTFOO_SUITE: suite.suite.reportingKey,
        PROMPTFOO_MODEL: runtimeProfile.model,
        PROMPTFOO_REASONING: runtimeProfile.reasoningEffort,
    };
    if (runtimeProfile.maxAiCredits !== null) env.PROMPTFOO_MAX_AI_CREDITS = String(runtimeProfile.maxAiCredits);
    else delete env.PROMPTFOO_MAX_AI_CREDITS;
    if (calibrationReceiptPath) env.PROMPTFOO_CALIBRATION_RECEIPT = calibrationReceiptPath;
    delete env.PROMPTFOO_CANDIDATE_MANIFEST;
    delete env.PROMPTFOO_APPROVED_CANDIDATE_MANIFEST_SHA256;
    if (candidate) {
        env.PROMPTFOO_CANDIDATE_MANIFEST = candidate.candidateManifestPath;
        env.PROMPTFOO_APPROVED_CANDIDATE_MANIFEST_SHA256 = candidate.approvedCandidateManifestSha256;
    }
    const args = [
        "eval",
        "-c",
        "promptfooconfig.yaml",
        "--no-cache",
        "--max-concurrency",
        "1",
        "--repeat",
        String(repeat),
        "--no-share",
        "-o",
        resultJson,
    ];
    const exitCode = await runCommand({ command: bin, args, env });
    return { resultJson, exitCode };
}

function runtimeStatusForTask(task) {
    if (task?.runtimeOutcome?.kind === "runtime_infra_error") return "infra_error";
    return task?.runtimeOutcome?.status ?? "unknown";
}

function toComponent(taskKey, verification, runtimeOutcome) {
    const runtimeStatus = runtimeStatusForTask({ runtimeOutcome });
    const runtimeCompleted = runtimeStatus === "completed";
    const verifierPass = verification?.classification?.classification === "pass";
    const pass = runtimeCompleted && verifierPass;
    return {
        id: taskKey,
        pass,
        reason: pass
            ? "Runtime completed and verifier contract passed."
            : !runtimeCompleted
                ? `runtime:${runtimeStatus}`
                : `${verification?.classification?.classification ?? "unknown"}:${verification?.classification?.kind ?? "unknown"}`,
        score: pass ? 1 : 0,
    };
}

function overallStatus(armResults, { expectedTaskCount }) {
    const allTasks = armResults.flatMap((armResult) => armResult.tasks ?? []);
    if (allTasks.length < expectedTaskCount) return "infrastructure_error";
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

function evaluateOutputFromComponents({ output, componentResults }) {
    const primary = componentResults.find((item) => item.id === "code-correctness");
    const pass = primary?.pass === true;
    return {
        pass,
        score: pass ? 1 : 0,
        reason: primary?.reason ?? `${output.suite} ${output.status}`,
        namedScores: {},
        tokensUsed: {
            total: 0,
            prompt: 0,
            completion: 0,
            cached: 0,
            numRequests: 0,
        },
        componentResults: [{
            pass,
            score: pass ? 1 : 0,
            reason: primary?.reason ?? `${output.suite} ${output.status}`,
            componentResults,
            assertion: { type: "javascript", value: "file://./assertion.mjs" },
        },
            ...componentResults.map((component) => ({
                id: component.id,
                pass: component.pass,
                reason: component.reason,
                score: component.pass ? 1 : 0,
                assertion: { type: "javascript", value: "file://./assertion.mjs" },
            })),
        ],
    };
}

function recomputeStats(rows, previousStats) {
    const successes = rows.filter((row) => row.success === true).length;
    const failures = rows.filter((row) => row.success !== true).length;
    return {
        ...(previousStats ?? {}),
        successes,
        failures,
        errors: 0,
    };
}

function determineResultsExitCode(resultsJson) {
    const promptfooResults = Array.isArray(resultsJson?.results?.results)
        ? resultsJson
        : (Array.isArray(resultsJson?.results?.results?.results) ? resultsJson.results : resultsJson);
    const rows = promptfooResults?.results?.results ?? [];
    const statuses = rows.map((row) => row?.response?.output?.status ?? null);
    if (statuses.some((status) => status === "infrastructure_error")) return 1;
    if (rows.some((row) => row?.success !== true)) return 100;
    return 0;
}

async function commandRegradeResults() {
    const resultJsonPath = parseArg("--results-json", null);
    if (!resultJsonPath) {
        throw new Error("regrade-results requires --results-json <path>");
    }
    const runDir = parseArg("--out-dir", path.dirname(resultJsonPath));
    const outName = parseArg("--out-name", "results.regraded.linked.json");
    const outputPath = path.join(runDir, outName);
    const raw = await readFile(resultJsonPath, "utf8");
    const original = JSON.parse(raw);
    const sourceResultsSha256 = sha256Text(raw);
    const suiteKey = original?.results?.results?.[0]?.response?.output?.suite;
    if (!suiteKey) {
        throw new Error("Cannot infer suite from results JSON.");
    }
    const suite = await loadSuiteManifest(suiteKey);
    const runtimeReady = await ensureLocalRuntimeReady({
        projectRoot: path.resolve(__dirname, "..", ".."),
        cwd: __dirname,
        candidate: candidateFromArgs(),
        forceRebuild: false,
    });
    if (runtimeReady?.kind === "runtime_infra_error") {
        throw new Error(`runtime regrade failed: ${runtimeReady.message}`);
    }
    const firstProfile = original?.results?.results?.[0]?.response?.output?.effectiveProfile ?? {};
    const armSpecs = buildRuntimeArmSpecs({
        images: runtimeReady.images,
        model: firstProfile.model || DEFAULT_PROFILE.model,
        reasoningEffort: firstProfile.reasoningEffort || DEFAULT_PROFILE.reasoningEffort,
        softCreditCapTarget: RUNTIME_SOFT_CREDIT_CAP_TARGET,
    });
    const verifierSourceHashes = {
        verifyMjsSha256: sha256Text(await readFile(path.join(__dirname, "verify.mjs"), "utf8")),
        probeMjsSha256: sha256Text(await readFile(path.join(__dirname, "probe.mjs"), "utf8")),
    };
    const regradeReceipts = [];
    const regraded = structuredClone(original);
    for (const row of (regraded?.results?.results ?? [])) {
        const output = row?.response?.output;
        if (!output || !Array.isArray(output.armResults)) continue;
        const armResults = [];
        const componentResults = [];
        for (const armResult of output.armResults) {
            const arm = armResult.arm;
            const tasks = [];
            for (const task of (armResult.tasks ?? [])) {
                const parsedTask = parseTaskRef(task.task);
                if (!parsedTask) {
                    tasks.push(task);
                    continue;
                }
                const taskKey = `${parsedTask.id}@${parsedTask.version}`;
                const taskDefinition = suite.tasks?.[taskKey];
                let observation = null;
                let infraFailure = null;
                const sourceRoot = task?.runtimeOutcome?.receipt?.paths?.sourceRoot ?? null;
                if (!taskDefinition || !sourceRoot) {
                    infraFailure = {
                        kind: "verifier",
                        detail: `Cannot regrade: missing ${!taskDefinition ? "task definition" : "source root"}`,
                    };
                } else {
                    try {
                        const probeEvaluation = await runTaskProbeInContainer({
                            taskDefinition: {
                                id: parsedTask.id,
                                version: parsedTask.version,
                                ...taskDefinition,
                            },
                            sourceRoot,
                            sourcePinCommit: suite.sourcePin.commit,
                            image: armSpecs[arm]?.image ?? armSpecs[RUNTIME_ARMS.DEFAULT].image,
                        });
                        observation = probeEvaluation.runtimeObservation;
                    } catch (error) {
                        infraFailure = {
                            kind: "verifier",
                            detail: `Isolated probe execution failed: ${error.message}`,
                        };
                    }
                }
                const verification = verifyTaskAttempt({
                    manifest: suite,
                    taskId: parsedTask.id,
                    taskVersion: parsedTask.version,
                    observation,
                    infraFailure,
                });
                const updatedTask = { ...task, verification };
                tasks.push(updatedTask);
                componentResults.push(toComponent(`${arm}:${taskKey}`, verification, task.runtimeOutcome));
                regradeReceipts.push({
                    suite: output.suite,
                    repeatIndex: output.repeatIndex,
                    arm,
                    task: taskKey,
                    regradedAt: new Date().toISOString(),
                    nativeIdentity: {
                        sessionId: task?.runtimeOutcome?.receipt?.sessionId ?? null,
                        suiteId: task?.runtimeOutcome?.receipt?.suiteId ?? null,
                        taskId: task?.runtimeOutcome?.receipt?.taskId ?? null,
                    },
                    sourceRoot,
                    sourcePinCommit: suite.sourcePin.commit,
                    candidateTreeHash: verification?.probeResult?.receipt?.candidateTreeHash ?? null,
                    verifierModuleHash: verification?.probeResult?.receipt?.verifierModuleHash ?? null,
                    verifierSourceHashes,
                    classification: verification?.classification ?? null,
                });
            }
            armResults.push({ ...armResult, tasks });
        }
        const status = overallStatus(armResults, {
            expectedTaskCount: (suite.orderedTasks?.length ?? 0) * 2,
        });
        componentResults.unshift({
            id: "code-correctness",
            pass: status === "completed",
            reason: status === "completed"
                ? "All task verifier checks passed."
                : status === "infrastructure_error"
                    ? "One or more task attempts failed due to infrastructure or verifier execution errors."
                    : "One or more verifier checks failed.",
            score: status === "completed" ? 1 : 0,
        });
        const armMetrics = armResults.map((entry) => summarizeArm(entry));
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
        output.armResults = armResults;
        output.armMetrics = armMetrics;
        output.pairedDeltas = pairedDeltas;
        output.status = status;
        const gradingResult = evaluateOutputFromComponents({ output, componentResults });
        row.gradingResult = gradingResult;
        row.success = gradingResult.pass;
        row.score = gradingResult.score;
        row.error = gradingResult.pass ? null : gradingResult.reason;
        row.failureReason = gradingResult.pass ? null : 1;
    }
    regraded.results.stats = recomputeStats(regraded.results.results, regraded.results.stats);
    const linked = {
        linkedAt: new Date().toISOString(),
        sourceResultsPath: resultJsonPath,
        sourceResultsSha256,
        sourceEvalId: original.evalId ?? null,
        suite: suite.suite.reportingKey,
        verifierSourceHashes,
        receiptsCount: regradeReceipts.length,
        results: regraded,
    };
    await writeFile(outputPath, JSON.stringify(linked, null, 2));
    const receiptsPath = path.join(runDir, "results.regraded.receipts.json");
    await writeFile(receiptsPath, JSON.stringify({
        generatedAt: new Date().toISOString(),
        sourceResultsPath: resultJsonPath,
        sourceResultsSha256,
        suite: suite.suite.reportingKey,
        verifierSourceHashes,
        receipts: regradeReceipts,
    }, null, 2));
    const outputs = await writeHarnessSummaryArtifacts({
        resultJsonPath: outputPath,
        runDir,
        basename: "results.regraded",
    });
    console.log(`Linked JSON: ${outputPath}`);
    console.log(`Receipts JSON: ${receiptsPath}`);
    console.log(`Summary JSON: ${outputs.summaryPath}`);
    console.log(`HTML: ${outputs.htmlPath}`);
}

function collectBoundedSummary(resultsJson) {
    const promptfooResults = Array.isArray(resultsJson?.results?.results)
        ? resultsJson
        : (Array.isArray(resultsJson?.results?.results?.results) ? resultsJson.results : resultsJson);
    const rows = promptfooResults?.results?.results ?? [];
    const byRepeat = rows.map((row) => {
        const output = row?.response?.output ?? {};
        return {
            promptId: row?.promptId ?? null,
            repeatIndex: output.repeatIndex ?? null,
            suite: output.suite ?? null,
            status: output.status ?? null,
            armOrder: output.armOrder ?? [],
            armMetrics: output.armMetrics ?? [],
        };
    });
    const statusCounts = byRepeat.reduce((counts, row) => {
        const key = row.status ?? "unknown";
        counts[key] = (counts[key] ?? 0) + 1;
        return counts;
    }, {});
    return {
        evalId: promptfooResults?.evalId ?? resultsJson?.sourceEvalId ?? null,
        suite: byRepeat[0]?.suite ?? null,
        rowCount: byRepeat.length,
        statusCounts,
        repeats: byRepeat,
    };
}

async function writeHarnessSummaryArtifacts({ resultJsonPath, runDir, basename = "results" }) {
    const raw = await readFile(resultJsonPath, "utf8");
    const parsed = JSON.parse(raw);
    const summary = collectBoundedSummary(parsed);
    const summaryPath = path.join(runDir, `${basename}.summary.json`);
    const htmlPath = path.join(runDir, `${basename}.html`);
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Promptfoo harness summary</title><style>body{font-family:ui-sans-serif,system-ui;padding:20px;max-width:1200px;margin:0 auto;background:#0b0f17;color:#e6edf3}pre{white-space:pre-wrap;background:#161b22;padding:12px;border-radius:8px;overflow:auto}code{background:#161b22;padding:2px 4px;border-radius:4px}</style></head><body><h1>Promptfoo harness summary</h1><p><strong>Eval:</strong> <code>${summary.evalId ?? "unknown"}</code></p><p><strong>Suite:</strong> <code>${summary.suite ?? "unknown"}</code></p><p><strong>Rows:</strong> ${summary.rowCount}</p><p><strong>Status counts:</strong> <code>${JSON.stringify(summary.statusCounts)}</code></p><h2>Repeat rows</h2><pre>${JSON.stringify(summary.repeats, null, 2)}</pre></body></html>`;
    await writeFile(summaryPath, JSON.stringify(summary, null, 2));
    await writeFile(htmlPath, html);
    return { summaryPath, htmlPath };
}

async function commandSetup() {
    await mkdir(path.join(__dirname, "artifacts"), { recursive: true });
    await mkdir(path.join(__dirname, "state"), { recursive: true });
    const runtimeReady = await ensureLocalRuntimeReady({
        projectRoot: path.resolve(__dirname, "..", ".."),
        cwd: __dirname,
        candidate: candidateFromArgs(),
        forceRebuild: true,
    });
    if (runtimeReady?.kind === "runtime_infra_error") {
        throw new Error(`runtime setup failed: ${runtimeReady.message}`);
    }
    console.log("setup complete");
}

async function commandPreflight() {
    const pluginPath = path.join(__dirname, "..", "..", ".claude-plugin", "plugin.json");
    const suites = await discoverScenarioFiles();
    for (const suiteId of suites.keys()) {
        await validateSuite({ manifestPath: await suiteFilePath(suiteId) });
    }
    await runCommand({
        command: "node",
        args: ["-e", `import('node:fs/promises').then(fs=>fs.access('${pluginPath.replace(/\\/g, "\\\\")}'))`],
        env: process.env,
    });
    const runtimeReady = await ensureLocalRuntimeReady({
        projectRoot: path.resolve(__dirname, "..", ".."),
        cwd: __dirname,
        candidate: candidateFromArgs(),
        forceRebuild: false,
    });
    if (runtimeReady?.kind === "runtime_infra_error") {
        throw new Error(`runtime preflight failed: ${runtimeReady.message}`);
    }
    console.log("preflight ok");
}

async function commandValidate() {
    const suiteId = getSuiteFromArgs(null);
    if (!suiteId) {
        throw new Error("validate requires --suite <id@version>");
    }
    const manifestPath = await suiteFilePath(suiteId);
    const { manifest } = await loadScenarioManifest(manifestPath);
    await validateSuite({ manifestPath, manifest });
    const runtimeReady = await ensureLocalRuntimeReady({
        projectRoot: path.resolve(__dirname, "..", ".."),
        cwd: __dirname,
        candidate: candidateFromArgs(),
        forceRebuild: false,
    });
    if (runtimeReady?.kind === "runtime_infra_error") {
        throw new Error(`runtime validate failed: ${runtimeReady.message}`);
    }
    await ensureCalibrationReceipt({ suite: manifest, runtimeReady, suiteId });
    const bin = path.join(__dirname, "node_modules", ".bin", "promptfoo");
    await runCommand({
        command: bin,
        args: ["validate", "config", "-c", "promptfooconfig.yaml"],
        env: {
            ...process.env,
            PROMPTFOO_SUITE: suiteId,
            ...(candidateFromArgs()
                ? {
                    PROMPTFOO_CANDIDATE_MANIFEST: candidateFromArgs().candidateManifestPath,
                    PROMPTFOO_APPROVED_CANDIDATE_MANIFEST_SHA256: candidateFromArgs().approvedCandidateManifestSha256,
                }
                : {}),
        },
    });
}

async function commandRun() {
    const suiteId = getSuiteFromArgs("ahm-managed-hard@2");
    const repeat = parseRepeat(1);
    const suite = await loadSuiteManifest(suiteId);
    const runtimeProfile = resolveRuntimeProfile({
        suite,
        model: parseArg("--model", process.env.PROMPTFOO_MODEL ?? null),
        reasoningEffort: parseArg("--reasoning-effort", process.env.PROMPTFOO_REASONING ?? null),
        maxAiCredits: parseArg("--max-ai-credits", process.env.PROMPTFOO_MAX_AI_CREDITS ?? null),
    });
    const runDir = await ensureRunDirectory(suite.suite.reportingKey);
    const runtimeReady = await ensureLocalRuntimeReady({
        projectRoot: path.resolve(__dirname, "..", ".."),
        cwd: __dirname,
        candidate: candidateFromArgs(),
        forceRebuild: false,
    });
    if (runtimeReady?.kind === "runtime_infra_error") {
        throw new Error(`runtime run failed: ${runtimeReady.message}`);
    }
    const calibrationReceipt = await ensureCalibrationReceipt({ suite, runtimeReady, suiteId });
    await writeRunManifest({ suite, runDir, repeat, runtimeProfile, candidate: runtimeReady.images?.candidate ?? null });
    const outputs = await runPromptfoo({
        suite,
        repeat,
        runDir,
        runtimeProfile,
        candidate: candidateFromArgs(),
        calibrationReceiptPath: calibrationReceipt.receiptPath ?? path.join(__dirname, "artifacts", "calibration", suiteId, "latest-receipt.json"),
    });
    const summaryOutputs = await writeHarnessSummaryArtifacts({
        resultJsonPath: outputs.resultJson,
        runDir,
    });
    console.log(`JSON: ${outputs.resultJson}`);
    console.log(`Summary JSON: ${summaryOutputs.summaryPath}`);
    console.log(`HTML: ${summaryOutputs.htmlPath}`);
    if (outputs.exitCode === 100) process.exitCode = 100;
}

async function commandPrepareCandidate() {
    const baselinePath = parseArg("--baseline", null);
    const paths = parseArg("--paths", null);
    if (!baselinePath || !paths) throw new Error("prepare-candidate requires --baseline <source-baseline.json> --paths <a,b>");
    const result = await prepareCandidate({
        projectRoot: path.resolve(__dirname, "..", ".."),
        baselinePath: path.resolve(baselinePath),
        paths: paths.split(",").map((item) => item.trim()).filter(Boolean),
        candidatesRoot: path.join(__dirname, "artifacts", "candidates"),
        materializeBase: materializePayloadFromCommit,
    });
    console.log(JSON.stringify(result, null, 2));
}

async function commandQualify() {
    const suiteId = getSuiteFromArgs(null);
    const taskKey = parseArg("--task", null);
    if (!suiteId || !taskKey) throw new Error("qualify requires --suite <id@version> --task <id@version>");
    const arm = parseArg("--arm", RUNTIME_ARMS.MINIME);
    const directPhase = parseArg("--direct-phase", null);
    const candidate = candidateFromArgs();
    const suite = await loadSuiteManifest(suiteId);
    const runtimeProfile = resolveRuntimeProfile({
        suite,
        model: parseArg("--model", process.env.PROMPTFOO_MODEL ?? null),
        reasoningEffort: parseArg("--reasoning-effort", process.env.PROMPTFOO_REASONING ?? null),
        maxAiCredits: parseArg("--max-ai-credits", process.env.PROMPTFOO_MAX_AI_CREDITS ?? null),
    });
    const result = await runQualification({ suite, taskKey, arm, candidate, runtimeProfile, directPhase });
    const runDir = await ensureRunDirectory(`${suite.suite.reportingKey}-qualify`);
    const outPath = path.join(runDir, directPhase ? "direct-blueprint.json" : "qualification.json");
    await writeFile(outPath, JSON.stringify(result, null, 2));
    console.log(`Qualification: ${outPath}`);
    if (result.error) process.exitCode = 1;
}

async function commandReplayExport() {
    const resultJsonPath = parseArg("--results-json", null);
    if (!resultJsonPath) {
        throw new Error("replay-export requires --results-json <path>");
    }
    const runDir = parseArg("--out-dir", path.dirname(resultJsonPath));
    const basename = parseArg("--basename", "results");
    const outputs = await writeHarnessSummaryArtifacts({
        resultJsonPath,
        runDir,
        basename,
    });
    console.log(`Summary JSON: ${outputs.summaryPath}`);
    console.log(`HTML: ${outputs.htmlPath}`);
    if (process.argv.includes("--apply-exit-semantics")) {
        const parsed = JSON.parse(await readFile(resultJsonPath, "utf8"));
        process.exitCode = determineResultsExitCode(parsed);
    }
}

async function main() {
    const command = process.argv[2];
    if (!command) {
        throw new Error("Usage: node cli.mjs <setup|preflight|validate|run|prepare-candidate|qualify|replay-export|regrade-results> [--suite <id@version>] [--repeat N]");
    }
    if (command === "setup") return commandSetup();
    if (command === "preflight") return commandPreflight();
    if (command === "validate") return commandValidate();
    if (command === "run") return commandRun();
    if (command === "prepare-candidate") return commandPrepareCandidate();
    if (command === "qualify") return commandQualify();
    if (command === "replay-export") return commandReplayExport();
    if (command === "regrade-results") return commandRegradeResults();
    throw new Error(`Unknown command: ${command}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}
