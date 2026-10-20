import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import {
    RESULT_KIND,
    RUNTIME_ARMS,
    SUITE_IDS,
    createCodingOutcome,
    createLaunchReceipt,
    createRuntimeBudget,
    createRuntimeInfraError,
    isCodingOutcome,
    isRuntimeInfraError,
} from "../runtime/contracts.mjs";

test("runtime budgets enforce smoke and hard caps with wrapper overhead", () => {
    const smoke = createRuntimeBudget({ suiteId: SUITE_IDS.SMOKE, teardownGraceSeconds: 45 });
    assert.equal(smoke.taskSeconds, 900);
    assert.equal(smoke.wrapperSeconds, 945);
    assert.equal(smoke.descendantInclusiveConfigured, true);
    assert.equal(smoke.descendantInclusiveProven, false);
    assert.equal(smoke.retriesAllowed, false);

    const hard = createRuntimeBudget({ suiteId: SUITE_IDS.HARD, teardownGraceSeconds: 45 });
    assert.equal(hard.taskSeconds, 2700);
    assert.equal(hard.wrapperSeconds, 2745);
});

test("runtime infra result and coding outcome are explicitly discriminated", () => {
    const infra = createRuntimeInfraError({
        code: "missing-auth",
        message: "Missing token.",
        blockerEvidence: {
            missingPrerequisites: ["COPILOT_GITHUB_TOKEN"],
            capabilityChecks: [{ id: "probe", status: "blocked", reason: "missing_credential" }],
            evidence: ["Token was empty."],
        },
    });
    assert.equal(infra.kind, RESULT_KIND.INFRA_ERROR);
    assert.equal(isRuntimeInfraError(infra), true);
    assert.equal(isCodingOutcome(infra), false);
    assert.equal(infra.codingOutcome, null);

    const coding = createCodingOutcome({
        status: "failed",
        message: "Command failed.",
        receipt: null,
        metrics: { durationMs: 1, exitCode: 1, signal: null },
    });
    assert.equal(coding.kind, RESULT_KIND.CODING_OUTCOME);
    assert.equal(isCodingOutcome(coding), true);
    assert.equal(isRuntimeInfraError(coding), false);
    assert.equal(coding.infraError, null);
});

test("launch receipt captures host-owned evidence paths and arm isolation fields", () => {
    const receipt = createLaunchReceipt({
        arm: RUNTIME_ARMS.MINIME,
        suiteId: SUITE_IDS.SMOKE,
        taskId: "AHM-H1",
        sessionId: "session-1",
        budgets: { taskSeconds: 900, wrapperSeconds: 930 },
        paths: {
            workspaceRoot: resolve("/tmp/runtime/work"),
            sourceRoot: resolve("/tmp/runtime/work/repo"),
            runtimeRoot: resolve("/tmp/runtime/work/runtime"),
            home: resolve("/tmp/runtime/work/home"),
            copilotHome: resolve("/tmp/runtime/work/copilot-home"),
            cacheRoot: resolve("/tmp/runtime/work/cache"),
            hqRoot: resolve("/tmp/runtime/work/hq"),
        },
        evidence: {
            launchReceiptPath: resolve("/tmp/runtime/work/receipts/launch.json"),
            usageReceiptPath: resolve("/tmp/runtime/work/receipts/usage.json"),
            teardownReceiptPath: resolve("/tmp/runtime/work/receipts/teardown.json"),
        },
        lineage: { suiteId: "smoke", repeatIndex: 0, inputSnapshotId: null, outputSnapshotId: null },
        status: "prepared",
    });

    assert.equal(receipt.evidence.authority, "host");
    assert.equal(receipt.evidence.transcriptsAuthoritative, false);
    assert.equal(receipt.arm, RUNTIME_ARMS.MINIME);
    assert.match(receipt.paths.hqRoot, /\/tmp\/runtime\/work\/hq$/);
});
