import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { RUNTIME_ARMS, SUITE_IDS, isCodingOutcome } from "../runtime/contracts.mjs";
import { createTaskRuntimeContext, runManagedRuntimeCommand } from "../runtime/launch.mjs";
import { processExists, terminateProcessTree } from "../runtime/teardown.mjs";

async function createTempRoot(label) {
    return mkdtemp(resolve(tmpdir(), `promptfoo-${label}-${randomUUID()}-`));
}

test("runManagedRuntimeCommand enforces timeout and terminates descendant process tree", async (t) => {
    const root = await createTempRoot("runtime-timeout");
    t.after(() => rm(root, { recursive: true, force: true }));

    const scriptPath = resolve(root, "spawn-descendant.mjs");
    const childPidPath = resolve(root, "child.pid");
    await writeFile(
        scriptPath,
        `import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
writeFileSync(process.argv[2], String(child.pid));
setInterval(() => {}, 1000);
`,
        "utf8",
    );

    const context = await createTaskRuntimeContext({
        runtimeRoot: root,
        suiteId: SUITE_IDS.SMOKE,
        repeatIndex: 0,
        taskId: "timeout-kill",
        arm: RUNTIME_ARMS.DEFAULT,
    });

    const result = await runManagedRuntimeCommand({
        command: process.execPath,
        args: [scriptPath, childPidPath],
        cwd: root,
        env: process.env,
        context,
        suiteId: SUITE_IDS.SMOKE,
        arm: RUNTIME_ARMS.DEFAULT,
        taskId: "timeout-kill",
        taskTimeoutMs: 300,
        wrapperTimeoutMs: 700,
        teardownGraceMs: 120,
    });

    assert.equal(isCodingOutcome(result), true);
    assert.equal(result.status, "timeout");
    await access(result.receipt.evidence.launchReceiptPath);
    await access(result.receipt.evidence.usageReceiptPath);
    await access(result.receipt.evidence.teardownReceiptPath);

    const childPid = Number((await readFile(childPidPath, "utf8")).trim());
    assert.equal(Number.isInteger(childPid), true);
    assert.equal(processExists(childPid), false);
});

test("abort signal cancellation stops running process and reports cancelled", async (t) => {
    const root = await createTempRoot("runtime-cancel");
    t.after(() => rm(root, { recursive: true, force: true }));

    const scriptPath = resolve(root, "wait-forever.mjs");
    await writeFile(scriptPath, "setInterval(() => {}, 1000);\n", "utf8");

    const context = await createTaskRuntimeContext({
        runtimeRoot: root,
        suiteId: SUITE_IDS.SMOKE,
        repeatIndex: 0,
        taskId: "cancel-kill",
        arm: RUNTIME_ARMS.DEFAULT,
    });
    const abortController = new AbortController();
    setTimeout(() => abortController.abort(), 80);

    const result = await runManagedRuntimeCommand({
        command: process.execPath,
        args: [scriptPath],
        cwd: root,
        env: process.env,
        context,
        suiteId: SUITE_IDS.SMOKE,
        arm: RUNTIME_ARMS.DEFAULT,
        taskId: "cancel-kill",
        abortSignal: abortController.signal,
        taskTimeoutMs: 1000,
        wrapperTimeoutMs: 1500,
        teardownGraceMs: 120,
    });

    assert.equal(isCodingOutcome(result), true);
    assert.equal(result.status, "cancelled");
});

test("terminateProcessTree handles invalid pid without throwing", async () => {
    const result = await terminateProcessTree(0);
    assert.equal(result.requested, false);
    assert.equal(result.stillRunning, false);
});
