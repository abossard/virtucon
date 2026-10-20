import crypto, { randomUUID } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";

export const PROBE_CONTRACT_VERSION = "1.2.0";
export const PROBE_CONTAINER_IMAGE = process.env.PROMPTFOO_PROBE_IMAGE || "minime-eval-runtime-default:1.0.99-3";
export const PROBE_CONTAINER_WORKDIR = "/work/repo";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROBE_FAILURE_BOUNDARY = "verifier-probe";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_PRESERVATION_PROTECTED_PATHS = ["test/**", "test/fixtures/**"];
const DEFAULT_IMPLEMENTATION_PATHS = ["src/**", "bin/**", "README.md"];
const PROBE_MODULE_HASH = `sha256:${sha256(readFileSync(fileURLToPath(import.meta.url)))}`;

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

function normalizeRelativePath(filePath) {
    const normalized = filePath.replaceAll("\\", "/");
    const collapsed = path.posix.normalize(normalized.replace(/^\.\//, ""));
    if (collapsed === "." || collapsed.startsWith("/") || collapsed === ".." || collapsed.startsWith("../")) {
        return null;
    }
    return collapsed;
}

function globToRegExp(glob) {
    const escaped = glob
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "__DOUBLE_STAR__")
        .replace(/\*/g, "[^/]*")
        .replace(/__DOUBLE_STAR__/g, ".*");
    return new RegExp(`^${escaped}$`);
}

function pathMatchesAllowlist(filePath, allowlist) {
    return allowlist.some((pattern) => globToRegExp(pattern).test(filePath));
}

function pushFailure(failures, code, message, detail = {}) {
    failures.push({
        boundary: PROBE_FAILURE_BOUNDARY,
        code,
        message,
        detail
    });
}

function checkApiContract({ definition, observation, failures }) {
    const requiredExports = definition.api?.requiredExports ?? [];
    const exportedValues = new Set(observation.api?.exports ?? []);
    for (const exportName of requiredExports) {
        if (!exportedValues.has(exportName)) {
            pushFailure(failures, "API_EXPORT_MISSING", `Missing required export '${exportName}'.`, { exportName });
        }
    }

    const apiChecks = definition.api?.checks ?? [];
    const observedChecks = new Map((observation.api?.checks ?? []).map((entry) => [entry.name, entry.ok]));
    for (const check of apiChecks) {
        if (observedChecks.get(check.name) !== true) {
            pushFailure(failures, "API_CHECK_FAILED", `API check '${check.name}' did not pass.`, { check: check.name });
        }
    }
    for (const check of definition.api?.oracleChecks ?? []) {
        if (!observedChecks.has(check.name)) {
            pushFailure(failures, "ORACLE_CHECK_MISSING", `Oracle check '${check.name}' was not executed.`, { check: check.name });
        } else if (observedChecks.get(check.name) !== true) {
            pushFailure(failures, "API_CHECK_FAILED", `API oracle check '${check.name}' did not pass.`, { check: check.name });
        }
    }
}

function checkCliContract({ definition, observation, failures }) {
    const cli = definition.cli ?? {};
    const observed = observation.cli ?? {};
    if (typeof cli.expectedExitCode === "number" && observed.exitCode !== cli.expectedExitCode) {
        pushFailure(failures, "CLI_EXIT_CODE_MISMATCH", "CLI exit code did not match expectation.", {
            expected: cli.expectedExitCode,
            actual: observed.exitCode
        });
    }

    const stdout = observed.stdout ?? "";
    for (const fragment of cli.stdoutIncludes ?? []) {
        if (!stdout.includes(fragment)) {
            pushFailure(failures, "CLI_STDOUT_MISSING", `CLI stdout is missing '${fragment}'.`, { fragment });
        }
    }

    const observedCliChecks = new Map((observed.checks ?? []).map((entry) => [entry.name, entry.ok]));
    for (const check of cli.oracleChecks ?? []) {
        if (!observedCliChecks.has(check.name)) {
            pushFailure(failures, "ORACLE_CHECK_MISSING", `Oracle check '${check.name}' was not executed.`, { check: check.name });
        } else if (observedCliChecks.get(check.name) !== true) {
            pushFailure(failures, "CLI_CHECK_FAILED", `CLI oracle check '${check.name}' did not pass.`, { check: check.name });
        }
    }

    const stderr = observed.stderr ?? "";
    for (const fragment of cli.stderrExcludes ?? []) {
        if (stderr.includes(fragment)) {
            pushFailure(failures, "CLI_STDERR_FORBIDDEN", `CLI stderr contains forbidden fragment '${fragment}'.`, { fragment });
        }
    }
}

function checkFilesystemContract({ definition, taskDefinition, observation, failures }) {
    const touchedPaths = observation.filesystem?.touchedPaths ?? [];
    const wrotePaths = observation.filesystem?.wrotePaths ?? [];
    const pathAllowlist = taskDefinition.pathAllowlist ?? [];

    for (const rawPath of touchedPaths) {
        const normalized = normalizeRelativePath(rawPath);
        if (!normalized) {
            pushFailure(failures, "PATH_ESCAPE_ATTEMPT", `Touched path '${rawPath}' escapes repository root.`, { rawPath });
            continue;
        }
        if (!pathMatchesAllowlist(normalized, pathAllowlist)) {
            pushFailure(failures, "PATH_NOT_ALLOWED", `Touched path '${normalized}' is outside allowlist.`, {
                path: normalized,
                allowlist: pathAllowlist
            });
        }
    }

    if (definition.requiresChange === true && wrotePaths.length === 0) {
        pushFailure(failures, "NO_OP_PATCH", "Task requires a source change but no files were written.");
    }

    for (const requiredPattern of definition.filesystem?.requiredWrites ?? []) {
        const hasMatch = wrotePaths.some((rawPath) => {
            const normalized = normalizeRelativePath(rawPath);
            return normalized ? pathMatchesAllowlist(normalized, [requiredPattern]) : false;
        });
        if (!hasMatch) {
            pushFailure(failures, "REQUIRED_WRITE_MISSING", `No write matched required pattern '${requiredPattern}'.`, {
                pattern: requiredPattern
            });
        }
    }

    for (const forbiddenPattern of definition.filesystem?.forbiddenWrites ?? []) {
        for (const rawPath of wrotePaths) {
            const normalized = normalizeRelativePath(rawPath);
            if (normalized && pathMatchesAllowlist(normalized, [forbiddenPattern])) {
                pushFailure(failures, "FORBIDDEN_WRITE", `Write '${normalized}' matched forbidden pattern '${forbiddenPattern}'.`, {
                    pattern: forbiddenPattern,
                    path: normalized
                });
            }
        }
    }

    const preservationTamperedPaths = observation.filesystem?.preservationTamperedPaths ?? [];
    if (preservationTamperedPaths.length > 0) {
        pushFailure(
            failures,
            "PRESERVATION_SURFACE_TAMPERED",
            "Candidate modified preservation-owned test/fixture paths.",
            { paths: preservationTamperedPaths },
        );
    }
}

function implementationPatternsForTask(taskDefinition) {
    const configured = taskDefinition.definition?.filesystem?.implementationPaths;
    if (Array.isArray(configured) && configured.length > 0) return configured;
    return DEFAULT_IMPLEMENTATION_PATHS;
}

async function snapshotFileTree(root, relative = "") {
    const entries = await readdir(path.join(root, relative), { withFileTypes: true });
    const files = new Map();
    for (const entry of entries) {
        if (entry.name === ".git") continue;
        if (!relative && entry.name === "node_modules") continue;
        const childRelative = relative ? path.posix.join(relative, entry.name) : entry.name;
        const childFullPath = path.join(root, childRelative);
        if (entry.isDirectory()) {
            const nested = await snapshotFileTree(root, childRelative);
            for (const [key, value] of nested.entries()) files.set(key, value);
            continue;
        }
        if (entry.isSymbolicLink()) {
            files.set(childRelative, "symlink");
            continue;
        }
        if (!entry.isFile()) continue;
        const content = await readFile(childFullPath);
        files.set(childRelative, `file:${sha256(content)}`);
    }
    return files;
}

async function collectChangedPathsFromTrees({ baselineRoot, candidateRoot }) {
    const baselineTree = await snapshotFileTree(baselineRoot);
    const candidateTree = await snapshotFileTree(candidateRoot);
    const allPaths = new Set([...baselineTree.keys(), ...candidateTree.keys()]);
    const changedPaths = [];
    for (const filePath of allPaths) {
        if (baselineTree.get(filePath) !== candidateTree.get(filePath)) {
            changedPaths.push(filePath);
        }
    }
    changedPaths.sort();
    return { changedPaths, baselinePaths: new Set(baselineTree.keys()) };
}

const LIST_GROUP = /[\[{]([^\[\]{}]*)[\]}]/g;
const IDENTIFIER_LIST_LINE = /^\s*[\w$]+(?:\s*,\s*[\w$]+)*\s*,?\s*$/;

function listItems(text) {
    return text.split(",").map((item) => item.trim()).filter(Boolean);
}

function isSuperset(baselineItems, candidateItems) {
    const candidate = new Set(candidateItems);
    return baselineItems.every((item) => candidate.has(item));
}

// A line is an allowed expansion when it only adds items to an existing identifier list,
// import/export braces, or array literal, with the rest of the line unchanged.
function lineExpands(baselineLine, candidateLine) {
    if (IDENTIFIER_LIST_LINE.test(baselineLine) && IDENTIFIER_LIST_LINE.test(candidateLine)) {
        return isSuperset(listItems(baselineLine), listItems(candidateLine));
    }
    const baselineGroups = [...baselineLine.matchAll(LIST_GROUP)].map((match) => listItems(match[1]));
    const candidateGroups = [...candidateLine.matchAll(LIST_GROUP)].map((match) => listItems(match[1]));
    if (baselineGroups.length === 0 || baselineGroups.length !== candidateGroups.length) return false;
    if (baselineLine.replace(LIST_GROUP, "[]") !== candidateLine.replace(LIST_GROUP, "[]")) return false;
    return baselineGroups.every((group, index) => isSuperset(group, candidateGroups[index]));
}

export function isAdditiveProtectedEdit({ baselineContent, candidateContent }) {
    if (!baselineContent || !candidateContent) return false;
    const baselineLines = baselineContent.toString("utf8").split(/\r?\n/);
    const candidateLines = candidateContent.toString("utf8").split(/\r?\n/);
    let cursor = 0;
    for (const line of baselineLines) {
        while (cursor < candidateLines.length && candidateLines[cursor] !== line && !lineExpands(line, candidateLines[cursor])) cursor += 1;
        if (cursor >= candidateLines.length) return false;
        cursor += 1;
    }
    return true;
}

async function materializeIndependentProbeSource({
    sourceRoot,
    taskDefinition,
    sourcePinCommit = "HEAD",
    timeoutMs,
}) {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "promptfoo-probe-source-"));
    const isolatedSourceRoot = path.join(tempRoot, "repo");
    const clone = await runCommand("git", ["clone", "--quiet", "--no-checkout", sourceRoot, isolatedSourceRoot], { timeoutMs });
    if (clone.exitCode !== 0) throw new Error(`Failed to clone probe baseline: ${clone.stderr || clone.stdout}`);
    const checkout = await runCommand("git", ["checkout", "--force", "--detach", sourcePinCommit], { cwd: isolatedSourceRoot, timeoutMs });
    if (checkout.exitCode !== 0) throw new Error(`Failed to checkout probe baseline commit ${sourcePinCommit}: ${checkout.stderr || checkout.stdout}`);
    const clean = await runCommand("git", ["clean", "-fdx"], { cwd: isolatedSourceRoot, timeoutMs });
    if (clean.exitCode !== 0) throw new Error(`Failed to clean probe baseline workspace: ${clean.stderr || clean.stdout}`);

    const { changedPaths: candidateChangedPaths, baselinePaths } = await collectChangedPathsFromTrees({
        baselineRoot: isolatedSourceRoot,
        candidateRoot: sourceRoot,
    });
    const implementationPatterns = implementationPatternsForTask(taskDefinition);
    const protectedPatterns = taskDefinition.definition?.preservation?.protectedPaths ?? DEFAULT_PRESERVATION_PROTECTED_PATHS;
    const appliedPaths = [];
    const blockedPaths = [];
    const tamperedPaths = [];
    const additivePaths = [];

    for (const normalized of candidateChangedPaths) {
        if (!pathMatchesAllowlist(normalized, implementationPatterns)) {
            blockedPaths.push(normalized);
            if (pathMatchesAllowlist(normalized, protectedPatterns)) {
                if (baselinePaths.has(normalized)) {
                    const baselinePath = path.join(isolatedSourceRoot, normalized);
                    const candidatePath = path.join(sourceRoot, normalized);
                    const baselineContent = await readFile(baselinePath).catch(() => null);
                    const candidateContent = await readFile(candidatePath).catch(() => null);
                    if (isAdditiveProtectedEdit({ baselineContent, candidateContent })) additivePaths.push(normalized);
                    else tamperedPaths.push(normalized);
                } else {
                    additivePaths.push(normalized);
                }
            }
            continue;
        }
        const sourcePath = path.join(sourceRoot, normalized);
        const targetPath = path.join(isolatedSourceRoot, normalized);
        try {
            const sourceStat = await lstat(sourcePath);
            if (!sourceStat.isFile()) {
                blockedPaths.push(normalized);
                continue;
            }
            const content = await readFile(sourcePath);
            await mkdir(path.dirname(targetPath), { recursive: true });
            await writeFile(targetPath, content);
            appliedPaths.push(normalized);
        } catch {
            await rm(targetPath, { force: true });
            appliedPaths.push(normalized);
        }
    }

    if (existsSync(path.join(isolatedSourceRoot, "package-lock.json"))) {
        const install = await runCommand("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
            cwd: isolatedSourceRoot,
            env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? tmpdir() },
            timeoutMs: Math.max(timeoutMs ?? 0, 120_000),
        });
        if (install.exitCode !== 0) {
            const error = new Error(`Locked dependency install failed: ${install.stderr.trim().slice(0, 500)}`);
            error.code = "PROBE_DEPENDENCY_INSTALL";
            error.boundary = PROBE_FAILURE_BOUNDARY;
            throw error;
        }
    }

    return {
        tempRoot,
        isolatedSourceRoot,
        appliedPaths,
        blockedPaths,
        tamperedPaths,
        additivePaths,
        implementationPatterns,
    };
}

function runCommand(command, args, { cwd, env = {}, timeoutMs = DEFAULT_TIMEOUT_MS, abortSignal } = {}) {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
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

        let timedOut = false;
        let aborted = false;
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
        }, timeoutMs);
        const onAbort = () => {
            aborted = true;
            child.kill("SIGTERM");
            setTimeout(() => {
                try { child.kill("SIGKILL"); } catch {}
            }, 300).unref?.();
        };
        abortSignal?.addEventListener("abort", onAbort, { once: true });

        child.on("error", (error) => {
            clearTimeout(timer);
            abortSignal?.removeEventListener("abort", onAbort);
            reject(error);
        });
        child.on("close", (exitCode, signal) => {
            clearTimeout(timer);
            abortSignal?.removeEventListener("abort", onAbort);
            resolve({
                exitCode: typeof exitCode === "number" ? exitCode : 1,
                signal: signal ?? null,
                stdout,
                stderr,
                timedOut,
                aborted,
                durationMs: Date.now() - startedAt,
            });
        });
    });
}

function buildProbeContainerArgs({ sourceRoot, image, command, env = {} }) {
    return [
        "run",
        "--rm",
        "--network",
        "none",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--pids-limit",
        "256",
        "--user",
        "1000:1000",
        "--mount",
        `type=bind,src=${sourceRoot},dst=${PROBE_CONTAINER_WORKDIR},readonly`,
        "--tmpfs",
        "/tmp:rw,nosuid,nodev,size=128m",
        "--tmpfs",
        "/home/probe:rw,nosuid,nodev,size=64m",
        "-w",
        PROBE_CONTAINER_WORKDIR,
        "-e",
        "HOME=/home/probe",
        "-e",
        "COPILOT_HOME=/home/probe/copilot",
        "-e",
        "VIRTUCON_HQ=/home/probe/hq",
        "-e",
        "TMPDIR=/tmp",
        "-e",
        "COPILOT_GITHUB_TOKEN=",
        "-e",
        "GH_TOKEN=",
        "-e",
        "GITHUB_TOKEN=",
        ...Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
        image,
        "sh",
        "-lc",
        command,
    ];
}

const DOCKER_INFRA_STDERR = [
    /^docker: /m,
    /Unable to find image/i,
    /Cannot connect to the Docker daemon/i,
    /error during container init/i,
    /OCI runtime/i,
    /executable file not found/i,
];

function assertContainerStarted(result, command) {
    const failed = DOCKER_INFRA_STDERR.some((pattern) => pattern.test(result.stderr));
    if (failed && !result.timedOut) {
        const error = new Error(`Probe container failed to start (exit ${result.exitCode}): ${result.stderr.trim().slice(0, 500)}`);
        error.code = "PROBE_CONTAINER_INFRA";
        error.boundary = PROBE_FAILURE_BOUNDARY;
        error.detail = { command, exitCode: result.exitCode };
        throw error;
    }
}

export async function runProbeContainerCommand({
    sourceRoot,
    command,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    image = PROBE_CONTAINER_IMAGE,
    env = {},
    abortSignal,
}) {
    if (abortSignal?.aborted) {
        const error = new Error("Probe container command aborted.");
        error.code = "PROBE_ABORTED";
        error.boundary = PROBE_FAILURE_BOUNDARY;
        error.detail = { command, durationMs: 0, containerRemoved: true };
        throw error;
    }
    const containerName = `promptfoo-probe-${randomUUID().slice(0, 12)}`;
    const args = [
        "run",
        "--name",
        containerName,
        ...buildProbeContainerArgs({ sourceRoot, image, command, env }).slice(1),
    ];
    const result = await runCommand("docker", args, {
        env: { PATH: process.env.PATH ?? "" },
        timeoutMs,
        abortSignal,
    });
    let containerRemoved = null;
    if ((result.timedOut || abortSignal?.aborted) && containerName) {
        const removed = await runCommand("docker", ["rm", "-f", containerName], {
            env: { PATH: process.env.PATH ?? "" },
            timeoutMs: 30_000,
        });
        containerRemoved = removed.exitCode === 0;
    }
    if (abortSignal?.aborted) {
        const error = new Error("Probe container command aborted.");
        error.code = "PROBE_ABORTED";
        error.boundary = PROBE_FAILURE_BOUNDARY;
        error.detail = { command, durationMs: result.durationMs, containerRemoved };
        throw error;
    }
    assertContainerStarted(result, command);
    return {
        ...result,
        command,
        image,
    };
}

const FRAME_BOOTSTRAP = `
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
const nonce = process.env.PROBE_NONCE;
const script = Buffer.from(process.env.PROBE_SCRIPT_B64, "base64").toString("utf8");
const repo = process.env.PROBE_REPO;
for (const key of ["PROBE_NONCE", "PROBE_SCRIPT_B64", "PROBE_BOOT_B64"]) delete process.env[key];
const emit = (frame) => fs.writeSync(1, "\\n" + nonce + JSON.stringify(frame) + "\\n");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "probe-"));
const file = path.join(dir, "check.mjs");
fs.writeFileSync(file, script);
globalThis.__probe = { repo, details: null };
let code = 0;
try {
    await import(pathToFileURL(file).href);
    emit({ ok: true, details: globalThis.__probe.details ?? null });
} catch (error) {
    code = 1;
    emit({ ok: false, error: String(error && error.message ? error.message : error).slice(0, 2000) });
}
process.exit(code);
`;

const FRAME_COMMAND = `node --input-type=module -e 'await import("data:text/javascript;base64,"+process.env.PROBE_BOOT_B64)'`;

function parseFrame(stdout, nonce) {
    const lines = stdout.split("\n");
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        if (!lines[index].startsWith(nonce)) continue;
        try {
            const frame = JSON.parse(lines[index].slice(nonce.length));
            if (frame && typeof frame.ok === "boolean") return frame;
        } catch {
            return null;
        }
    }
    return null;
}

// Candidate code runs inside the script's process, so only a nonce-framed line is trusted.
// Anything else on stdout (noise, process.exit at import, crashes) means the check failed.
async function runFramedCheck({ sourceRoot, script, timeoutMs, image, abortSignal }) {
    const nonce = crypto.randomBytes(16).toString("hex");
    const result = await runProbeContainerCommand({
        sourceRoot,
        command: FRAME_COMMAND,
        timeoutMs,
        image,
        abortSignal,
        env: {
            PROBE_BOOT_B64: Buffer.from(FRAME_BOOTSTRAP).toString("base64"),
            PROBE_SCRIPT_B64: Buffer.from(script).toString("base64"),
            PROBE_NONCE: nonce,
            PROBE_REPO: PROBE_CONTAINER_WORKDIR,
        },
    });
    const frame = result.timedOut ? null : parseFrame(result.stdout, nonce);
    return {
        ok: frame?.ok === true && result.exitCode === 0,
        details: frame?.ok === true ? frame.details : null,
        error: frame ? frame.error ?? null : result.timedOut ? "timed out" : "no result frame from check",
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        stderr: result.stderr,
        framed: Boolean(frame),
    };
}

async function loadOracleScript(check, oracleRoot) {
    const scriptPath = path.resolve(oracleRoot, check.script);
    let content;
    try {
        content = await readFile(scriptPath);
    } catch (error) {
        const failure = new Error(`Oracle script '${check.script}' is unreadable: ${error.message}`);
        failure.code = "PROBE_ORACLE_MISSING";
        failure.boundary = PROBE_FAILURE_BOUNDARY;
        throw failure;
    }
    if (check.sha256 && sha256(content) !== check.sha256) {
        const failure = new Error(`Oracle script '${check.script}' does not match its declared sha256.`);
        failure.code = "PROBE_ORACLE_HASH_MISMATCH";
        failure.boundary = PROBE_FAILURE_BOUNDARY;
        throw failure;
    }
    return content.toString("utf8");
}

export function oracleRootDirectory(override) {
    return override ?? MODULE_DIR;
}

async function collectRuntimeObservation({
    taskDefinition,
    sourceRoot,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    image = PROBE_CONTAINER_IMAGE,
    oracleRoot,
    abortSignal,
}) {
    const apiModule = taskDefinition.definition.api?.module ?? "./src/index.mjs";
    const exportsResult = await runFramedCheck({
        sourceRoot,
        script: `const m = await import(globalThis.__probe.repo + "/" + ${JSON.stringify(apiModule.replace(/^\.\//, ""))}); globalThis.__probe.details = Object.keys(m);`,
        timeoutMs,
        image,
        abortSignal,
    });
    const runtimeApiChecks = taskDefinition.definition.api?.runtimeChecks ?? [];
    const apiChecks = [];
    for (const check of runtimeApiChecks) {
        const checkResult = await runProbeContainerCommand({
            sourceRoot,
            command: `node --input-type=module -e ${JSON.stringify(check.script)}`,
            timeoutMs,
            image,
            abortSignal,
        });
        apiChecks.push({
            name: check.name,
            ok: checkResult.exitCode === 0,
            exitCode: checkResult.exitCode,
            stdout: checkResult.stdout,
            stderr: checkResult.stderr,
        });
    }

    const oracleBase = oracleRootDirectory(oracleRoot);
    for (const check of taskDefinition.definition.api?.oracleChecks ?? []) {
        const script = await loadOracleScript(check, oracleBase);
        const result = await runFramedCheck({ sourceRoot, script, timeoutMs, image, abortSignal });
        apiChecks.push({ name: check.name, ok: result.ok, error: result.error, exitCode: result.exitCode, framed: result.framed });
    }
    const cliChecks = [];
    for (const check of taskDefinition.definition.cli?.oracleChecks ?? []) {
        const script = await loadOracleScript(check, oracleBase);
        const result = await runFramedCheck({ sourceRoot, script, timeoutMs, image, abortSignal });
        cliChecks.push({ name: check.name, ok: result.ok, error: result.error, exitCode: result.exitCode, framed: result.framed });
    }

    const cliResult = await runProbeContainerCommand({
        sourceRoot,
        command: taskDefinition.definition.cli?.command ?? "node --version",
        timeoutMs,
        image,
        abortSignal,
    });
    const allTouchedBeforePreservation = await runProbeContainerCommand({
        sourceRoot,
        command: "git config --global --add safe.directory /work/repo >/dev/null 2>&1; { git diff --name-only; git ls-files --others --exclude-standard; } | sort -u",
        timeoutMs,
        image,
    });
    const touchedBeforePreservation = allTouchedBeforePreservation.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    const protectedPatterns = taskDefinition.definition.preservation?.protectedPaths ?? DEFAULT_PRESERVATION_PROTECTED_PATHS;
    const preservationTamperedPaths = touchedBeforePreservation.filter((rawPath) => {
        const normalized = normalizeRelativePath(rawPath);
        return normalized ? pathMatchesAllowlist(normalized, protectedPatterns) : false;
    });
    const restoreProtectedPaths = "git config --global --add safe.directory /work/repo >/dev/null 2>&1; git checkout -- test test/fixtures >/dev/null 2>&1 || true";
    await runProbeContainerCommand({
        sourceRoot,
        command: restoreProtectedPaths,
        timeoutMs,
        image,
        abortSignal,
    });
    const preservationResult = taskDefinition.definition.preservation?.command
        ? await runProbeContainerCommand({
            sourceRoot,
            command: taskDefinition.definition.preservation.command,
            timeoutMs,
            image,
            abortSignal,
        })
        : { exitCode: 0, stdout: "", stderr: "", timedOut: false, durationMs: 0 };

    const changed = await runProbeContainerCommand({
        sourceRoot,
        command: "git config --global --add safe.directory /work/repo >/dev/null 2>&1; { git diff --name-only; git ls-files --others --exclude-standard; } | sort -u",
        timeoutMs,
        image,
        abortSignal,
    });
    const wrote = await runProbeContainerCommand({
        sourceRoot,
        command: "git config --global --add safe.directory /work/repo >/dev/null 2>&1; { git diff --name-only --diff-filter=ACMRT; git ls-files --others --exclude-standard; } | sort -u",
        timeoutMs,
        image,
        abortSignal,
    });

    const exportedValues = Array.isArray(exportsResult.details) ? exportsResult.details : [];

    return {
        expectedOwner: "host",
        preservationPass: preservationResult.exitCode === 0,
        api: {
            exports: exportedValues,
            checks: apiChecks.map((check) => ({ name: check.name, ok: check.ok })),
        },
        cli: {
            exitCode: cliResult.exitCode,
            stdout: cliResult.stdout,
            stderr: cliResult.stderr,
            checks: cliChecks.map((check) => ({ name: check.name, ok: check.ok })),
        },
        filesystem: {
            touchedPaths: changed.stdout.split("\n").map((line) => line.trim()).filter(Boolean),
            wrotePaths: wrote.stdout.split("\n").map((line) => line.trim()).filter(Boolean),
            preservationTamperedPaths,
        },
        receipts: {
            exportsResult,
            apiChecks,
            cliChecks,
            cliResult,
            preservationResult,
            allTouchedBeforePreservation,
            changed,
            wrote,
            containerImage: image,
        },
    };
}

export function runTaskProbe({ taskDefinition, observation, expectedOwner }) {
    const failures = [];
    if (expectedOwner !== "host") {
        pushFailure(failures, "EXPECTATION_NOT_HOST_OWNED", "Expected values must be host-owned.");
    }

    if (observation.expectedOwner !== "host") {
        pushFailure(failures, "OBSERVED_EXPECTATION_NOT_HOST_OWNED", "Observed expectation owner is not host-owned.");
    }

    checkApiContract({ definition: taskDefinition.definition, observation, failures });
    checkCliContract({ definition: taskDefinition.definition, observation, failures });
    checkFilesystemContract({ definition: taskDefinition.definition, taskDefinition, observation, failures });

    const taskContractPass = failures.length === 0;
    const preservationPass = observation.preservationPass === true;
    const pass = taskContractPass && preservationPass;

    const observedDigest = `sha256:${sha256(stableStringify({
        api: observation.api ?? null,
        cli: observation.cli ?? null,
        filesystem: observation.filesystem ?? null,
        preservationPass
    }))}`;
    const expectedDigest = `sha256:${sha256(stableStringify(taskDefinition.definition))}`;

    return {
        pass,
        taskContractPass,
        preservationPass,
        failures,
        receipt: {
            probeContractVersion: PROBE_CONTRACT_VERSION,
            task: `${taskDefinition.id}@${taskDefinition.version}`,
            observedDigest,
            expectedDigest,
            candidateTreeHash: observation?.receipts?.candidateTreeHash ?? null,
            verifierModuleHash: observation?.receipts?.verifierModuleHash ?? null,
        }
    };
}

export async function runTaskProbeInContainer({
    taskDefinition,
    sourceRoot,
    expectedOwner = "host",
    sourcePinCommit = "HEAD",
    timeoutMs = DEFAULT_TIMEOUT_MS,
    image = PROBE_CONTAINER_IMAGE,
    oracleRoot,
    abortSignal,
}) {
    const materialized = await materializeIndependentProbeSource({
        sourceRoot,
        taskDefinition,
        sourcePinCommit,
        timeoutMs,
    });
    try {
        const observation = await collectRuntimeObservation({
            taskDefinition,
            sourceRoot: materialized.isolatedSourceRoot,
            timeoutMs,
            image,
            oracleRoot,
            abortSignal,
        });
        observation.filesystem.preservationTamperedPaths = [
            ...(observation.filesystem.preservationTamperedPaths ?? []),
            ...materialized.tamperedPaths,
        ];
        observation.filesystem.additiveTestPaths = materialized.additivePaths;
        const hostOwnedChangedPaths = [...new Set([
            ...materialized.appliedPaths,
            ...materialized.blockedPaths,
        ])].sort();
        observation.filesystem.touchedPaths = hostOwnedChangedPaths;
        observation.filesystem.wrotePaths = hostOwnedChangedPaths;
        observation.filesystem.materializedAppliedPaths = materialized.appliedPaths;
        observation.filesystem.materializedBlockedPaths = materialized.blockedPaths;
        observation.filesystem.implementationPatterns = materialized.implementationPatterns;
        observation.receipts.independentSourceRoot = materialized.isolatedSourceRoot;
        observation.receipts.candidateTreeHash = `sha256:${sha256(stableStringify(Object.fromEntries((await snapshotFileTree(materialized.isolatedSourceRoot)).entries())))}`;
        observation.receipts.verifierModuleHash = PROBE_MODULE_HASH;

        const evaluation = runTaskProbe({
            taskDefinition,
            observation,
            expectedOwner,
        });
        return {
            ...evaluation,
            runtimeObservation: observation,
        };
    } finally {
        await rm(materialized.tempRoot, { recursive: true, force: true });
    }
}

export function normalizeTaskPath(taskPath) {
    const normalized = normalizeRelativePath(taskPath);
    if (!normalized) {
        return null;
    }
    return path.posix.normalize(normalized);
}
