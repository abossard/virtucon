import crypto from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { runTaskProbe, runTaskProbeInContainer } from "./probe.mjs";

export const VERIFIER_CONTRACT_VERSION = "1.0.0";
export const SCENARIO_SCHEMA_VERSION = "1.0.0";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const sourceAuthorityCache = new Map();
const TRUSTED_FAILURE_CODES = new Set([
    "EXPECTATION_NOT_HOST_OWNED",
    "OBSERVED_EXPECTATION_NOT_HOST_OWNED",
    "ORACLE_CHECK_MISSING",
]);
const INFRA_FAILURE_KINDS = new Set(["auth", "runtime", "source", "verifier", "setup", "timeout"]);

function stableStringify(value) {
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(",")}]`;
    }
    if (value && typeof value === "object") {
        const keys = Object.keys(value).sort();
        return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
}

function sha256(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function taskKey(taskId, taskVersion) {
    return `${taskId}@${taskVersion}`;
}

function addIssue(issues, code, message, detail = {}) {
    issues.push({ code, message, detail });
}

function runCommand(command, args, { cwd, env = process.env } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd,
            env,
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout?.on("data", (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr?.on("data", (chunk) => {
            stderr += chunk.toString();
        });
        child.on("error", reject);
        child.on("close", (exitCode, signal) => {
            resolve({
                exitCode: typeof exitCode === "number" ? exitCode : 1,
                signal: signal ?? null,
                stdout,
                stderr,
            });
        });
    });
}

function normalizeManifestTasks(manifest) {
    return manifest.orderedTasks.map((entry) => {
        const key = taskKey(entry.id, entry.version);
        return {
            key,
            id: entry.id,
            version: entry.version,
            ...manifest.tasks[key]
        };
    });
}

export function computeTaskDefinitionHash(definition) {
    return `sha256:${sha256(stableStringify(definition))}`;
}

async function fetchGithubJson(url) {
    const response = await fetch(url, {
        headers: {
            "accept": "application/vnd.github+json",
            "user-agent": "minime-promptfoo-eval",
        },
    });
    if (!response.ok) {
        throw new Error(`GitHub API ${response.status} for ${url}`);
    }
    return response.json();
}

export async function verifySourcePinAuthority(sourcePin) {
    const key = stableStringify(sourcePin ?? {});
    if (sourceAuthorityCache.has(key)) return sourceAuthorityCache.get(key);
    const run = (async () => {
        const repository = String(sourcePin?.repository ?? "");
        const commit = String(sourcePin?.commit ?? "");
        const expectedLicenseBlob = String(sourcePin?.licenseBlob ?? "");
        const expectedLicensePath = String(sourcePin?.licensePath ?? "LICENSE");
        const expectedSpdx = String(sourcePin?.licenseSpdx ?? "");
        const expectedVisibility = String(sourcePin?.visibility ?? "");
        const [owner, repo] = repository.split("/");
        const repoInfo = await fetchGithubJson(`https://api.github.com/repos/${owner}/${repo}`);
        const commitInfo = await fetchGithubJson(`https://api.github.com/repos/${owner}/${repo}/git/commits/${commit}`);
        const licenseAtCommit = await fetchGithubJson(
            `https://api.github.com/repos/${owner}/${repo}/contents/${expectedLicensePath}?ref=${commit}`,
        );
        const actualVisibility = repoInfo.private ? "private" : "public";
        const actualSpdx = String(repoInfo.license?.spdx_id ?? "");
        const actualBlobSha = String(licenseAtCommit.sha ?? "");
        const actualCommit = String(commitInfo.sha ?? "");
        const matches = actualVisibility === expectedVisibility
            && actualSpdx === expectedSpdx
            && actualBlobSha === expectedLicenseBlob
            && actualCommit === commit;
        return {
            ok: matches,
            expected: {
                repository,
                commit,
                visibility: expectedVisibility,
                licenseSpdx: expectedSpdx,
                licenseBlob: expectedLicenseBlob,
                licensePath: expectedLicensePath,
            },
            observed: {
                repository,
                commit: actualCommit,
                visibility: actualVisibility,
                licenseSpdx: actualSpdx,
                licenseBlob: actualBlobSha,
                licensePath: expectedLicensePath,
            },
        };
    })();
    sourceAuthorityCache.set(key, run);
    return run;
}

export function computeManifestDigest(manifest) {
    return `sha256:${sha256(stableStringify(manifest))}`;
}

export function validateScenarioManifest(manifest) {
    const issues = [];
    if (manifest.schemaVersion !== SCENARIO_SCHEMA_VERSION) {
        addIssue(issues, "SCHEMA_VERSION_UNSUPPORTED", "Scenario schemaVersion is not supported.", {
            expected: SCENARIO_SCHEMA_VERSION,
            actual: manifest.schemaVersion
        });
    }

    const suiteId = manifest.suite?.id;
    const suiteVersion = manifest.suite?.version;
    const reportingKey = manifest.suite?.reportingKey;
    const computedReportingKey = `${suiteId}@${suiteVersion}`;
    if (reportingKey !== computedReportingKey) {
        addIssue(issues, "SUITE_REPORTING_KEY_MISMATCH", "Suite reporting key must match id@version.", {
            expected: computedReportingKey,
            actual: reportingKey
        });
    }

    const sourcePin = manifest.sourcePin ?? {};
    if (typeof sourcePin.repository !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(sourcePin.repository)) {
        addIssue(issues, "SOURCE_REPO_MISMATCH", "Source pin repository must be an owner/name string.");
    }
    if (typeof sourcePin.commit !== "string" || !/^[0-9a-f]{40}$/.test(sourcePin.commit)) {
        addIssue(issues, "SOURCE_COMMIT_MISMATCH", "Source pin commit must be an exact 40-hex SHA.");
    }
    if (sourcePin.licenseSpdx !== "MIT" || sourcePin.visibility !== "public") {
        addIssue(issues, "SOURCE_POLICY_MISMATCH", "Source pin policy metadata must remain MIT/public.");
    }
    if (typeof sourcePin.licenseBlob !== "string" || !/^[0-9a-f]{40}$/.test(sourcePin.licenseBlob)) {
        addIssue(issues, "SOURCE_LICENSE_BLOB_MISSING", "Source pin licenseBlob must be an exact 40-hex blob SHA.");
    }
    if (typeof sourcePin.licensePath !== "string" || !sourcePin.licensePath.trim()) {
        addIssue(issues, "SOURCE_LICENSE_PATH_MISSING", "Source pin licensePath must be a non-empty repository-relative path.");
    }

    if (!Array.isArray(manifest.orderedTasks) || manifest.orderedTasks.length === 0) {
        addIssue(issues, "ORDERED_TASKS_MISSING", "orderedTasks must contain at least one task.");
    }

    if (!manifest.tasks || typeof manifest.tasks !== "object") {
        addIssue(issues, "TASK_DEFINITIONS_MISSING", "tasks map is required.");
    } else {
        for (const ordered of manifest.orderedTasks ?? []) {
            const key = taskKey(ordered.id, ordered.version);
            const task = manifest.tasks[key];
            if (!task) {
                addIssue(issues, "TASK_DEFINITION_MISSING", `Missing task definition for ${key}.`);
                continue;
            }

            const expectedHash = computeTaskDefinitionHash(task.definition);
            if (task.definitionHash !== expectedHash) {
                addIssue(issues, "TASK_DEFINITION_HASH_MISMATCH", `Task ${key} definitionHash mismatch.`, {
                    expected: expectedHash,
                    actual: task.definitionHash
                });
            }

            if (!Array.isArray(task.pathAllowlist) || task.pathAllowlist.length === 0) {
                addIssue(issues, "TASK_ALLOWLIST_MISSING", `Task ${key} must include a path allowlist.`);
            }
            if (typeof task.referencePatch !== "string" || !task.referencePatch.startsWith(`reference/${computedReportingKey}/`)) {
                addIssue(issues, "REFERENCE_PATCH_PATH_INVALID", `Task ${key} reference patch path must stay in suite reference folder.`);
            }
            const isHard = manifest.suite?.role === "hard";
            if (task.wrongPatch !== undefined && (typeof task.wrongPatch !== "string" || !task.wrongPatch.startsWith(`reference/${computedReportingKey}/`))) {
                addIssue(issues, "WRONG_PATCH_PATH_INVALID", `Task ${key} wrong patch path must stay in suite reference folder.`);
            }
            if (isHard && task.wrongPatch === undefined) {
                addIssue(issues, "WRONG_PATCH_MISSING", `Hard task ${key} must declare a wrongPatch for task-red calibration.`);
            }
            const oracleChecks = [...(task.definition?.api?.oracleChecks ?? []), ...(task.definition?.cli?.oracleChecks ?? [])];
            if (isHard && oracleChecks.length === 0) {
                addIssue(issues, "ORACLE_CHECKS_MISSING", `Hard task ${key} must declare host-owned oracle checks.`);
            }
            for (const check of oracleChecks) {
                if (typeof check.script !== "string" || !check.script.startsWith(`scenarios/oracles/${computedReportingKey}/`)) {
                    addIssue(issues, "ORACLE_PATH_INVALID", `Task ${key} oracle '${check.name}' must live in the suite oracle folder.`);
                }
                if (!/^[0-9a-f]{64}$/.test(check.sha256 ?? "")) {
                    addIssue(issues, "ORACLE_HASH_MISSING", `Task ${key} oracle '${check.name}' must declare a sha256.`);
                }
            }
        }
    }

    return {
        ok: issues.length === 0,
        issues,
        suite: computedReportingKey,
        manifestDigest: computeManifestDigest(manifest)
    };
}

export async function loadScenarioManifest(manifestPath) {
    const raw = await readFile(manifestPath, "utf8");
    const manifest = JSON.parse(raw);
    const validation = validateScenarioManifest(manifest);
    return {
        manifest,
        validation
    };
}

export function classifyAttempt({ infraFailure, probeResult }) {
    if (infraFailure) {
        if (!INFRA_FAILURE_KINDS.has(infraFailure.kind)) {
            throw new Error(`Unsupported infra failure kind '${infraFailure.kind}'.`);
        }
        return {
            classification: "infrastructure_failure",
            kind: infraFailure.kind,
            detail: infraFailure.detail ?? null
        };
    }

    const trustedFailures = (probeResult.failures ?? []).filter((failure) => TRUSTED_FAILURE_CODES.has(failure.code));
    if (trustedFailures.length > 0) {
        return {
            classification: "infrastructure_failure",
            kind: "verifier",
            detail: { codes: trustedFailures.map((failure) => failure.code) }
        };
    }

    if (probeResult.pass) {
        return {
            classification: "pass",
            kind: null,
            detail: null
        };
    }

    return {
        classification: "coding_failure",
        kind: "contract_violation",
        detail: null
    };
}

// Errors thrown by the trusted probe bridge are verifier failures, never candidate failures.
export function classifyProbeError(error) {
    return {
        kind: "verifier",
        detail: { code: error?.code ?? "PROBE_ERROR", message: String(error?.message ?? error).slice(0, 500) }
    };
}

export function verifyTaskAttempt({ manifest, taskId, taskVersion, observation, infraFailure }) {
    const key = taskKey(taskId, taskVersion);
    const taskDefinition = manifest.tasks?.[key];
    if (!taskDefinition) {
        throw new Error(`Task definition '${key}' was not found in suite '${manifest.suite.reportingKey}'.`);
    }

    if (!infraFailure && (observation === null || typeof observation !== "object")) {
        infraFailure = { kind: "verifier", detail: { code: "OBSERVATION_MISSING" } };
    }

    let probeResult = null;
    if (!infraFailure) {
        probeResult = runTaskProbe({
            taskDefinition: {
                id: taskId,
                version: taskVersion,
                ...taskDefinition
            },
            observation,
            expectedOwner: "host"
        });
    }

    const classification = classifyAttempt({
        infraFailure,
        probeResult: probeResult ?? { pass: false }
    });

    return {
        suite: manifest.suite.reportingKey,
        task: key,
        classification,
        probeResult,
        receipt: {
            verifierContractVersion: VERIFIER_CONTRACT_VERSION,
            suite: manifest.suite.reportingKey,
            task: key,
            manifestDigest: computeManifestDigest(manifest)
        }
    };
}

export function validateCalibrationTriplet({ baselineGreen, taskRed, referenceGreen }) {
    const failures = [];
    if (!baselineGreen?.preservationPass) {
        addIssue(failures, "BASELINE_NOT_GREEN", "Baseline calibration must pass preservation.");
    }
    if (baselineGreen?.taskContractPass) {
        addIssue(failures, "BASELINE_TASK_NOT_RED", "Baseline calibration must remain red for task contract.");
    }
    if (taskRed?.taskContractPass) {
        addIssue(failures, "TASK_RED_NOT_RED", "Task-red calibration must fail task contract.");
    }
    if (!referenceGreen?.taskContractPass || !referenceGreen?.preservationPass) {
        addIssue(failures, "REFERENCE_NOT_GREEN", "Reference calibration must pass task and preservation.");
    }
    return {
        ok: failures.length === 0,
        failures
    };
}

export function evaluateCalibrationMatrix({ manifest, calibrationByTask }) {
    const failures = [];
    for (const ordered of manifest.orderedTasks) {
        const key = taskKey(ordered.id, ordered.version);
        const triplet = calibrationByTask[key];
        if (!triplet) {
            addIssue(failures, "CALIBRATION_TRIPLET_MISSING", `Missing C0-11 calibration triplet for ${key}.`);
            continue;
        }
        const tripletResult = validateCalibrationTriplet(triplet);
        if (manifest.suite?.role === "hard" && triplet.taskRed?.usedWrongPatch !== true) {
            tripletResult.ok = false;
            tripletResult.failures.push({
                code: "TASK_RED_NOT_DISTINCT",
                message: "Hard-role task-red calibration must run a distinct wrong patch, not the pristine baseline.",
                detail: {}
            });
        }
        if (!tripletResult.ok) {
            failures.push(...tripletResult.failures.map((failure) => ({
                ...failure,
                detail: { ...(failure.detail ?? {}), task: key }
            })));
        }
    }

    return {
        ok: failures.length === 0,
        failures
    };
}

function taskIdentities(manifest) {
    const tasks = normalizeManifestTasks(manifest);
    return tasks.map((task, index) => ({
        key: taskKey(task.id, task.version),
        definitionHash: task.definitionHash ?? null,
        sourceCommit: manifest.sourcePin?.commit ?? null,
        preceding: tasks.slice(0, index).map((earlier) => `${taskKey(earlier.id, earlier.version)}#${earlier.definitionHash ?? ""}`),
    }));
}

export function assessSuiteCompatibility({ leftManifest, rightManifest }) {
    const leftTasks = taskIdentities(leftManifest);
    const rightTasks = taskIdentities(rightManifest);
    const leftKeys = leftTasks.map((task) => task.key);
    const rightKeys = rightTasks.map((task) => task.key);
    const rightByKey = new Map(rightTasks.map((task) => [task.key, task]));

    const rightIndex = new Map(rightKeys.map((key, index) => [key, index]));
    const sharedTasks = leftKeys.filter((key) => rightIndex.has(key));
    const rightPositions = sharedTasks.map((key) => rightIndex.get(key));
    const orderPreserved = rightPositions.every((position, index) => index === 0 || position > rightPositions[index - 1]);
    const sourceComparable = stableStringify(leftManifest.sourcePin ?? {}) === stableStringify(rightManifest.sourcePin ?? {});
    const sharedDefinitionsMatch = leftTasks
        .filter((task) => rightByKey.has(task.key))
        .every((task) => task.definitionHash !== null && task.definitionHash === rightByKey.get(task.key).definitionHash);
    const sharedPrecedingMatch = leftTasks
        .filter((task) => rightByKey.has(task.key))
        .every((task) => stableStringify(task.preceding) === stableStringify(rightByKey.get(task.key).preceding));

    const fullComparable = sourceComparable && sharedDefinitionsMatch && stableStringify(leftTasks) === stableStringify(rightTasks);
    const longitudinalComparable = sourceComparable && sharedTasks.length > 0 && orderPreserved && sharedDefinitionsMatch && sharedPrecedingMatch;

    return {
        left: leftManifest.suite.reportingKey,
        right: rightManifest.suite.reportingKey,
        sharedTasks,
        orderPreserved,
        sharedDefinitionsMatch,
        sharedPrecedingMatch,
        sourceComparable,
        fullComparable,
        longitudinalComparable
    };
}

export function reportIdentity(manifest) {
    return {
        suite: manifest.suite.reportingKey,
        role: manifest.suite.role
    };
}

async function clonePinnedSource({ sourcePin, destination }) {
    const repoUrl = `https://github.com/${sourcePin.repository}.git`;
    const clone = await runCommand("git", ["clone", "--quiet", repoUrl, destination]);
    if (clone.exitCode !== 0) {
        throw new Error(`git clone failed: ${clone.stderr || clone.stdout}`);
    }
    const checkout = await runCommand("git", ["-C", destination, "checkout", "--quiet", sourcePin.commit]);
    if (checkout.exitCode !== 0) {
        throw new Error(`git checkout failed: ${checkout.stderr || checkout.stdout}`);
    }
}

async function applyReferencePatch({ sourceRoot, patchPath }) {
    const check = await runCommand("git", ["-C", sourceRoot, "apply", "--check", patchPath]);
    if (check.exitCode !== 0) {
        throw new Error(`reference patch check failed for ${path.basename(patchPath)}: ${check.stderr || check.stdout}`);
    }
    const apply = await runCommand("git", ["-C", sourceRoot, "apply", patchPath]);
    if (apply.exitCode !== 0) {
        throw new Error(`reference patch apply failed for ${path.basename(patchPath)}: ${apply.stderr || apply.stdout}`);
    }
}

async function readChangedPaths(sourceRoot) {
    const changed = await runCommand("git", ["-C", sourceRoot, "diff", "--name-only"]);
    const untracked = await runCommand("git", ["-C", sourceRoot, "ls-files", "--others", "--exclude-standard"]);
    return [...changed.stdout.split("\n"), ...untracked.stdout.split("\n")]
        .map((line) => line.trim())
        .filter(Boolean);
}

async function readBytes(root, relativePath) {
    try {
        return await readFile(path.resolve(root, relativePath));
    } catch {
        return null;
    }
}

// A suite is only valid when every referenced reference patch, wrong patch and oracle exists with the declared bytes.
export async function validateSuiteContracts({ manifest, suiteRoot = MODULE_DIR }) {
    const issues = [];
    const referenceByDigest = new Map();
    for (const ordered of manifest.orderedTasks ?? []) {
        const key = taskKey(ordered.id, ordered.version);
        const task = manifest.tasks?.[key];
        if (!task) continue;
        const prompt = String(task.definition?.prompt ?? "").trim();
        if (!prompt) {
            addIssue(issues, "PUBLIC_PROMPT_MISSING", `Task ${key} must provide a public prompt contract.`);
        }
        const requirements = task.definition?.agentContract?.requirements;
        if (!Array.isArray(requirements) || requirements.length === 0) {
            addIssue(issues, "AGENT_REQUIREMENTS_MISSING", `Task ${key} must provide public agent requirements.`);
        }
        if (!Array.isArray(task.definition?.api?.requiredExports) || task.definition.api.requiredExports.length === 0) {
            addIssue(issues, "API_REQUIRED_EXPORTS_MISSING", `Task ${key} must declare required API exports.`);
        }
        if (typeof task.definition?.cli?.command !== "string" || !task.definition.cli.command.trim()) {
            addIssue(issues, "CLI_COMMAND_MISSING", `Task ${key} must declare a CLI command.`);
        }
        if (typeof task.definition?.preservation?.command !== "string" || !task.definition.preservation.command.trim()) {
            addIssue(issues, "PRESERVATION_COMMAND_MISSING", `Task ${key} must declare a preservation command.`);
        }
        if (manifest.suite?.role === "hard" && !task.definition.preservation.command.includes("test/markdown-sync.test.mjs")) {
            addIssue(issues, "HARD_PRESERVATION_SURFACE_INCOMPLETE", `Task ${key} hard preservation command must include test/markdown-sync.test.mjs.`);
        }
        const reference = typeof task.referencePatch === "string" ? await readBytes(suiteRoot, task.referencePatch) : null;
        if (!reference || reference.length === 0) {
            addIssue(issues, "REFERENCE_PATCH_MISSING", `Task ${key} reference patch is missing or empty.`, { path: task.referencePatch });
        } else {
            const digest = sha256(reference);
            if (referenceByDigest.has(digest)) {
                addIssue(issues, "REFERENCE_PATCH_DUPLICATE", `Task ${key} reference patch is byte-identical to ${referenceByDigest.get(digest)}.`);
            }
            referenceByDigest.set(digest, key);
        }
        if (task.wrongPatch !== undefined) {
            const wrong = await readBytes(suiteRoot, task.wrongPatch);
            if (!wrong || wrong.length === 0) {
                addIssue(issues, "WRONG_PATCH_MISSING", `Task ${key} wrong patch is missing or empty.`, { path: task.wrongPatch });
            } else if (reference && sha256(wrong) === sha256(reference)) {
                addIssue(issues, "WRONG_PATCH_IDENTICAL", `Task ${key} wrong patch equals its reference patch.`);
            }
        }
        const oracleChecks = [...(task.definition?.api?.oracleChecks ?? []), ...(task.definition?.cli?.oracleChecks ?? [])];
        for (const check of oracleChecks) {
            const script = typeof check.script === "string" ? await readBytes(suiteRoot, check.script) : null;
            if (!script) {
                addIssue(issues, "ORACLE_SCRIPT_MISSING", `Task ${key} oracle '${check.name}' script is missing.`, { path: check.script });
            } else if (sha256(script) !== check.sha256) {
                addIssue(issues, "ORACLE_HASH_MISMATCH", `Task ${key} oracle '${check.name}' does not match its declared sha256.`);
            }
        }
    }
    return { ok: issues.length === 0, issues };
}

export async function collectCalibrationEvidenceForSuite({
    manifest,
    suiteRoot,
    workRoot = null,
    containerImage,
}) {
    const contracts = await validateSuiteContracts({ manifest, suiteRoot });
    if (!contracts.ok) {
        throw new Error(`Calibration refused for ${manifest.suite.reportingKey}\n${contracts.issues.map((issue) => `${issue.code}: ${issue.message}`).join("\n")}`);
    }
    const sourceAuthority = await verifySourcePinAuthority(manifest.sourcePin);
    if (!sourceAuthority.ok) {
        throw new Error(`Calibration refused for ${manifest.suite.reportingKey}\nSOURCE_AUTHORITY_MISMATCH: live repository metadata does not match sourcePin.`);
    }
    const runtimeRoot = workRoot ?? await mkdtemp(path.join(tmpdir(), "promptfoo-calibration-"));
    const calibrationByTask = {};
    const evidence = [];

    for (const ordered of manifest.orderedTasks) {
        const key = `${ordered.id}@${ordered.version}`;
        const taskDefinition = manifest.tasks[key];
        const baselineRoot = path.join(runtimeRoot, `${ordered.id}-baseline`);
        const referenceRoot = path.join(runtimeRoot, `${ordered.id}-reference`);
        const wrongRoot = path.join(runtimeRoot, `${ordered.id}-wrong`);
        const patchPath = path.resolve(suiteRoot, taskDefinition.referencePatch);

        await clonePinnedSource({ sourcePin: manifest.sourcePin, destination: baselineRoot });
        const baselineResult = await runTaskProbeInContainer({
            taskDefinition: {
                id: ordered.id,
                version: ordered.version,
                ...taskDefinition,
            },
            sourceRoot: baselineRoot,
            sourcePinCommit: manifest.sourcePin.commit,
            image: containerImage,
        });
        const usedWrongPatch = typeof taskDefinition.wrongPatch === "string";
        if (usedWrongPatch) {
            await clonePinnedSource({ sourcePin: manifest.sourcePin, destination: wrongRoot });
            await applyReferencePatch({ sourceRoot: wrongRoot, patchPath: path.resolve(suiteRoot, taskDefinition.wrongPatch) });
        }
        const taskRedResult = await runTaskProbeInContainer({
            taskDefinition: {
                id: ordered.id,
                version: ordered.version,
                ...taskDefinition,
            },
            sourceRoot: usedWrongPatch ? wrongRoot : baselineRoot,
            sourcePinCommit: manifest.sourcePin.commit,
            image: containerImage,
        });

        await clonePinnedSource({ sourcePin: manifest.sourcePin, destination: referenceRoot });
        await applyReferencePatch({ sourceRoot: referenceRoot, patchPath });
        const referenceResult = await runTaskProbeInContainer({
            taskDefinition: {
                id: ordered.id,
                version: ordered.version,
                ...taskDefinition,
            },
            sourceRoot: referenceRoot,
            sourcePinCommit: manifest.sourcePin.commit,
            image: containerImage,
        });

        const changedPaths = await readChangedPaths(referenceRoot);
        taskRedResult.usedWrongPatch = usedWrongPatch;
        calibrationByTask[key] = {
            baselineGreen: baselineResult,
            taskRed: taskRedResult,
            referenceGreen: referenceResult,
        };

        evidence.push({
            task: key,
            referencePatch: patchPath,
            baseline: {
                pass: baselineResult.pass,
                taskContractPass: baselineResult.taskContractPass,
                preservationPass: baselineResult.preservationPass,
                failureCodes: baselineResult.failures.map((failure) => failure.code),
                cliExitCode: baselineResult.runtimeObservation.receipts.cliResult.exitCode,
            },
            taskRed: {
                usedWrongPatch,
                pass: taskRedResult.pass,
                taskContractPass: taskRedResult.taskContractPass,
                preservationPass: taskRedResult.preservationPass,
                failureCodes: taskRedResult.failures.map((failure) => failure.code),
                cliExitCode: taskRedResult.runtimeObservation.receipts.cliResult.exitCode,
            },
            reference: {
                pass: referenceResult.pass,
                taskContractPass: referenceResult.taskContractPass,
                preservationPass: referenceResult.preservationPass,
                failureCodes: referenceResult.failures.map((failure) => failure.code),
                cliExitCode: referenceResult.runtimeObservation.receipts.cliResult.exitCode,
                changedPaths,
            },
        });
    }

    const matrix = evaluateCalibrationMatrix({ manifest, calibrationByTask });
    return {
        runtimeRoot,
        calibrationByTask,
        matrix,
        evidence,
        sourceAuthority,
    };
}

export async function validateSuite({ manifestPath, manifest }) {
    const loadedManifest = manifest ?? (await loadScenarioManifest(manifestPath)).manifest;
    const validation = validateScenarioManifest(loadedManifest);
    if (!validation.ok) {
        const formatted = validation.issues.map((issue) => `${issue.code}: ${issue.message}`).join("\n");
        throw new Error(`Suite validation failed for ${validation.suite}\n${formatted}`);
    }
    const suiteRoot = manifestPath ? path.dirname(path.dirname(path.resolve(manifestPath))) : MODULE_DIR;
    const contracts = await validateSuiteContracts({ manifest: loadedManifest, suiteRoot });
    if (!contracts.ok) {
        const formatted = contracts.issues.map((issue) => `${issue.code}: ${issue.message}`).join("\n");
        throw new Error(`Suite validation failed for ${validation.suite}\n${formatted}`);
    }
    const sourceAuthority = await verifySourcePinAuthority(loadedManifest.sourcePin);
    if (!sourceAuthority.ok) {
        throw new Error(`Suite validation failed for ${validation.suite}\nSOURCE_AUTHORITY_MISMATCH: live repository metadata does not match sourcePin.`);
    }
    return { ...validation, contracts, sourceAuthority };
}
