import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { RUNTIME_ARMS, SUITE_IDS, isRuntimeInfraError } from "../runtime/contracts.mjs";
import { nextMinimeLineage } from "../runtime/isolation.mjs";
import {
    createTaskRuntimeContext,
    runManagedRuntimeCommand,
    runMinimeCompatibilityProbe,
} from "../runtime/launch.mjs";

const PHASES = ["blueprint", "replicate", "inspect", "extract"];

async function tempRoot(label) {
    return mkdtemp(resolve(tmpdir(), `promptfoo-${label}-${randomUUID()}-`));
}

function taskEvents(phases, { complete = true } = {}) {
    return phases.flatMap((phase, index) => {
        const toolCallId = `call-${phase}-${index}`;
        const args = phase === "inspect"
            ? { name: "inspect", agent_type: "minime:frau" }
            : { name: phase, agent_type: "general-purpose" };
        const events = [{ type: "tool.execution_start", data: { toolName: "task", toolCallId, arguments: args } }];
        if (complete) {
            events.push({
                type: "tool.execution_complete",
                data: { toolCallId, success: true, result: { agent_id: `agent-${phase}`, status: "completed" } },
            });
        }
        return events;
    });
}

function script({ events = [], hqFiles = {}, exitCode = 0, hqRoot }) {
    return `
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
for (const [name, body] of Object.entries(${JSON.stringify(hqFiles)})) {
    const path = resolve(${JSON.stringify(hqRoot ?? "/nonexistent")}, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
}
for (const event of ${JSON.stringify(events)}) console.log(JSON.stringify(event));
process.exit(${exitCode});
`;
}

async function runMinime(root, { taskId, previous = null, ...options }) {
    const context = await createTaskRuntimeContext({
        runtimeRoot: root,
        suiteId: SUITE_IDS.SMOKE,
        repeatIndex: 0,
        taskId,
        arm: RUNTIME_ARMS.MINIME,
        previousMinimeLineage: previous,
    });
    const outcome = await runManagedRuntimeCommand({
        command: process.execPath,
        args: ["--input-type=module", "-e", script({ ...options, hqRoot: context.paths.hqRoot })],
        cwd: root,
        env: process.env,
        context,
        suiteId: SUITE_IDS.SMOKE,
        arm: RUNTIME_ARMS.MINIME,
        taskId,
        taskTimeoutMs: 5000,
        wrapperTimeoutMs: 6000,
    });
    return outcome;
}

for (const [label, events, complete] of [
    ["no native events", [], false],
    ["assistant text naming phases", [{ type: "assistant.message", data: { content: "blueprint replicate inspect extract" } }], false],
    ["skill loads only", PHASES.map((skill) => ({ type: "tool.execution_start", data: { toolName: "skill", toolCallId: skill, arguments: { skill } } })), false],
    ["dispatched but never completed", taskEvents(PHASES, { complete: false }), false],
    ["three of four phases", taskEvents(PHASES.slice(0, 3)), false],
    ["four completed native task dispatches", taskEvents(PHASES), true],
]) {
    test(`MINIME phase fidelity from native dispatch: ${label}`, async (t) => {
        const root = await tempRoot("fidelity");
        t.after(() => rm(root, { recursive: true, force: true }));
        const outcome = await runMinime(root, { taskId: "AHM-P1", events, hqFiles: { "note.md": "x" } });
        assert.equal(outcome.fidelity.complete, complete);
        assert.equal(outcome.fidelity.failure, complete ? null : "minime-phases-not-dispatched");
        assert.equal(outcome.snapshot.promoted, true);
        assert.equal(outcome.snapshot.quarantined, false);
        if (complete) {
            assert.equal(new Set(PHASES.map((phase) => outcome.fidelity.phaseWorkers[phase].workerId)).size, 4);
        }
    });
}

test("MINIME inspect completion accepts Frau agent type and content-shaped task result payload", async (t) => {
    const root = await tempRoot("inspect-content-shape");
    t.after(() => rm(root, { recursive: true, force: true }));
    const events = [
        {
            type: "tool.execution_start",
            data: { toolName: "task", toolCallId: "call-blueprint", arguments: { name: "blueprint", agent_type: "general-purpose" } },
        },
        {
            type: "tool.execution_complete",
            data: { toolCallId: "call-blueprint", success: true, result: { content: "status: completed" } },
        },
        {
            type: "tool.execution_start",
            data: { toolName: "task", toolCallId: "call-replicate", arguments: { name: "replicate", agent_type: "general-purpose" } },
        },
        {
            type: "tool.execution_complete",
            data: { toolCallId: "call-replicate", success: true, result: { content: "status: completed" } },
        },
        {
            type: "tool.execution_start",
            data: { toolName: "task", toolCallId: "call-frau", arguments: { name: "frau-inspect", agent_type: "minime:frau" } },
        },
        {
            type: "tool.execution_complete",
            data: { toolCallId: "call-frau", success: true, result: { detailedContent: "status: completed" } },
        },
        {
            type: "tool.execution_start",
            data: { toolName: "task", toolCallId: "call-extract", arguments: { name: "extract", agent_type: "general-purpose" } },
        },
        {
            type: "tool.execution_complete",
            data: { toolCallId: "call-extract", success: true, result: { content: "status: completed" } },
        },
    ];
    const outcome = await runMinime(root, { taskId: "AHM-P1", events, hqFiles: { "note.md": "x" } });
    assert.equal(outcome.fidelity.complete, true);
    assert.equal(outcome.fidelity.phaseWorkers.inspect.childId, "UNKNOWN");
});

test("MINIME does not promote HQ while native task workers are still running", async (t) => {
    const root = await tempRoot("running-workers");
    t.after(() => rm(root, { recursive: true, force: true }));
    const events = PHASES.flatMap((phase, index) => {
        const toolCallId = `call-${phase}-${index}`;
        return [
            { type: "tool.execution_start", data: { toolName: "task", toolCallId, arguments: { name: phase, agent_type: phase === "inspect" ? "minime:frau" : "general-purpose" } } },
            { type: "tool.execution_complete", data: { toolCallId, success: true, result: { agent_id: `agent-${index}`, status: "running" } } },
        ];
    });
    const outcome = await runMinime(root, { taskId: "AHM-P1", events, hqFiles: { "note.md": "x" } });
    assert.equal(outcome.snapshot.promoted, false);
    assert.equal(outcome.snapshot.quarantined, true);
    assert.equal(outcome.snapshot.quarantineReasons.includes("native-workers-running"), true);
});

test("DEFAULT arm fidelity is not applicable", async (t) => {
    const root = await tempRoot("fidelity-default");
    t.after(() => rm(root, { recursive: true, force: true }));
    const context = await createTaskRuntimeContext({
        runtimeRoot: root, suiteId: SUITE_IDS.SMOKE, repeatIndex: 0, taskId: "AHM-P1", arm: RUNTIME_ARMS.DEFAULT,
    });

    test("MINIME inspect phase requires Frau identity", async (t) => {
        const root = await tempRoot("inspect-frau");
        t.after(() => rm(root, { recursive: true, force: true }));
        const events = PHASES.flatMap((phase, index) => {
            const toolCallId = `call-${phase}-${index}`;
            const args = { name: phase, agent_type: "general-purpose" };
            return [
                { type: "tool.execution_start", data: { toolName: "task", toolCallId, arguments: args } },
                { type: "tool.execution_complete", data: { toolCallId, success: true, result: { agent_id: `agent-${phase}`, status: "completed" } } },
            ];
        });
        const outcome = await runMinime(root, { taskId: "AHM-P1", events, hqFiles: { "note.md": "x" } });
        assert.equal(outcome.fidelity.complete, false);
        assert.equal(outcome.fidelity.missing.includes("inspect"), true);
    });
    const outcome = await runManagedRuntimeCommand({
        command: process.execPath, args: ["-e", "0"], cwd: root, env: process.env, context,
        suiteId: SUITE_IDS.SMOKE, arm: RUNTIME_ARMS.DEFAULT, taskId: "AHM-P1", taskTimeoutMs: 5000, wrapperTimeoutMs: 6000,
    });
    assert.equal(outcome.fidelity.applicable, false);
    assert.equal(outcome.fidelity.failure, null);
});

test("failed task keeps last completed lineage and quarantines its HQ", async (t) => {
    const root = await tempRoot("lineage-carry");
    t.after(() => rm(root, { recursive: true, force: true }));
    const full = taskEvents(PHASES);

    const first = await runMinime(root, { taskId: "T1", events: full, hqFiles: { "a.md": "a" } });
    assert.equal(first.snapshot.promoted, true);

    const second = await runMinime(root, {
        taskId: "T2", previous: first.receipt.lineage, events: full, hqFiles: { "b.md": "b" }, exitCode: 1,
    });
    assert.equal(second.status, "failed");
    assert.equal(second.snapshot.promoted, false);
    assert.equal(second.snapshot.quarantined, true);
    assert.deepEqual(second.snapshot.quarantineReasons, ["task-failed"]);
    assert.equal(second.receipt.lineage.outputSnapshotId, null);
    assert.equal(second.receipt.lineage.lastCompletedSnapshotId, first.receipt.lineage.outputSnapshotId);
    assert.equal(second.receipt.lineage.inputSnapshotRestored, true);

    const third = await runMinime(root, { taskId: "T3", previous: second.receipt.lineage, events: full, hqFiles: { "c.md": "c" } });
    assert.equal(third.receipt.lineage.inputSnapshotId, first.receipt.lineage.outputSnapshotId);
    assert.equal(third.receipt.lineage.inputSnapshotRestored, true);
    assert.equal(third.receipt.snapshot.lastValidSnapshotId, third.receipt.lineage.outputSnapshotId);
});

test("incomplete HQ writes are quarantined even on exit 0", async (t) => {
    const root = await tempRoot("quarantine");
    t.after(() => rm(root, { recursive: true, force: true }));
    const outcome = await runMinime(root, {
        taskId: "T1", events: taskEvents(PHASES), hqFiles: { "ok.md": "ok", "wiki/page.md.tmp": "partial" },
    });
    assert.equal(outcome.snapshot.promoted, false);
    assert.deepEqual(outcome.snapshot.quarantineReasons, ["incomplete-writes"]);
    assert.deepEqual(outcome.snapshot.incompleteWrites, ["wiki/page.md.tmp"]);
    assert.equal(outcome.receipt.snapshot.quarantined, true);
});

test("corrupt snapshot is reported as missing, not silently empty", async (t) => {
    const root = await tempRoot("corrupt");
    t.after(() => rm(root, { recursive: true, force: true }));
    const first = await runMinime(root, { taskId: "T1", events: taskEvents(PHASES), hqFiles: { "a.md": "a" } });
    const snapshotFile = resolve(first.snapshot.snapshotPath, "a.md");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(snapshotFile, "tampered");
    const second = await runMinime(root, { taskId: "T2", previous: first.receipt.lineage, events: [] });
    assert.equal(isRuntimeInfraError(second), true);
    assert.equal(second.code, "runtime-required-snapshot-restore-failed");
});

test("nextMinimeLineage carries the last completed snapshot over a null output", () => {
    const base = { suiteId: SUITE_IDS.SMOKE, repeatIndex: 0 };
    const first = nextMinimeLineage({ ...base, outputSnapshotId: "s1" });
    const failed = nextMinimeLineage({ ...base, previousLineage: first, outputSnapshotId: null });
    assert.equal(failed.inputSnapshotId, "s1");
    assert.equal(failed.lastCompletedSnapshotId, "s1");
    assert.equal(nextMinimeLineage({ ...base, previousLineage: failed }).inputSnapshotId, "s1");
});

test("pre-aborted signal never spawns and reports cancelled", async (t) => {
    const root = await tempRoot("preabort");
    t.after(() => rm(root, { recursive: true, force: true }));
    const context = await createTaskRuntimeContext({
        runtimeRoot: root, suiteId: SUITE_IDS.SMOKE, repeatIndex: 0, taskId: "T", arm: RUNTIME_ARMS.DEFAULT,
    });
    const controller = new AbortController();
    controller.abort();
    let spawned = 0;
    const outcome = await runManagedRuntimeCommand({
        command: process.execPath, args: ["-e", "0"], cwd: root, env: process.env, context,
        suiteId: SUITE_IDS.SMOKE, arm: RUNTIME_ARMS.DEFAULT, taskId: "T", abortSignal: controller.signal,
        taskTimeoutMs: 1000, wrapperTimeoutMs: 1500,
        spawnImpl: (...args) => { spawned += 1; return spawn(...args); },
    });
    assert.equal(spawned, 0);
    assert.equal(outcome.status, "cancelled");
    const teardown = JSON.parse(await readFile(outcome.receipt.evidence.teardownReceiptPath, "utf8"));
    assert.equal(teardown.preAborted, true);
});

for (const trigger of ["timeout", "abort"]) {
    test(`${trigger} outcome is returned only after owned container removal completes`, async (t) => {
        const root = await tempRoot(`teardown-${trigger}`);
        t.after(() => rm(root, { recursive: true, force: true }));
        const context = await createTaskRuntimeContext({
            runtimeRoot: root, suiteId: SUITE_IDS.SMOKE, repeatIndex: 0, taskId: "T", arm: RUNTIME_ARMS.DEFAULT,
        });
        let removeFinished = false;
        const spawnImpl = (command, args, options) => {
            if (command !== "docker") return spawn(command, args, options);
            const remove = new EventEmitter();
            setTimeout(() => { removeFinished = true; remove.emit("close", 0); }, 250);
            return remove;
        };
        const controller = new AbortController();
        if (trigger === "abort") setTimeout(() => controller.abort(), 100);
        const outcome = await runManagedRuntimeCommand({
            command: process.execPath,
            args: ["-e", "setInterval(()=>{},1000)", "--", "--name", "owned-container"],
            cwd: root, env: process.env, context, suiteId: SUITE_IDS.SMOKE, arm: RUNTIME_ARMS.DEFAULT, taskId: "T",
            abortSignal: controller.signal,
            taskTimeoutMs: trigger === "timeout" ? 150 : 5000, wrapperTimeoutMs: 6000, teardownGraceMs: 100,
            spawnImpl,
        });
        assert.equal(removeFinished, true);
        assert.equal(outcome.status, trigger === "timeout" ? "timeout" : "cancelled");
        const teardown = JSON.parse(await readFile(outcome.receipt.evidence.teardownReceiptPath, "utf8"));
        assert.equal(teardown.teardownConfirmed.processStopped, true);
        assert.equal(teardown.teardownConfirmed.containerRemoved, true);
    });
}

test("compatibility probe honors abort before and during execution", async () => {
    const before = new AbortController();
    before.abort();
    let called = false;
    const pre = await runMinimeCompatibilityProbe({
        token: "t", abortSignal: before.signal, capabilityProbe: async () => { called = true; return { ok: true }; },
    });
    assert.equal(isRuntimeInfraError(pre), true);
    assert.equal(pre.code, "probe-cancelled");
    assert.equal(called, false);

    const during = new AbortController();
    const mid = await runMinimeCompatibilityProbe({
        token: "t", abortSignal: during.signal,
        capabilityProbe: async (signal) => { during.abort(); assert.equal(signal, during.signal); return { ok: true }; },
    });
    assert.equal(mid.code, "probe-cancelled");
});

test("native result usage is captured without claiming descendant completeness", async (t) => {
    const root = await tempRoot("usage");
    t.after(() => rm(root, { recursive: true, force: true }));
    const usage = { premiumRequests: 1, totalApiDurationMs: 5 };
    const outcome = await runMinime(root, { taskId: "T", events: [{ type: "result", exitCode: 0, usage }] });
    const receipt = JSON.parse(await readFile(outcome.receipt.evidence.usageReceiptPath, "utf8"));
    assert.equal(receipt.available, true);
    assert.deepEqual(receipt.nativeResult, usage);
    assert.equal(receipt.descendantInclusiveProven, false);

    const none = await runMinime(root, { taskId: "T2", events: [] });
    const unknown = JSON.parse(await readFile(none.receipt.evidence.usageReceiptPath, "utf8"));
    assert.equal(unknown.available, false);
    assert.equal(unknown.nativeResult, null);
});

function pinnedDispatch(callId, args, result) {
    return [
        { type: "tool.execution_start", data: { toolName: "task", toolCallId: callId, arguments: args } },
        { type: "tool.execution_complete", data: { toolCallId: callId, success: true, result } },
    ];
}

const PINNED_FLOW = [
    ...pinnedDispatch("c1", { name: "blueprint", agent_type: "general-purpose" }, { content: "Blueprint written.", detailedContent: "Blueprint written." }),
    ...pinnedDispatch("c2", { name: "replicate", agent_type: "general-purpose" }, { content: "Implemented.", detailedContent: "Implemented." }),
    ...pinnedDispatch("c3", { name: "frau-inspect", agent_type: "minime:frau" }, { content: "status: failed\nrisk_tier: HIGH\nfindings: none", detailedContent: "status: failed\nrisk_tier: HIGH" }),
    ...pinnedDispatch("c4", { name: "extract", agent_type: "general-purpose" }, { content: "Extracted.", detailedContent: "Extracted." }),
];

for (const [label, events, complete, running] of [
    ["pinned {content,detailedContent} results without worker id (Frau verdict text is not a worker failure)", PINNED_FLOW, true, 0],
    ["background dispatch with no terminal status stays running", [
        ...PINNED_FLOW.slice(0, 6),
        ...pinnedDispatch("c4", { name: "extract", agent_type: "general-purpose", mode: "background" }, { content: "Started in background. agent_id: worker-9" }),
    ], false, 1],
    ["background dispatch reaching completed status", [
        ...PINNED_FLOW.slice(0, 6),
        ...pinnedDispatch("c4", { name: "extract", agent_type: "general-purpose", mode: "background" }, { content: "agent_id: worker-9\nstatus: completed" }),
    ], true, 0],
    ["phase words in results do not dispatch phases", [
        ...pinnedDispatch("x1", { name: "explore", agent_type: "explore" }, { content: "blueprint replicate inspect extract" }),
    ], false, 0],
]) {
    test(`pinned native event shape: ${label}`, async (t) => {
        const root = await tempRoot("pinned-shape");
        t.after(() => rm(root, { recursive: true, force: true }));
        const outcome = await runMinime(root, { taskId: "AHM-P1", events, hqFiles: { "note.md": "x" } });
        assert.equal(outcome.fidelity.complete, complete);
        assert.equal(outcome.fidelity.runningWorkers.length, running);
        if (complete && label.startsWith("pinned")) {
            assert.equal(outcome.fidelity.phaseWorkers.inspect.childId, "UNKNOWN");
            assert.equal(outcome.fidelity.phaseWorkers.inspect.workerId, "c3");
        }
        assert.equal(outcome.snapshot.promoted, running === 0);
    });
}
