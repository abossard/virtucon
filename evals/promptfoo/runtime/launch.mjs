import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readdir, readFile, writeFile, access, rm } from "node:fs/promises";
import { resolve, relative } from "node:path";
import {
    RUNTIME_ARMS,
    RUNTIME_MODEL_DEFAULT,
    RUNTIME_PAYLOAD_COMMIT,
    RUNTIME_REASONING_DEFAULT,
    RUNTIME_SOFT_CREDIT_CAP_TARGET,
    createCodingOutcome,
    createLaunchReceipt,
    createRuntimeBudget,
    createRuntimeInfraError,
    assertArm,
    assertSuiteId,
} from "./contracts.mjs";
import { createTaskIsolationContext, nextMinimeLineage } from "./isolation.mjs";
import { terminateProcessTree, writeHostReceipt } from "./teardown.mjs";
import { candidateIdentity, loadVerifiedCandidate, resolveCandidateSelection } from "./candidate.mjs";

const COPILOT_BINARY = "copilot";
const COPILOT_PACKAGE_VERSION = "1.0.99-3";
const DEFAULT_IMAGE_TAG = `minime-eval-runtime-default:${COPILOT_PACKAGE_VERSION}`;
const MINIME_IMAGE_TAG_PREFIX = `minime-eval-runtime-minime:${COPILOT_PACKAGE_VERSION}`;
const MINIME_AGENT = "minime:dr-evil";
const MINIME_PLUGIN_DIR = "/opt/minime";
const TASK_MOUNT = "/work/repo";
const RUNTIME_MOUNT = "/work/runtime";
const HQ_MOUNT = "/work/hq";
const SNAPSHOT_MANIFEST = ".snapshot-manifest.json";
const INCOMPLETE_WRITE_PATTERN = /(\.(tmp|partial|lock|swp|part)|~)$|^\.tmp-/i;

const RUNTIME_INFRA_SIGNATURES = [
    { code: "runtime-auth-missing", pattern: /No authentication information found/i, missing: ["COPILOT_GITHUB_TOKEN"] },
    { code: "runtime-agent-unavailable", pattern: /No such agent:/i, missing: ["minime-agent-definition"] },
    { code: "runtime-cli-usage-invalid", pattern: /Usage: copilot/i, missing: ["copilot-cli-compatible-flags"] },
    { code: "runtime-image-registry-denied", pattern: /error from registry: denied/i, missing: ["runtime-image-availability"] },
];

async function runCommandCapture({
    command,
    args,
    cwd,
    env,
    spawnImpl = spawn,
}) {
    return new Promise((resolveResult) => {
        const child = spawnImpl(command, args, {
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
        child.on("error", (error) => {
            resolveResult({
                exitCode: null,
                signal: null,
                stdout,
                stderr: `${stderr}\n${error.message}`.trim(),
                error,
            });
        });
        child.on("close", (exitCode, signal) => {
            resolveResult({
                exitCode,
                signal,
                stdout,
                stderr,
                error: null,
            });
        });
    });
}

async function readJsonIfExists(filePath) {
    try {
        const content = await readFile(filePath, "utf8");
        return JSON.parse(content);
    } catch {
        return null;
    }
}

function classifyRuntimeInfra(stderr = "") {
    for (const signature of RUNTIME_INFRA_SIGNATURES) {
        if (signature.pattern.test(stderr)) {
            return signature;
        }
    }
    return null;
}

function snapshotPathFor(runtimeRoot, snapshotId) {
    const slug = String(snapshotId).replace(/[^a-zA-Z0-9._-]/g, "_");
    return resolve(runtimeRoot, "snapshots", slug, "hq");
}

async function copySnapshotIfExists({ runtimeRoot, snapshotId, destination }) {
    if (!snapshotId) {
        return { restored: false, fileCount: 0, snapshotPath: null, failure: null };
    }
    const source = snapshotPathFor(runtimeRoot, snapshotId);
    const manifest = await readJsonIfExists(resolve(source, SNAPSHOT_MANIFEST));
    if (!manifest) {
        return { restored: false, fileCount: 0, snapshotPath: source, failure: "snapshot-missing-or-manifest-unreadable" };
    }
    let actualHash;
    try {
        actualHash = await hashDirectoryTree(source);
    } catch {
        return { restored: false, fileCount: 0, snapshotPath: source, failure: "snapshot-unreadable" };
    }
    if (actualHash !== manifest.contentHash) {
        return { restored: false, fileCount: 0, snapshotPath: source, failure: "snapshot-hash-mismatch" };
    }
    await cp(source, destination, {
        recursive: true,
        filter: (path) => !path.endsWith(SNAPSHOT_MANIFEST),
    });
    return { restored: true, fileCount: manifest.fileCount ?? 0, snapshotPath: source, failure: null };
}

async function findIncompleteWrites(root, depth = 0) {
    if (!root || depth > 8) return [];
    let entries;
    try {
        entries = await readdir(root, { withFileTypes: true });
    } catch {
        return [];
    }
    const found = [];
    for (const entry of entries) {
        const absolute = resolve(root, entry.name);
        if (INCOMPLETE_WRITE_PATTERN.test(entry.name)) found.push(relative(root, absolute) || entry.name);
        if (entry.isDirectory()) {
            found.push(...(await findIncompleteWrites(absolute, depth + 1)).map((path) => `${entry.name}/${path}`));
        }
    }
    return found;
}

async function countFilesRecursive(root, depth = 0) {
    if (!root || depth > 8) return 0;
    let entries;
    try {
        entries = await readdir(root, { withFileTypes: true });
    } catch {
        return 0;
    }
    let total = 0;
    for (const entry of entries) {
        if (entry.isFile()) {
            total += 1;
        } else if (entry.isDirectory()) {
            total += await countFilesRecursive(resolve(root, entry.name), depth + 1);
        }
    }
    return total;
}

export function parseJsonlRecords(text) {
    const records = [];
    for (const line of String(text ?? "").split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === "object") records.push(parsed);
        } catch {}
    }
    return records;
}

export function parseJsonObject(value) {
    if (!value) return null;
    if (typeof value === "object") return value;
    if (typeof value !== "string") return null;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
        return null;
    }
}

const ON_IMAGE_INVENTORY_SCRIPT = `
const fs=require("fs"),path=require("path"),crypto=require("crypto");
const roots=[".claude-plugin",".github/extensions","agents","assets","skills","hooks"];
const files={};
function walk(abs,rel){const st=fs.lstatSync(abs);if(st.isDirectory()){for(const e of fs.readdirSync(abs).sort())walk(path.join(abs,e),rel+"/"+e);}else if(st.isFile()){files[rel]=((st.mode&73)?"100755":"100644")+":"+crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");}else{files[rel]="unsupported";}}
for(const r of roots){if(fs.existsSync("/opt/minime/"+r))walk("/opt/minime/"+r,r);}
const sorted=Object.fromEntries(Object.entries(files).sort(([a],[b])=>a<b?-1:1));
const read=f=>fs.readFileSync("/opt/minime/"+f,"utf8").trim();
const manifestSha=crypto.createHash("sha256").update(fs.readFileSync("/opt/minime/.candidate-manifest.json")).digest("hex");
console.log(JSON.stringify({files:sorted,payloadSha:read(".payload-sha"),sourceCommit:read(".payload-source-commit"),manifestSha256:manifestSha}));
`;

const PHASE_NAMES = ["blueprint", "replicate", "inspect", "extract"];

export function phaseForWorker({ name, agentType }) {
    const normalizedName = String(name ?? "").trim().toLowerCase();
    if (/(^|:)frau$/i.test(String(agentType ?? "").trim())) return "inspect";
    if (normalizedName === "blueprint" || normalizedName === "replicate" || normalizedName === "extract") return normalizedName;
    return null;
}

export function parseTaskToolResult(data = {}) {
    const result = parseJsonObject(data.result) ?? parseJsonObject(data.output) ?? {};
    const textPayload = [result.content, result.detailedContent]
        .filter((value) => typeof value === "string")
        .join("\n");
    const statusFromText = textPayload.match(/(?:^|\n)\s*status:\s*([a-z_ -]+)/i)?.[1]?.trim().toLowerCase() ?? null;
    const childIdFromText = textPayload.match(/(?:^|\n)\s*(?:agent_id|agent-id|child_id|child-id):\s*([^\s]+)/i)?.[1] ?? null;
    const status = typeof result.status === "string"
        ? result.status.trim().toLowerCase()
        : statusFromText;
    const workerId = typeof result.agent_id === "string"
        ? result.agent_id
        : typeof result.id === "string"
            ? result.id
            : childIdFromText;
    return { status, workerId };
}

// Phase fidelity requires a native `task` dispatch (start event) correlated by toolCallId
// to a successful completion event. Text, skill loads and tool catalogs are never evidence.
function derivePhaseEvidence({ jsonRecords }) {
    const dispatches = new Map();
    for (const record of jsonRecords) {
        const type = String(record?.type ?? "").toLowerCase();
        const data = record?.data ?? {};
        const toolCallId = typeof data.toolCallId === "string" ? data.toolCallId : null;
        if (!toolCallId) continue;
        if (type === "tool.execution_start" && data.toolName === "task") {
            const args = parseJsonObject(data.arguments) ?? parseJsonObject(data.argumentsJson) ?? {};
            const agentType = typeof args.agent_type === "string" ? args.agent_type.trim() : null;
            const name = typeof args.name === "string" ? args.name.trim() : null;
            const phase = phaseForWorker({ name, agentType });
            if (phase && !dispatches.has(toolCallId)) {
                dispatches.set(toolCallId, {
                    phase,
                    toolCallId,
                    name,
                    agentType,
                    background: String(args.mode ?? "").toLowerCase() === "background",
                    completed: false,
                    success: null,
                    workerStatus: null,
                    workerId: null,
                    startIndex: dispatches.size,
                });
            }
        } else if (type === "tool.execution_complete" && dispatches.has(toolCallId)) {
            const entry = dispatches.get(toolCallId);
            const result = parseTaskToolResult(data);
            entry.completed = true;
            entry.success = data.success !== false;
            entry.workerStatus = result.status;
            entry.workerId = result.workerId;
        }
    }
    const workers = [...dispatches.values()];
    const phases = {};
    const phaseSequence = [];
    for (const phase of PHASE_NAMES) {
        const matching = workers.filter((worker) => worker.phase === phase);
        const done = matching.find((worker) => {
            if (!(worker.completed && worker.success)) return false;
            if (worker.workerStatus === "running") return false;
            if (worker.background && !["completed", "idle"].includes(worker.workerStatus)) return false;
            return true;
        });
        if (done) phaseSequence.push(done.startIndex);
        phases[phase] = {
            dispatched: matching.length > 0,
            completed: Boolean(done),
            workerId: done?.toolCallId ?? null,
            childId: done ? (done.workerId ?? "UNKNOWN") : null,
            childStatus: done?.workerStatus ?? null,
            agentType: (done ?? matching[0])?.agentType ?? null,
        };
    }
    const completedIds = PHASE_NAMES.map((phase) => (phases[phase].completed ? phases[phase].workerId : null));
    const distinct = new Set(completedIds.filter(Boolean)).size === PHASE_NAMES.length;
    const phaseOrderOk = phaseSequence.every((position, index) => index === 0 || position > phaseSequence[index - 1]);
    const missing = PHASE_NAMES.filter((phase) => !phases[phase].completed);
    const runningWorkers = workers
        .filter((worker) => worker.workerStatus === "running"
            || (worker.background && !["completed", "idle"].includes(worker.workerStatus)))
        .map((worker) => ({ phase: worker.phase, toolCallId: worker.toolCallId, childId: worker.workerId }));
    return {
        blueprint: phases.blueprint.completed,
        replicate: phases.replicate.completed,
        inspectOrFrau: phases.inspect.completed,
        extract: phases.extract.completed,
        observedAgents: [...new Set(workers.map((worker) => worker.agentType ?? worker.name).filter(Boolean))],
        phaseWorkers: phases,
        fidelity: {
            complete: missing.length === 0 && distinct && phaseOrderOk,
            missing,
            distinctWorkers: distinct,
            phaseOrderOk,
            runningWorkers,
        },
        source: workers.length > 0 ? "native-task-events" : "none",
    };
}

function extractNativeUsage(jsonRecords) {
    const result = [...jsonRecords].reverse().find((record) => String(record?.type ?? "") === "result" && record?.usage);
    const sessionErrors = jsonRecords
        .filter((record) => String(record?.type ?? "") === "session.error")
        .slice(0, 5)
        .map((record) => String(record?.data?.message ?? record?.message ?? "").slice(0, 500));
    return {
        resultUsage: result?.usage && typeof result.usage === "object" ? result.usage : null,
        sessionErrors,
    };
}

async function collectNativeDiagnostics({ runtimeRoot, hqRoot, stdout, stderr }) {
    const diagnostics = {
        hooks: {
            reloadFailed: false,
            loadedPromptMode: false,
        },
        phases: {
            blueprint: false,
            replicate: false,
            inspectOrFrau: false,
            extract: false,
            source: "unknown",
            observedAgents: [],
            phaseWorkers: null,
            fidelity: { complete: false, missing: [...PHASE_NAMES], distinctWorkers: false },
        },
        hq: {
            fileCount: await countFilesRecursive(hqRoot),
        },
        stream: {
            stdoutPath: resolve(runtimeRoot, "stdout.full.log"),
            stderrPath: resolve(runtimeRoot, "stderr.full.log"),
        },
        usage: {
            available: false,
            source: "unknown",
            descendantInclusiveProven: false,
            nativeResult: null,
            sessionErrors: [],
        },
    };
    await writeFile(diagnostics.stream.stdoutPath, stdout, "utf8");
    await writeFile(diagnostics.stream.stderrPath, stderr, "utf8");
    const logsRoot = resolve(runtimeRoot, "logs");
    let logText = "";
    let jsonlText = "";
    try {
        const logFiles = await readdir(logsRoot);
        for (const file of logFiles) {
            if (file.endsWith(".log")) {
                logText += `\n${await readFile(resolve(logsRoot, file), "utf8")}`;
            } else if (file.endsWith(".jsonl")) {
                jsonlText += `\n${await readFile(resolve(logsRoot, file), "utf8")}`;
            }
        }
    } catch {}
    diagnostics.hooks.reloadFailed = /Failed to reload managed hooks/i.test(logText);
    diagnostics.hooks.loadedPromptMode = /Loading repo hooks in prompt mode/i.test(logText);
    const benignNoSessionReload = /Failed to reload managed hooks[\s\S]*no hook session for session id/i.test(logText);
    if (diagnostics.hooks.reloadFailed && benignNoSessionReload && diagnostics.hooks.loadedPromptMode) {
        diagnostics.hooks.reloadFailed = false;
        diagnostics.hooks.reloadReason = "benign-no-session-before-hook-init";
    }
    const jsonRecords = parseJsonlRecords(`${stdout}\n${stderr}\n${jsonlText}`);
    diagnostics.phases = {
        ...diagnostics.phases,
        ...derivePhaseEvidence({ jsonRecords }),
    };
    const nativeUsage = extractNativeUsage(jsonRecords);
    diagnostics.usage = {
        ...diagnostics.usage,
        available: Boolean(nativeUsage.resultUsage),
        source: nativeUsage.resultUsage ? "native-result-event" : "unknown",
        nativeResult: nativeUsage.resultUsage,
        sessionErrors: nativeUsage.sessionErrors,
    };
    return diagnostics;
}

async function hashPayloadTree(projectRoot) {
    const payloadRoots = [
        ".claude-plugin",
        ".github/extensions",
        "agents",
        "assets",
        "skills",
        "hooks",
    ];
    const hash = createHash("sha256");
    for (const root of payloadRoots) {
        const absolute = resolve(projectRoot, root);
        hash.update(root);
        hash.update("\n");
        hash.update(await hashDirectoryTree(absolute));
        hash.update("\n");
    }
    return hash.digest("hex");
}

async function listTrackedPayloadFiles({ projectRoot, commit, spawnImpl = spawn }) {
    const payloadRoots = [
        ".claude-plugin",
        ".github/extensions",
        "agents",
        "assets",
        "skills",
        "hooks",
    ];
    const ls = await runCommandCapture({
        command: "git",
        args: ["-C", projectRoot, "ls-tree", "-r", "--name-only", commit, "--", ...payloadRoots],
        cwd: projectRoot,
        env: process.env,
        spawnImpl,
    });
    if (ls.exitCode !== 0) {
        throw new Error(`git ls-tree failed for payload roots at ${commit}: ${ls.stderr || ls.stdout}`);
    }
    return ls.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export async function materializePayloadFromCommit({
    projectRoot,
    commit,
    stagingPayloadRoot,
    spawnImpl = spawn,
}) {
    const archivePath = resolve(stagingPayloadRoot, `.payload-${randomUUID()}.tar`);
    const archive = await runCommandCapture({
        command: "git",
        args: [
            "-C",
            projectRoot,
            "archive",
            "--format=tar",
            "--output",
            archivePath,
            commit,
            "--",
            ".claude-plugin",
            ".github/extensions",
            "agents",
            "assets",
            "skills",
            "hooks",
        ],
        cwd: projectRoot,
        env: process.env,
        spawnImpl,
    });
    if (archive.exitCode !== 0) {
        throw new Error(`git archive payload failed at ${commit}: ${archive.stderr || archive.stdout}`);
    }
    const extract = await runCommandCapture({
        command: "tar",
        args: ["-xf", archivePath, "-C", stagingPayloadRoot],
        cwd: projectRoot,
        env: process.env,
        spawnImpl,
    });
    await rm(archivePath, { force: true });
    if (extract.exitCode !== 0) {
        throw new Error(`payload archive extract failed at ${commit}: ${extract.stderr || extract.stdout}`);
    }
    const trackedFiles = await listTrackedPayloadFiles({ projectRoot, commit, spawnImpl });
    if (trackedFiles.length === 0) {
        throw new Error(`No tracked payload files found for commit ${commit}.`);
    }
    for (const file of trackedFiles) {
        const stagedPath = resolve(stagingPayloadRoot, file);
        try {
            await access(stagedPath);
        } catch {
            throw new Error(`Payload checkout missing tracked file: ${file}`);
        }
    }
    return trackedFiles;
}

async function hashDirectoryTree(rootPath) {
    const hash = createHash("sha256");
    async function walk(current) {
        const entries = await readdir(current, { withFileTypes: true });
        entries.sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
            const absolute = resolve(current, entry.name);
            if (entry.isDirectory()) {
                await walk(absolute);
                continue;
            }
            if (!entry.isFile()) continue;
            if (entry.name === SNAPSHOT_MANIFEST) continue;
            const relativePath = relative(rootPath, absolute);
            hash.update(relativePath);
            hash.update("\n");
            hash.update(await readFile(absolute));
            hash.update("\n");
        }
    }
    await walk(rootPath);
    return hash.digest("hex");
}

async function dockerImageExists({ image, cwd, env, spawnImpl }) {
    const result = await runCommandCapture({
        command: "docker",
        args: ["image", "inspect", image],
        cwd,
        env,
        spawnImpl,
    });
    return result.exitCode === 0;
}

function commonCopilotArgs({ model, reasoningEffort, softCreditCapTarget }) {
    const args = [
        "-C",
        TASK_MOUNT,
        "--autopilot",
        "--no-ask-user",
        "--trust-folder",
        "--allow-all-tools",
        "--disallow-temp-dir",
        "--no-auto-update",
        "--disable-builtin-mcps",
        "--model",
        model,
        "--reasoning-effort",
        reasoningEffort,
    ];
    if (softCreditCapTarget !== null && softCreditCapTarget !== undefined) {
        args.push("--max-ai-credits", String(softCreditCapTarget));
    }
    args.push(
        "--output-format",
        "json",
        "--log-dir",
        `${RUNTIME_MOUNT}/logs`,
        "--usage-output-file",
        `${RUNTIME_MOUNT}/usage.json`,
        "--disable-client-telemetry",
    );
    return args;
}

export function buildRuntimeArmSpecs({
    images = null,
    model = RUNTIME_MODEL_DEFAULT,
    reasoningEffort = RUNTIME_REASONING_DEFAULT,
    softCreditCapTarget = RUNTIME_SOFT_CREDIT_CAP_TARGET,
    omitAgent = false,
} = {}) {
    const common = {
        defaultImage: images?.defaultImage ?? DEFAULT_IMAGE_TAG,
        minimeImage: images?.minimeImage ?? `${MINIME_IMAGE_TAG_PREFIX}-unbuilt`,
        model,
        reasoningEffort,
        softCreditCapTarget,
        pinnedBase: true,
    };

    return {
        base: common,
        [RUNTIME_ARMS.DEFAULT]: {
            arm: RUNTIME_ARMS.DEFAULT,
            image: common.defaultImage,
            pluginEnabled: false,
            hqEnabled: false,
            environment: {
                COPILOT_AUTO_UPDATE: "false",
                HOME: "/work/home",
                COPILOT_HOME: "/work/copilot",
                TMPDIR: "/work/scratch",
            },
            copilotArgs(sessionId) {
                return [COPILOT_BINARY, ...commonCopilotArgs({ model, reasoningEffort, softCreditCapTarget })];
            },
        },
        [RUNTIME_ARMS.MINIME]: {
            arm: RUNTIME_ARMS.MINIME,
            image: common.minimeImage,
            pluginEnabled: true,
            hqEnabled: true,
            environment: {
                COPILOT_AUTO_UPDATE: "false",
                HOME: "/work/home",
                COPILOT_HOME: "/work/copilot",
                TMPDIR: "/work/scratch",
                VIRTUCON_HQ: HQ_MOUNT,
            },
            copilotArgs(sessionId) {
                return [
                    COPILOT_BINARY,
                    ...commonCopilotArgs({ model, reasoningEffort, softCreditCapTarget }),
                    ...(omitAgent ? [] : ["--agent", MINIME_AGENT]),
                    "--plugin-dir",
                    MINIME_PLUGIN_DIR,
                    "--add-dir",
                    "/opt/minime",
                    "--add-dir",
                    HQ_MOUNT,
                ];
            },
        },
    };
}

export async function buildLocalRuntimeImages({
    projectRoot = resolve(process.cwd(), "..", ".."),
    dockerfilePath = resolve(process.cwd(), "runtime", "Dockerfile"),
    forceRebuild = false,
    allowWorkingTreePayloadFallback = false,
    candidate = null,
    spawnImpl = spawn,
} = {}) {
    const payloadCommit = RUNTIME_PAYLOAD_COMMIT;
    let verifiedCandidate = null;
    try {
        if (resolveCandidateSelection(candidate ?? {})) verifiedCandidate = await loadVerifiedCandidate(candidate);
    } catch (error) {
        return createRuntimeInfraError({
            code: "runtime-candidate-invalid",
            message: `Explicit candidate manifest rejected before model execution: ${error.message}`,
            blockerEvidence: {
                missingPrerequisites: ["verified-approved-candidate"],
                capabilityChecks: [{ id: "candidate-verification", status: "failed", reason: "candidate_rejected" }],
                evidence: [String(error?.message ?? error)],
            },
        });
    }
    const payloadVersion = await runCommandCapture({
        command: "git",
        args: ["-C", projectRoot, "cat-file", "-e", `${payloadCommit}^{commit}`],
        cwd: projectRoot,
        env: process.env,
        spawnImpl,
    });
    if (payloadVersion.exitCode !== 0) {
        return createRuntimeInfraError({
            code: "runtime-payload-commit-unresolved",
            message: "Unable to resolve immutable payload source commit.",
            blockerEvidence: {
                missingPrerequisites: ["git-commit-source"],
                capabilityChecks: [{ id: "payload-commit", status: "failed", reason: "declared_commit_missing" }],
                evidence: [payloadVersion.stderr || payloadVersion.stdout || "declared payload commit not found in local object database"],
            },
        });
    }
    const buildEvidence = [];

    const stagingRoot = resolve(projectRoot, "evals", "promptfoo", "runtime", ".payload-staging");
    await mkdir(stagingRoot, { recursive: true });
    const stagingPayloadRoot = resolve(stagingRoot, "payload");
    await runCommandCapture({
        command: "rm",
        args: ["-rf", stagingPayloadRoot],
        cwd: projectRoot,
        env: process.env,
        spawnImpl,
    });
    await mkdir(stagingPayloadRoot, { recursive: true });
    await mkdir(resolve(stagingPayloadRoot, ".github"), { recursive: true });
    let trackedPayloadFiles;
    try {
        if (verifiedCandidate) {
            await cp(verifiedCandidate.payloadRoot, stagingPayloadRoot, { recursive: true });
            await writeFile(resolve(stagingPayloadRoot, ".candidate-manifest.json"), verifiedCandidate.manifestBytes);
            trackedPayloadFiles = verifiedCandidate.files.map((file) => file.path);
        } else {
            trackedPayloadFiles = await materializePayloadFromCommit({
                projectRoot,
                commit: payloadCommit,
                stagingPayloadRoot,
                spawnImpl,
            });
        }
    } catch (error) {
        if (allowWorkingTreePayloadFallback && !verifiedCandidate) {
            await Promise.all([
                cp(resolve(projectRoot, ".claude-plugin"), resolve(stagingPayloadRoot, ".claude-plugin"), { recursive: true }),
                cp(resolve(projectRoot, ".github", "extensions"), resolve(stagingPayloadRoot, ".github", "extensions"), { recursive: true }),
                cp(resolve(projectRoot, "agents"), resolve(stagingPayloadRoot, "agents"), { recursive: true }),
                cp(resolve(projectRoot, "assets"), resolve(stagingPayloadRoot, "assets"), { recursive: true }),
                cp(resolve(projectRoot, "skills"), resolve(stagingPayloadRoot, "skills"), { recursive: true }),
                cp(resolve(projectRoot, "hooks"), resolve(stagingPayloadRoot, "hooks"), { recursive: true }),
            ]);
            trackedPayloadFiles = [];
        } else {
        return createRuntimeInfraError({
            code: "runtime-payload-materialization-failed",
            message: "Failed to materialize immutable MINIME payload from approved commit.",
            blockerEvidence: {
                missingPrerequisites: ["payload-commit-materialization"],
                capabilityChecks: [{ id: "payload-materialization", status: "failed", reason: "git_checkout_failed" }],
                evidence: [String(error?.message ?? error)],
            },
        });
        }
    }
    const payloadHash = verifiedCandidate ? verifiedCandidate.payloadSha256 : await hashPayloadTree(stagingPayloadRoot);
    await writeFile(resolve(stagingPayloadRoot, ".payload-commit"), `${payloadCommit}\n`, "utf8");
    const images = {
        defaultImage: DEFAULT_IMAGE_TAG,
        minimeImage: verifiedCandidate
            ? `${MINIME_IMAGE_TAG_PREFIX}-c${payloadHash.slice(0, 12)}-${verifiedCandidate.manifestSha256.slice(0, 12)}`
            : `${MINIME_IMAGE_TAG_PREFIX}-${payloadHash.slice(0, 12)}`,
        payloadHash,
        payloadCommit,
        candidate: verifiedCandidate ? candidateIdentity(verifiedCandidate) : null,
        dockerfilePath,
        projectRoot,
    };
    if (verifiedCandidate) {
        buildEvidence.push(`candidate manifest: ${verifiedCandidate.manifestSha256}`);
        buildEvidence.push(`candidate patch: ${verifiedCandidate.patchSha256}`);
    }
    buildEvidence.push(`payload file count: ${trackedPayloadFiles.length}`);
    buildEvidence.push(`payload commit: ${payloadCommit}`);
    buildEvidence.push(`payload hash: ${payloadHash}`);

    const maybeBuild = async ({ image, target, extraArgs = [], force = forceRebuild }) => {
        if (!force && await dockerImageExists({
            image,
            cwd: projectRoot,
            env: process.env,
            spawnImpl,
        })) {
            buildEvidence.push(`Image already present: ${image}`);
            return true;
        }
        const args = [
            "build",
            "--file",
            dockerfilePath,
            "--target",
            target,
            "--build-arg",
            `COPILOT_VERSION=${COPILOT_PACKAGE_VERSION}`,
            "--build-arg",
            `MINIME_PAYLOAD_COMMIT=${payloadCommit}`,
            ...extraArgs,
            "--tag",
            image,
            resolve(projectRoot, "evals", "promptfoo", "runtime"),
        ];
        const built = await runCommandCapture({
            command: "docker",
            args,
            cwd: projectRoot,
            env: process.env,
            spawnImpl,
        });
        buildEvidence.push(`docker ${args.join(" ")}`);
        if (built.exitCode !== 0) {
            return createRuntimeInfraError({
                code: "runtime-image-build-failed",
                message: `Failed to build image ${image}.`,
                blockerEvidence: {
                    missingPrerequisites: ["docker-build-success"],
                    capabilityChecks: [{ id: `build:${target}`, status: "failed", reason: "docker_build_exit_nonzero" }],
                    evidence: [built.stdout.slice(-2000), built.stderr.slice(-2000)].filter(Boolean),
                },
            });
        }
        buildEvidence.push(`Built image: ${image}`);
        return true;
    };

    const defaultBuild = await maybeBuild({
        image: images.defaultImage,
        target: "runtime-default",
        // A candidate never changes DEFAULT. Rebuilding it would retag the image with a new index digest for identical content.
        force: forceRebuild && !verifiedCandidate,
    });
    if (defaultBuild !== true) return defaultBuild;

    const minimeBuild = await maybeBuild({
        image: images.minimeImage,
        target: "runtime-minime",
        extraArgs: ["--build-arg", `MINIME_PAYLOAD_SHA=${payloadHash}`],
    });
    if (minimeBuild !== true) return minimeBuild;

    return {
        kind: "runtime_images_built",
        ok: true,
        images,
        evidence: buildEvidence,
    };
}

export async function runRuntimeImageReadinessProbe({
    images,
    cwd = process.cwd(),
    env = process.env,
    spawnImpl = spawn,
}) {
    const checks = [];
    const evidence = [];
    const missingPrerequisites = [];

    const defaultHelp = await runCommandCapture({
        command: "docker",
        args: ["run", "--rm", images.defaultImage, COPILOT_BINARY, "--help"],
        cwd,
        env,
        spawnImpl,
    });
    const defaultOk = defaultHelp.exitCode === 0
        && defaultHelp.stdout.includes("--max-ai-credits")
        && defaultHelp.stdout.includes("--usage-output-file");
    checks.push({
        id: "default-image-copilot-help",
        status: defaultOk ? "ok" : "failed",
        reason: defaultOk ? "flags_present" : "copilot_help_failed_or_missing_flags",
    });
    evidence.push(defaultHelp.stdout.slice(-1000) || defaultHelp.stderr.slice(-1000));

    const defaultNoPayload = await runCommandCapture({
        command: "docker",
        args: ["run", "--rm", images.defaultImage, "sh", "-lc", "test ! -f /opt/minime/.claude-plugin/plugin.json && test ! -f /opt/minime/hooks/session-start.js"],
        cwd,
        env,
        spawnImpl,
    });
    const defaultPayloadOk = defaultNoPayload.exitCode === 0;
    checks.push({
        id: "default-image-no-minime-payload",
        status: defaultPayloadOk ? "ok" : "failed",
        reason: defaultPayloadOk ? "payload_absent" : "payload_present_or_probe_failed",
    });

    const minimePayload = await runCommandCapture({
        command: "docker",
        args: [
            "run",
            "--rm",
            images.minimeImage,
            "sh",
            "-lc",
            "test -f /opt/minime/.claude-plugin/plugin.json && test -f /opt/minime/.payload-sha && test -f /opt/minime/agents/dr-evil.md && test -f /opt/minime/hooks/session-start.js",
        ],
        cwd,
        env,
        spawnImpl,
    });
    const minimePayloadOk = minimePayload.exitCode === 0;
    checks.push({
        id: "minime-image-payload-present",
        status: minimePayloadOk ? "ok" : "failed",
        reason: minimePayloadOk ? "payload_present" : "payload_missing_or_probe_failed",
    });
    evidence.push(minimePayload.stderr.slice(-1000));

    const minimeHelp = await runCommandCapture({
        command: "docker",
        args: ["run", "--rm", images.minimeImage, COPILOT_BINARY, "--help"],
        cwd,
        env,
        spawnImpl,
    });
    const minimeHelpOk = minimeHelp.exitCode === 0
        && minimeHelp.stdout.includes("--max-ai-credits")
        && minimeHelp.stdout.includes("--usage-output-file");
    checks.push({
        id: "minime-image-copilot-help",
        status: minimeHelpOk ? "ok" : "failed",
        reason: minimeHelpOk ? "flags_present" : "copilot_help_failed_or_missing_flags",
    });
    evidence.push(minimeHelp.stdout.slice(-1000) || minimeHelp.stderr.slice(-1000));

    let candidateOk = true;
    if (images.candidate) {
        candidateOk = false;
        let reason = "candidate_verification_failed";
        try {
            const verified = await loadVerifiedCandidate({
                candidateManifestPath: images.candidate.candidateManifestPath,
                approvedCandidateManifestSha256: images.candidate.manifestSha256,
            });
            const onImage = await runCommandCapture({
                command: "docker",
                args: ["run", "--rm", images.minimeImage, "node", "-e", ON_IMAGE_INVENTORY_SCRIPT],
                cwd,
                env,
                spawnImpl,
            });
            const inventory = onImage.exitCode === 0 ? parseJsonObject(onImage.stdout.trim().split(/\r?\n/).pop()) : null;
            const expected = Object.fromEntries(verified.files.map((file) => [file.path, `${file.mode}:${file.sha256}`]));
            const matches = inventory
                && JSON.stringify(inventory.files) === JSON.stringify(Object.fromEntries(Object.entries(expected).sort(([a], [b]) => (a < b ? -1 : 1))))
                && inventory.payloadSha === verified.payloadSha256
                && inventory.sourceCommit === verified.baseCommit
                && inventory.manifestSha256 === verified.manifestSha256;
            candidateOk = Boolean(matches);
            reason = candidateOk ? "on_image_bytes_match_approved_candidate" : "on_image_bytes_differ_from_approved_candidate";
        } catch (error) {
            evidence.push(String(error?.message ?? error));
        }
        checks.push({ id: "minime-image-candidate-bytes", status: candidateOk ? "ok" : "failed", reason });
    }

    const defaultInspect = await runCommandCapture({
        command: "docker",
        args: ["image", "inspect", "--format", "{{.Id}}", images.defaultImage],
        cwd,
        env,
        spawnImpl,
    });
    const defaultImageId = defaultInspect.exitCode === 0 ? defaultInspect.stdout.trim() || null : null;

    if (!defaultOk || !defaultPayloadOk || !minimePayloadOk || !minimeHelpOk || !candidateOk) {
        missingPrerequisites.push("runtime-image-readiness");
    }

    return {
        ok: missingPrerequisites.length === 0,
        defaultImageId,
        images,
        missingPrerequisites,
        capabilityChecks: checks,
        evidence: evidence.filter(Boolean),
    };
}

export async function ensureLocalRuntimeReady({
    projectRoot = resolve(process.cwd(), "..", ".."),
    cwd = process.cwd(),
    spawnImpl = spawn,
    forceRebuild = false,
    allowWorkingTreePayloadFallback = false,
    candidate = null,
} = {}) {
    const built = await buildLocalRuntimeImages({
        projectRoot,
        dockerfilePath: resolve(cwd, "runtime", "Dockerfile"),
        forceRebuild,
        allowWorkingTreePayloadFallback,
        candidate,
        spawnImpl,
    });
    if (built?.kind === "runtime_infra_error") return built;
    const readiness = await runRuntimeImageReadinessProbe({
        images: built.images,
        cwd,
        env: process.env,
        spawnImpl,
    });
    if (!readiness.ok) {
        return createRuntimeInfraError({
            code: "runtime-image-readiness-failed",
            message: "Local runtime image readiness probe failed.",
            blockerEvidence: {
                missingPrerequisites: readiness.missingPrerequisites,
                capabilityChecks: readiness.capabilityChecks,
                evidence: [...built.evidence, ...readiness.evidence],
            },
        });
    }
    return {
        kind: "runtime_image_ready",
        ok: true,
        images: built.images,
        defaultImageId: readiness.defaultImageId,
        buildEvidence: built.evidence,
        readinessEvidence: readiness,
    };
}

export function buildDockerRunPlan({
    arm,
    context,
    armSpecs = buildRuntimeArmSpecs(),
    prompt,
}) {
    assertArm(arm);
    const armSpec = armSpecs[arm];
    const args = [
        "run",
        "--rm",
        "--name",
        `promptfoo-${arm.toLowerCase()}-${context.runId}`,
        "--user",
        "1000:1000",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--pids-limit",
        "512",
        "--mount",
        `type=bind,src=${context.paths.sourceRoot},dst=${TASK_MOUNT}`,
        "--mount",
        `type=bind,src=${context.paths.runtimeRoot},dst=${RUNTIME_MOUNT}`,
        "--mount",
        `type=bind,src=${context.paths.home},dst=/work/home`,
        "--mount",
        `type=bind,src=${context.paths.copilotHome},dst=/work/copilot`,
        "--mount",
        `type=bind,src=${context.paths.cacheRoot},dst=/work/cache`,
        "--mount",
        `type=bind,src=${context.paths.scratchRoot},dst=/work/scratch`,
    ];
    if (arm === RUNTIME_ARMS.MINIME) {
        args.push("--mount", `type=bind,src=${context.paths.hqRoot},dst=${HQ_MOUNT}`);
    }
    for (const [key, value] of Object.entries(armSpec.environment)) {
        args.push("-e", `${key}=${value}`);
    }
    args.push("-e", "COPILOT_GITHUB_TOKEN");
    args.push("-e", "GH_TOKEN");
    args.push("-e", "GITHUB_TOKEN");
    args.push(armSpec.image, ...armSpec.copilotArgs(context.sessionId), "-p", prompt);
    return { command: "docker", args, arm };
}

export async function createTaskRuntimeContext({
    runtimeRoot,
    suiteId,
    repeatIndex,
    taskId,
    arm,
    previousMinimeLineage = null,
}) {
    assertSuiteId(suiteId);
    assertArm(arm);
    const context = await createTaskIsolationContext({
        runtimeRoot,
        suiteId,
        repeatIndex,
        taskId,
        arm,
        sessionId: randomUUID(),
    });
    const lineage = arm === RUNTIME_ARMS.MINIME
        ? nextMinimeLineage({
            suiteId,
            repeatIndex,
            previousLineage: previousMinimeLineage,
            outputSnapshotId: null,
        })
        : { suiteId, repeatIndex, inputSnapshotId: null, outputSnapshotId: null };
    let snapshotRestore = { restored: false, fileCount: 0, snapshotPath: null, failure: null };
    if (arm === RUNTIME_ARMS.MINIME && lineage.inputSnapshotId && context.paths.hqRoot) {
        snapshotRestore = await copySnapshotIfExists({
            runtimeRoot,
            snapshotId: lineage.inputSnapshotId,
            destination: context.paths.hqRoot,
        });
    }
    return { ...context, lineage, snapshotRestore };
}

export async function runMinimeCompatibilityProbe({
    token,
    capabilityProbe,
    probeId = "minime-native-launch",
    abortSignal,
}) {
    const cancelledResult = () => createRuntimeInfraError({
        code: "probe-cancelled",
        message: "Compatibility probe cancelled before completion.",
        blockerEvidence: {
            missingPrerequisites: [],
            capabilityChecks: [{ id: probeId, status: "blocked", reason: "cancelled" }],
            evidence: ["Abort signal was set."],
        },
    });
    if (abortSignal?.aborted) return cancelledResult();
    if (typeof token !== "string" || !token.trim()) {
        return createRuntimeInfraError({
            code: "missing-auth",
            message: "Missing COPILOT_GITHUB_TOKEN for MINIME compatibility probe.",
            blockerEvidence: {
                missingPrerequisites: ["COPILOT_GITHUB_TOKEN"],
                capabilityChecks: [{ id: probeId, status: "blocked", reason: "missing_credential" }],
                evidence: ["Probe did not execute because auth token is absent."],
            },
        });
    }
    if (typeof capabilityProbe !== "function") {
        return createRuntimeInfraError({
            code: "missing-probe",
            message: "No capability probe function was provided.",
            blockerEvidence: {
                missingPrerequisites: ["capability-probe"],
                capabilityChecks: [{ id: probeId, status: "blocked", reason: "probe_not_provided" }],
                evidence: ["Runtime cannot gather native evidence/accounting without a probe function."],
            },
        });
    }
    let probeResult;
    try {
        probeResult = await capabilityProbe(abortSignal);
    } catch (error) {
        if (abortSignal?.aborted) return cancelledResult();
        return createRuntimeInfraError({
            code: "probe-execution-failed",
            message: `Compatibility probe failed: ${error.message}`,
            blockerEvidence: {
                missingPrerequisites: [],
                capabilityChecks: [{ id: probeId, status: "failed", reason: "probe_threw" }],
                evidence: [String(error.stack ?? error.message ?? error)],
            },
        });
    }
    if (abortSignal?.aborted) return cancelledResult();
    if (!probeResult?.ok) {
        return createRuntimeInfraError({
            code: "compatibility-blocked",
            message: probeResult?.message ?? "Compatibility probe reported a blocker.",
            blockerEvidence: {
                missingPrerequisites: Array.isArray(probeResult?.missingPrerequisites) ? probeResult.missingPrerequisites : [],
                capabilityChecks: Array.isArray(probeResult?.capabilityChecks)
                    ? probeResult.capabilityChecks
                    : [{ id: probeId, status: "failed", reason: "probe_reported_blocker" }],
                evidence: Array.isArray(probeResult?.evidence) ? probeResult.evidence : [],
            },
        });
    }
    return {
        kind: "compatibility_probe_ok",
        ok: true,
        probeId,
        evidence: Array.isArray(probeResult?.evidence) ? probeResult.evidence : [],
        accountingScope: probeResult?.accountingScope ?? null,
    };
}

export async function runManagedRuntimeCommand({
    command,
    args = [],
    cwd,
    env,
    context,
    suiteId,
    arm,
    taskId,
    abortSignal,
    taskTimeoutMs,
    wrapperTimeoutMs,
    teardownGraceMs = 300,
    candidate = null,
    runtimeImage = null,
    launchReceiptPath = null,
    usageReceiptPath = null,
    teardownReceiptPath = null,
    spawnImpl = spawn,
}) {
    assertArm(arm);
    assertSuiteId(suiteId);
    const defaultBudgets = createRuntimeBudget({ suiteId });
    const effectiveTaskTimeoutMs = Number(taskTimeoutMs ?? defaultBudgets.taskSeconds * 1000);
    const effectiveWrapperTimeoutMs = Number(wrapperTimeoutMs ?? defaultBudgets.wrapperSeconds * 1000);
    const budgets = {
        ...defaultBudgets,
        taskSeconds: effectiveTaskTimeoutMs / 1000,
        wrapperSeconds: effectiveWrapperTimeoutMs / 1000,
        teardownGraceSeconds: Math.max(0, (effectiveWrapperTimeoutMs - effectiveTaskTimeoutMs) / 1000),
    };

    const startedAt = new Date().toISOString();
    const resolvedLaunchReceiptPath = launchReceiptPath ?? resolve(context.paths.receiptsRoot, "launch.json");
    const resolvedUsageReceiptPath = usageReceiptPath ?? resolve(context.paths.receiptsRoot, "usage.json");
    const resolvedTeardownReceiptPath = teardownReceiptPath ?? resolve(context.paths.receiptsRoot, "teardown.json");
    const restoreFailed = arm === RUNTIME_ARMS.MINIME
        && Boolean(context.lineage?.inputSnapshotId)
        && !context.snapshotRestore?.restored;
    if (restoreFailed) {
        const message = `Required MINIME snapshot '${context.lineage?.inputSnapshotId}' was not restored: ${context.snapshotRestore?.failure ?? "missing"}.`;
        return createRuntimeInfraError({
            code: "runtime-required-snapshot-restore-failed",
            message,
            blockerEvidence: {
                missingPrerequisites: ["minime-lineage-input-snapshot"],
                capabilityChecks: [{
                    id: "snapshot-restore",
                    status: "failed",
                    reason: context.snapshotRestore?.failure ?? "missing",
                }],
                evidence: [message],
            },
        });
    }

    let timedOut = false;
    let cancelled = false;
    let wrapperTimedOut = false;
    let teardownResult = null;

    const containerNameIndex = args.indexOf("--name");
    const containerName = containerNameIndex >= 0 ? args[containerNameIndex + 1] : null;
    const preAborted = Boolean(abortSignal?.aborted);
    cancelled = preAborted;
    let stdout = "";
    let stderr = "";
    let child = null;
    let closePromise;
    if (preAborted) {
        teardownResult = { pid: null, requested: false, escalated: false, stillRunning: false, containerRemoved: null };
        closePromise = Promise.resolve({ exitCode: null, signal: null });
    } else {
        child = spawnImpl(command, args, {
            cwd,
            env,
            detached: true,
            stdio: "pipe",
        });
        child.unref();
        child.stdout?.on("data", (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr?.on("data", (chunk) => {
            stderr += chunk.toString();
        });
        closePromise = new Promise((resolveClose, rejectClose) => {
            child.once("error", rejectClose);
            child.once("close", (exitCode, signal) => resolveClose({ exitCode, signal }));
        });
    }

    let teardownPromise = null;
    const requestTeardown = () => {
        if (!child) return Promise.resolve(teardownResult);
        if (!teardownPromise) {
            teardownPromise = (async () => {
                const processResult = await terminateProcessTree(child.pid, { graceMs: teardownGraceMs });
                let containerRemoved = null;
                if (containerName) {
                    containerRemoved = await new Promise((resolveRemove) => {
                        const remove = spawnImpl("docker", ["rm", "-f", containerName], {
                            cwd,
                            env,
                            stdio: "ignore",
                        });
                        remove.on("error", () => resolveRemove(false));
                        remove.on("close", (code) => resolveRemove(code === 0));
                    });
                }
                teardownResult = { ...processResult, containerRemoved };
                return teardownResult;
            })();
        }
        return teardownPromise;
    };

    const taskTimer = child ? setTimeout(() => {
        timedOut = true;
        void requestTeardown();
    }, effectiveTaskTimeoutMs) : null;
    const wrapperTimer = child ? setTimeout(() => {
        wrapperTimedOut = true;
        void requestTeardown();
    }, effectiveWrapperTimeoutMs) : null;
    const onAbort = () => {
        cancelled = true;
        void requestTeardown();
    };
    if (child) abortSignal?.addEventListener("abort", onAbort, { once: true });

    let close;
    try {
        close = await closePromise;
    } catch (error) {
        clearTimeout(taskTimer);
        clearTimeout(wrapperTimer);
        abortSignal?.removeEventListener("abort", onAbort);
        await requestTeardown();
        return createRuntimeInfraError({
            code: "spawn-failed",
            message: `Runtime process failed to launch: ${error.message}`,
            blockerEvidence: {
                missingPrerequisites: [],
                capabilityChecks: [{ id: "runtime-launch", status: "failed", reason: "spawn_error" }],
                evidence: [String(error.stack ?? error.message ?? error)],
            },
        });
    }

    // Results (timeout, cancel, snapshot, grading) must not precede confirmed termination of owned workers.
    if (teardownPromise) await teardownPromise;
    clearTimeout(taskTimer);
    clearTimeout(wrapperTimer);
    abortSignal?.removeEventListener("abort", onAbort);

    const endedAt = new Date().toISOString();
    const durationMs = Date.parse(endedAt) - Date.parse(startedAt);
    const status = wrapperTimedOut
        ? "timeout"
        : timedOut
            ? "timeout"
            : cancelled
                ? "cancelled"
                : close.exitCode === 0
                    ? "completed"
                    : "failed";

    const receipt = createLaunchReceipt({
        arm,
        suiteId,
        taskId,
        sessionId: context.sessionId,
        budgets,
        paths: context.paths,
        evidence: {
            launchReceiptPath: resolvedLaunchReceiptPath,
            usageReceiptPath: resolvedUsageReceiptPath,
            teardownReceiptPath: resolvedTeardownReceiptPath,
        },
        lineage: context.lineage,
        status,
        timing: {
            startedAt,
            endedAt,
            durationMs,
        },
    });
    receipt.lineage.inputSnapshotRestored = Boolean(context.snapshotRestore?.restored);
    receipt.lineage.inputSnapshotPath = context.snapshotRestore?.snapshotPath ?? null;
    receipt.lineage.inputSnapshotFileCount = context.snapshotRestore?.fileCount ?? 0;
    receipt.lineage.inputSnapshotFailure = context.snapshotRestore?.failure ?? null;
    receipt.lineage.inputSnapshotMissing = Boolean(context.lineage?.inputSnapshotId) && !context.snapshotRestore?.restored;
    const episodeRuntimeRoot = resolve(context.paths.workspaceRoot, "..", "..");
    const nativeDiagnostics = await collectNativeDiagnostics({
        runtimeRoot: context.paths.runtimeRoot,
        hqRoot: context.paths.hqRoot,
        stdout,
        stderr,
    });
    const fidelity = arm === RUNTIME_ARMS.MINIME
        ? {
            applicable: true,
            complete: Boolean(nativeDiagnostics.phases.fidelity?.complete),
            missing: nativeDiagnostics.phases.fidelity?.missing ?? [...PHASE_NAMES],
            source: nativeDiagnostics.phases.source,
            phaseWorkers: nativeDiagnostics.phases.phaseWorkers,
            failure: nativeDiagnostics.phases.fidelity?.complete ? null : "minime-phases-not-dispatched",
            runningWorkers: nativeDiagnostics.phases.fidelity?.runningWorkers ?? [],
            phaseOrderOk: nativeDiagnostics.phases.fidelity?.phaseOrderOk ?? false,
        }
        : { applicable: false, complete: null, missing: [], source: null, phaseWorkers: null, failure: null, runningWorkers: [], phaseOrderOk: null };

    let snapshotEvidence = {
        promoted: false,
        quarantined: false,
        quarantineReasons: [],
        quarantinePath: null,
        snapshotId: null,
        snapshotPath: null,
        fileCount: 0,
        contentHash: null,
        manifestPath: null,
        lastValidSnapshotId: receipt.lineage.lastCompletedSnapshotId ?? null,
    };
    if (arm === RUNTIME_ARMS.MINIME && context.paths.hqRoot) {
        const hqFileCount = await countFilesRecursive(context.paths.hqRoot);
        const incompleteWrites = await findIncompleteWrites(context.paths.hqRoot);
        const reasons = [];
        if (status !== "completed") reasons.push(`task-${status}`);
        if (incompleteWrites.length > 0) reasons.push("incomplete-writes");
        if ((fidelity.runningWorkers ?? []).length > 0) reasons.push("native-workers-running");
        if (hqFileCount > 0 && reasons.length === 0) {
            const snapshotId = `${suiteId}:${taskId}:${context.runId}`;
            const snapshotPath = snapshotPathFor(episodeRuntimeRoot, snapshotId);
            await mkdir(resolve(snapshotPath, ".."), { recursive: true });
            await cp(context.paths.hqRoot, snapshotPath, { recursive: true });
            const contentHash = await hashDirectoryTree(snapshotPath);
            const manifestPath = resolve(snapshotPath, SNAPSHOT_MANIFEST);
            await writeFile(manifestPath, `${JSON.stringify({
                snapshotId,
                sourceHqRoot: context.paths.hqRoot,
                fileCount: hqFileCount,
                contentHash,
                createdAt: new Date().toISOString(),
            }, null, 2)}\n`, "utf8");
            receipt.lineage.outputSnapshotId = snapshotId;
            receipt.lineage.lastCompletedSnapshotId = snapshotId;
            snapshotEvidence = {
                ...snapshotEvidence,
                promoted: true,
                snapshotId,
                snapshotPath,
                fileCount: hqFileCount,
                contentHash,
                manifestPath,
                lastValidSnapshotId: snapshotId,
            };
        } else if (hqFileCount > 0) {
            const quarantinePath = resolve(episodeRuntimeRoot, "quarantine", context.runId, "hq");
            await mkdir(resolve(quarantinePath, ".."), { recursive: true });
            await cp(context.paths.hqRoot, quarantinePath, { recursive: true });
            snapshotEvidence = {
                ...snapshotEvidence,
                quarantined: true,
                quarantineReasons: reasons,
                quarantinePath,
                fileCount: hqFileCount,
                incompleteWrites,
            };
        }
    }
    receipt.snapshot = {
        promoted: snapshotEvidence.promoted,
        quarantined: snapshotEvidence.quarantined,
        quarantineReasons: snapshotEvidence.quarantineReasons,
        lastValidSnapshotId: snapshotEvidence.lastValidSnapshotId,
    };
    receipt.fidelity = { applicable: fidelity.applicable, complete: fidelity.complete, failure: fidelity.failure };
    receipt.candidate = arm === RUNTIME_ARMS.MINIME ? candidate : null;
    receipt.runtimeImage = runtimeImage;

    await writeHostReceipt(resolvedLaunchReceiptPath, receipt);
    const runtimeUsagePath = resolve(context.paths.runtimeRoot, "usage.json");
    const runtimeUsage = await readJsonIfExists(runtimeUsagePath);
    const usageMetrics = {
        durationMs,
        exitCode: close.exitCode,
        signal: close.signal,
    };
    await writeHostReceipt(resolvedUsageReceiptPath, runtimeUsage
        ? {
            authority: "runtime-emitted",
            source: "copilot-usage-output-file",
            available: true,
            accountingScope: "Runtime-emitted usage payload. Includes reported main and agent metrics. Descendant completeness is unknown unless explicitly proven in native events.",
            usagePath: runtimeUsagePath,
            payload: runtimeUsage,
            nativeResult: nativeDiagnostics.usage.nativeResult,
            nativeDiagnostics,
            descendantInclusiveProven: false,
            metrics: usageMetrics,
        }
        : {
            authority: nativeDiagnostics.usage.available ? "runtime-emitted" : "host",
            source: nativeDiagnostics.usage.available ? "native-result-event" : "runtime-wrapper",
            available: nativeDiagnostics.usage.available,
            reason: nativeDiagnostics.usage.available ? null : "Usage payload was not emitted by runtime command.",
            accountingScope: nativeDiagnostics.usage.available
                ? "Native result-event usage. Descendant completeness is unknown."
                : null,
            usagePath: runtimeUsagePath,
            nativeResult: nativeDiagnostics.usage.nativeResult,
            sessionErrors: nativeDiagnostics.usage.sessionErrors,
            nativeDiagnostics,
            descendantInclusiveProven: false,
            metrics: usageMetrics,
        });
    const usageSummary = runtimeUsage
        ? {
            source: "usage-output-file",
            available: true,
            providerModelMetrics: runtimeUsage.providerModelMetrics ?? null,
            agentModelMetrics: runtimeUsage.agentModelMetrics ?? null,
            nativeResult: nativeDiagnostics.usage.nativeResult,
        }
        : {
            source: nativeDiagnostics.usage.available ? "native-result-event" : "none",
            available: nativeDiagnostics.usage.available,
            nativeResult: nativeDiagnostics.usage.nativeResult,
            reason: nativeDiagnostics.usage.available ? null : "usage-not-emitted",
        };
    await writeHostReceipt(resolvedTeardownReceiptPath, {
        status,
        timedOut,
        cancelled,
        preAborted,
        wrapperTimedOut,
        teardownResult,
        teardownConfirmed: teardownResult
            ? { processStopped: teardownResult.stillRunning === false, containerRemoved: teardownResult.containerRemoved ?? null }
            : null,
        stdoutTail: stdout.slice(-4000),
        stderrTail: stderr.slice(-4000),
        nativeDiagnostics,
        fidelity,
        snapshotEvidence,
        candidate: receipt.candidate,
        runtimeImage,
    });

    if (status === "failed") {
        const infra = classifyRuntimeInfra(stderr);
        if (infra) {
            return createRuntimeInfraError({
                code: infra.code,
                message: "Runtime execution failed due to infrastructure constraints.",
                blockerEvidence: {
                    missingPrerequisites: infra.missing,
                    capabilityChecks: [{ id: "runtime-command", status: "failed", reason: infra.code }],
                    evidence: [stderr.slice(-4000)],
                },
                receipt,
            });
        }
    }

    return createCodingOutcome({
        status,
        message: status === "failed" ? "Runtime command exited non-zero." : null,
        receipt,
        fidelity,
        snapshot: snapshotEvidence,
        usage: usageSummary,
        metrics: usageMetrics,
    });
}
