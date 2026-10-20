import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import { RUNTIME_ARMS, SUITE_IDS, isRuntimeInfraError } from "../runtime/contracts.mjs";
import {
    buildDockerRunPlan,
    buildRuntimeArmSpecs,
    createTaskRuntimeContext,
    ensureLocalRuntimeReady,
    materializePayloadFromCommit,
    runManagedRuntimeCommand,
    runMinimeCompatibilityProbe,
} from "../runtime/launch.mjs";

async function createTempRoot(label) {
    return mkdtemp(resolve(tmpdir(), `promptfoo-${label}-${randomUUID()}-`));
}

function createSpawnMock(routes) {
    return (_command, args) => {
        const child = new EventEmitter();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.unref = () => {};
        process.nextTick(() => {
            const signature = args.join(" ");
            const route = routes.find((entry) => signature.includes(entry.match));
            if (!route) {
                child.stderr.write(`unmatched mock route: ${signature}`);
                child.stderr.end();
                child.stdout.end();
                child.emit("close", 1, null);
                return;
            }
            if (route.stdout) child.stdout.write(route.stdout);
            if (route.stderr) child.stderr.write(route.stderr);
            child.stdout.end();
            child.stderr.end();
            child.emit("close", route.code ?? 0, null);
        });
        return child;
    };
}

function run(command, args, { cwd } = {}) {
    return new Promise((resolveResult, reject) => {
        const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
        child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
        child.on("error", reject);
        child.on("close", (exitCode) => resolveResult({ exitCode, stdout, stderr }));
    });
}

test("runtime arm specs share pinned base and keep DEFAULT payload free", () => {
    const specs = buildRuntimeArmSpecs();
    assert.equal(specs.base.pinnedBase, true);
    assert.equal(specs[RUNTIME_ARMS.DEFAULT].pluginEnabled, false);
    assert.equal(specs[RUNTIME_ARMS.DEFAULT].hqEnabled, false);
    assert.equal(specs[RUNTIME_ARMS.MINIME].pluginEnabled, true);
    assert.equal(specs[RUNTIME_ARMS.MINIME].hqEnabled, true);

    const defaultArgs = specs[RUNTIME_ARMS.DEFAULT].copilotArgs("session-1").join(" ");
    assert.equal(defaultArgs.includes("--agent"), false);
    assert.equal(defaultArgs.includes("--plugin-dir"), false);
    assert.equal(defaultArgs.includes("--add-dir"), false);

    const minimeArgs = specs[RUNTIME_ARMS.MINIME].copilotArgs("session-2").join(" ");
    assert.equal(minimeArgs.includes("--agent minime:dr-evil"), true);
    assert.equal(minimeArgs.includes("--plugin-dir /opt/minime"), true);
    assert.equal(minimeArgs.includes("--add-dir /opt/minime"), true);
    assert.equal(minimeArgs.includes("--add-dir /work/hq"), true);
});

test("task runtime contexts are fresh per task and enforce MINIME lineage scope", async (t) => {
    const root = await createTempRoot("runtime-context");
    t.after(() => rm(root, { recursive: true, force: true }));

    const first = await createTaskRuntimeContext({
        runtimeRoot: root,
        suiteId: SUITE_IDS.HARD,
        repeatIndex: 1,
        taskId: "AHM-H1",
        arm: RUNTIME_ARMS.MINIME,
    });

    const second = await createTaskRuntimeContext({
        runtimeRoot: root,
        suiteId: SUITE_IDS.HARD,
        repeatIndex: 1,
        taskId: "AHM-H2",
        arm: RUNTIME_ARMS.MINIME,
        previousMinimeLineage: {
            suiteId: SUITE_IDS.HARD,
            repeatIndex: 1,
            inputSnapshotId: null,
            outputSnapshotId: "snapshot-1",
        },
    });

    assert.notEqual(first.sessionId, second.sessionId);
    assert.notEqual(first.paths.workspaceRoot, second.paths.workspaceRoot);
    assert.notEqual(first.paths.home, second.paths.home);
    assert.notEqual(first.paths.copilotHome, second.paths.copilotHome);
    assert.equal(second.lineage.inputSnapshotId, "snapshot-1");

    await assert.rejects(() => createTaskRuntimeContext({
        runtimeRoot: root,
        suiteId: SUITE_IDS.HARD,
        repeatIndex: 2,
        taskId: "AHM-H3",
        arm: RUNTIME_ARMS.MINIME,
        previousMinimeLineage: {
            suiteId: SUITE_IDS.HARD,
            repeatIndex: 1,
            outputSnapshotId: "snapshot-2",
        },
    }), /same suite and repeat/i);
});

test("docker run plan mounts MINIME HQ only for MINIME arm", async (t) => {
    const root = await createTempRoot("runtime-docker-plan");
    t.after(() => rm(root, { recursive: true, force: true }));

    const minime = await createTaskRuntimeContext({
        runtimeRoot: root,
        suiteId: SUITE_IDS.SMOKE,
        repeatIndex: 0,
        taskId: "parser-1",
        arm: RUNTIME_ARMS.MINIME,
    });
    const minimePlan = buildDockerRunPlan({ arm: RUNTIME_ARMS.MINIME, context: minime, prompt: "task prompt" });
    assert.equal(minimePlan.command, "docker");
    assert.equal(minimePlan.args.join(" ").includes("dst=/work/hq"), true);

    const fallback = await createTaskRuntimeContext({
        runtimeRoot: root,
        suiteId: SUITE_IDS.SMOKE,
        repeatIndex: 0,
        taskId: "parser-1",
        arm: RUNTIME_ARMS.DEFAULT,
    });
    const defaultPlan = buildDockerRunPlan({ arm: RUNTIME_ARMS.DEFAULT, context: fallback, prompt: "task prompt" });
    assert.equal(defaultPlan.args.join(" ").includes("dst=/work/hq"), false);
});

test("compatibility probe returns exact blockers when auth or capability is missing", async () => {
    const missingAuth = await runMinimeCompatibilityProbe({
        token: "",
        capabilityProbe: async () => ({ ok: true }),
    });
    assert.equal(isRuntimeInfraError(missingAuth), true);
    assert.deepEqual(missingAuth.blockerEvidence.missingPrerequisites, ["COPILOT_GITHUB_TOKEN"]);

    const blocked = await runMinimeCompatibilityProbe({
        token: "token",
        capabilityProbe: async () => ({
            ok: false,
            message: "Native events unavailable.",
            missingPrerequisites: ["minime-native-events"],
            capabilityChecks: [{ id: "events", status: "failed", reason: "missing_runtime_support" }],
            evidence: ["No native event stream observed."],
        }),
    });
    assert.equal(isRuntimeInfraError(blocked), true);
    assert.deepEqual(blocked.blockerEvidence.missingPrerequisites, ["minime-native-events"]);
});

test("successful MINIME execution records repeat-scoped output snapshot lineage", async (t) => {
    const root = await createTempRoot("runtime-lineage");
    t.after(() => rm(root, { recursive: true, force: true }));

    const context = await createTaskRuntimeContext({
        runtimeRoot: root,
        suiteId: SUITE_IDS.HARD,
        repeatIndex: 2,
        taskId: "AHM-H1",
        arm: RUNTIME_ARMS.MINIME,
    });

    test("runtime command auth failures are classified as infrastructure errors", async (t) => {
        const root = await createTempRoot("runtime-infra-classify");
        t.after(() => rm(root, { recursive: true, force: true }));

        const context = await createTaskRuntimeContext({
            runtimeRoot: root,
            suiteId: SUITE_IDS.SMOKE,
            repeatIndex: 0,
            taskId: "AHM-P1",
            arm: RUNTIME_ARMS.DEFAULT,
        });

        const spawnMock = createSpawnMock([
            { match: "No authentication information found", code: 1, stderr: "Error: No authentication information found." },
        ]);

        const result = await runManagedRuntimeCommand({
            command: "docker",
            args: ["No authentication information found"],
            cwd: root,
            env: process.env,
            context,
            suiteId: SUITE_IDS.SMOKE,
            arm: RUNTIME_ARMS.DEFAULT,
            taskId: "AHM-P1",
            spawnImpl: spawnMock,
        });

        assert.equal(isRuntimeInfraError(result), true);
        assert.equal(result.code, "runtime-auth-missing");
    });

    const result = await runManagedRuntimeCommand({
        command: process.execPath,
        args: ["-e", "process.exit(0)"],
        cwd: root,
        env: process.env,
        context,
        suiteId: SUITE_IDS.HARD,
        arm: RUNTIME_ARMS.MINIME,
        taskId: "AHM-H1",
        taskTimeoutMs: 1000,
        wrapperTimeoutMs: 1500,
    });

    assert.equal(result.status, "completed");
    assert.equal(result.receipt.lineage.outputSnapshotId, null);
    assert.equal(result.receipt.lineage.repeatIndex, 2);
});

test("local runtime readiness builds local images and probes launchability", async (t) => {
    const root = await createTempRoot("runtime-ready");
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(resolve(root, ".claude-plugin"), { recursive: true });
    await writeFile(resolve(root, ".claude-plugin", "plugin.json"), "{\"name\":\"minime\"}\n", "utf8");
    await mkdir(resolve(root, ".github", "extensions"), { recursive: true });
    await writeFile(resolve(root, ".github", "extensions", "manifest.json"), "{}\n", "utf8");
    await mkdir(resolve(root, "agents"), { recursive: true });
    await writeFile(resolve(root, "agents", "dr-evil.md"), "---\nname: dr-evil\n---\n", "utf8");
    await mkdir(resolve(root, "assets"), { recursive: true });
    await writeFile(resolve(root, "assets", "ORCHESTRATION.md"), "# orchestration\n", "utf8");
    await mkdir(resolve(root, "skills"), { recursive: true });
    await writeFile(resolve(root, "skills", "README.md"), "# skills\n", "utf8");
    await mkdir(resolve(root, "hooks"), { recursive: true });
    await writeFile(resolve(root, "hooks", "session-start.js"), "export {};\n", "utf8");
    const promptfooRoot = resolve(root, "evals", "promptfoo");
    await mkdir(resolve(promptfooRoot, "runtime"), { recursive: true });
    await writeFile(resolve(promptfooRoot, "runtime", "Dockerfile"), "FROM scratch\n", "utf8");

    const spawnMock = createSpawnMock([
        { match: "cat-file -e 8fdc75eb7ee1c7eb5eb12240fa38fcb1e1234136^", code: 0, stdout: "" },
        { match: "archive --format=tar", code: 0 },
        { match: " -xf ", code: 0 },
        { match: "ls-tree -r --name-only", code: 0, stdout: ".claude-plugin/plugin.json\n.github/extensions/manifest.json\nagents/dr-evil.md\nassets/ORCHESTRATION.md\nskills/README.md\nhooks/session-start.js\n" },
        { match: "image inspect minime-eval-runtime-default:1.0.99-3", code: 1 },
        { match: "image inspect minime-eval-runtime-minime:1.0.99-3", code: 1 },
        { match: "--target runtime-default", code: 0 },
        { match: "--target runtime-minime", code: 0 },
        { match: "copilot --help", code: 0, stdout: "--max-ai-credits --usage-output-file" },
        { match: "test ! -f /opt/minime/.claude-plugin/plugin.json && test ! -f /opt/minime/hooks/session-start.js", code: 0 },
        { match: "test -f /opt/minime/.claude-plugin/plugin.json && test -f /opt/minime/.payload-sha && test -f /opt/minime/agents/dr-evil.md && test -f /opt/minime/hooks/session-start.js", code: 0 },
    ]);

    const result = await ensureLocalRuntimeReady({
        projectRoot: root,
        cwd: promptfooRoot,
        spawnImpl: spawnMock,
        forceRebuild: false,
        allowWorkingTreePayloadFallback: true,
    });
    assert.equal(isRuntimeInfraError(result), false);
    assert.equal(result.ok, true);
    assert.equal(result.images.defaultImage, "minime-eval-runtime-default:1.0.99-3");
    assert.equal(result.images.minimeImage.startsWith("minime-eval-runtime-minime:1.0.99-3-"), true);
});

test("payload materialization preserves user index with staged and unstaged changes", async (t) => {
    const root = await createTempRoot("payload-index-preserve");
    t.after(() => rm(root, { recursive: true, force: true }));

    const mkPayload = async (relativePath, content) => {
        const fullPath = resolve(root, relativePath);
        await mkdir(resolve(fullPath, ".."), { recursive: true });
        await writeFile(fullPath, content, "utf8");
    };

    await mkPayload(".claude-plugin/plugin.json", "{\"name\":\"minime\"}\n");
    await mkPayload(".github/extensions/manifest.json", "{}\n");
    await mkPayload("agents/dr-evil.md", "---\nname: dr-evil\n---\n");
    await mkPayload("assets/ORCHESTRATION.md", "# orchestration\n");
    await mkPayload("skills/README.md", "# skills\n");
    await mkPayload("hooks/session-start.js", "export {};\n");
    await mkPayload("README.md", "base\n");

    await run("git", ["init"], { cwd: root });
    await run("git", ["config", "user.email", "probe@example.com"], { cwd: root });
    await run("git", ["config", "user.name", "probe"], { cwd: root });
    await run("git", ["add", "."], { cwd: root });
    await run("git", ["commit", "-m", "baseline"], { cwd: root });

    await writeFile(resolve(root, "README.md"), "staged-change\n", "utf8");
    await run("git", ["add", "README.md"], { cwd: root });
    await writeFile(resolve(root, "hooks/session-start.js"), "export const x = 1;\n", "utf8");

    const indexBefore = await readFile(resolve(root, ".git", "index"));
    const statusBefore = await run("git", ["status", "--porcelain"], { cwd: root });
    const head = (await run("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
    const stagingPayloadRoot = await createTempRoot("payload-staging");
    t.after(() => rm(stagingPayloadRoot, { recursive: true, force: true }));

    const tracked = await materializePayloadFromCommit({
        projectRoot: root,
        commit: head,
        stagingPayloadRoot,
    });

    const indexAfter = await readFile(resolve(root, ".git", "index"));
    const statusAfter = await run("git", ["status", "--porcelain"], { cwd: root });
    assert.equal(indexAfter.equals(indexBefore), true);
    assert.equal(statusAfter.stdout, statusBefore.stdout);
    assert.equal(tracked.length > 0, true);
});
