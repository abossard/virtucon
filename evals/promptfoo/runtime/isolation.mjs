import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { RUNTIME_ARMS, assertArm, assertSuiteId } from "./contracts.mjs";

function slug(input) {
    return String(input)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

export function createLineageBase({ suiteId, repeatIndex }) {
    assertSuiteId(suiteId);
    return {
        suiteId,
        repeatIndex: Number(repeatIndex),
        inputSnapshotId: null,
        outputSnapshotId: null,
        lastCompletedSnapshotId: null,
    };
}

export function nextMinimeLineage({
    suiteId,
    repeatIndex,
    previousLineage = null,
    outputSnapshotId,
}) {
    assertSuiteId(suiteId);
    if (previousLineage && (previousLineage.suiteId !== suiteId || Number(previousLineage.repeatIndex) !== Number(repeatIndex))) {
        throw new Error("MINIME lineage import is restricted to the same suite and repeat.");
    }
    const inputSnapshotId = previousLineage?.outputSnapshotId ?? previousLineage?.lastCompletedSnapshotId ?? null;
    return {
        suiteId,
        repeatIndex: Number(repeatIndex),
        inputSnapshotId,
        outputSnapshotId: outputSnapshotId ?? null,
        lastCompletedSnapshotId: outputSnapshotId ?? inputSnapshotId,
    };
}

export async function createTaskIsolationContext({
    runtimeRoot,
    suiteId,
    repeatIndex,
    taskId,
    arm,
    now = new Date(),
    sessionId = randomUUID(),
}) {
    assertSuiteId(suiteId);
    assertArm(arm);
    const runId = [
        slug(suiteId),
        `repeat-${Number(repeatIndex)}`,
        slug(taskId),
        arm.toLowerCase(),
        now.toISOString().replaceAll(":", "").replaceAll(".", ""),
        randomUUID().slice(0, 8),
    ].join("-");

    const workspaceRoot = resolve(runtimeRoot, "tasks", runId);
    const sourceRoot = resolve(workspaceRoot, "repo");
    const runtimeStateRoot = resolve(workspaceRoot, "runtime");
    const home = resolve(workspaceRoot, "home");
    const copilotHome = resolve(workspaceRoot, "copilot-home");
    const cacheRoot = resolve(workspaceRoot, "cache");
    const scratchRoot = resolve(workspaceRoot, "scratch");
    const receiptsRoot = resolve(workspaceRoot, "receipts");
    const hqRoot = arm === RUNTIME_ARMS.MINIME ? resolve(workspaceRoot, "hq") : null;

    const roots = [
        workspaceRoot,
        sourceRoot,
        runtimeStateRoot,
        home,
        copilotHome,
        cacheRoot,
        scratchRoot,
        receiptsRoot,
        hqRoot,
    ].filter(Boolean);

    await Promise.all(roots.map((path) => mkdir(path, { recursive: true })));

    return {
        arm,
        suiteId,
        repeatIndex: Number(repeatIndex),
        taskId,
        runId,
        sessionId,
        paths: {
            workspaceRoot,
            sourceRoot,
            runtimeRoot: runtimeStateRoot,
            home,
            copilotHome,
            cacheRoot,
            scratchRoot,
            receiptsRoot,
            hqRoot,
        },
    };
}

