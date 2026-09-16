import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { FlowState } from "./flow-state.mjs";

const BLUEPRINT_TEXT = `# Blueprint: Native integration

Created: 2026-09-16 07:16 +02:00 | Status: implementing | Repo: acme/repo

## Goal

Keep this file as the source of truth.

## Active criteria

- [ ] C0-7 Apply correction waits for worker boundary. | VOI: decided-by-data
- [ ] C0-9 Native subagent lifecycle is displayed with model evidence. | VOI: decided-by-data
`;

async function createFixtureRoot(label) {
    const root = resolve(
        process.cwd(),
        `.github/extensions/minime-flow/lib/.test-work/${label}-${randomUUID()}`,
    );
    await mkdir(root, { recursive: true });
    const filename = "2026-09-16-native-copilot-integration.blueprint.md";
    await writeFile(resolve(root, filename), BLUEPRINT_TEXT, "utf8");
    return { root, filename };
}

test("idle native agents have finished their turn and do not block Apply", async (t) => {
    const fixture = await createFixtureRoot("idle-worker");
    t.after(async () => rm(fixture.root, { recursive: true, force: true }));
    const state = new FlowState({ root: fixture.root, repository: { org: "acme", repo: "repo" } });
    const active = state.syncNativeTasks([{
        type: "agent",
        id: "idle-agent",
        toolCallId: "idle-call",
        displayName: "replicate",
        agentType: "general-purpose",
        status: "idle",
    }]);
    assert.deepEqual(active.activeAgentIds, []);
    assert.equal(state.hasActiveFlowWorkers(), false);
    assert.equal(state.snapshot().phases.find((phase) => phase.id === "replicate").status, "completed");
});

test("completed selected blueprints remain visible instead of switching to other work", async (t) => {
    const fixture = await createFixtureRoot("completed-selection");
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    const state = new FlowState({
        root: fixture.root, repository: { org: "acme", repo: "repo" },
        selectedBlueprint: fixture.filename,
    });
    await writeFile(resolve(fixture.root, "other.blueprint.md"), BLUEPRINT_TEXT);
    await writeFile(resolve(fixture.root, fixture.filename), BLUEPRINT_TEXT.replaceAll("- [ ]", "- [x]"));
    const snapshot = state.refresh();
    assert.equal(snapshot.blueprint.filename, fixture.filename);
    assert.equal(snapshot.blueprint.progress.completed, 2);
    assert.equal(snapshot.blueprints.some((item) => item.filename === fixture.filename), false);
    assert.equal(state.select(fixture.filename).blueprint.filename, fixture.filename);
});

test("maps phase only from explicit dispatch metadata", async (t) => {
    const fixture = await createFixtureRoot("phase-map");
    t.after(async () => rm(fixture.root, { recursive: true, force: true }));

    const state = new FlowState({
        root: fixture.root,
        repository: { org: "acme", repo: "repo" },
        selectedBlueprint: fixture.filename,
    });

    state.onToolStart({
        toolCallId: "tool-1",
        toolName: "task",
        arguments: {
            prompt: "please inspect this area",
            name: "research worker",
            agent_type: "research",
        },
    });
    const snapshot = state.snapshot();
    const inspect = snapshot.phases.find((phase) => phase.id === "inspect");
    assert.equal(inspect.runs.length, 0);
    assert.equal(snapshot.currentWork.phase, "unknown");
});

test("maps generic task names before agent type fallback", async (t) => {
    const fixture = await createFixtureRoot("generic-phase-map");
    t.after(async () => rm(fixture.root, { recursive: true, force: true }));

    const state = new FlowState({
        root: fixture.root,
        repository: { org: "acme", repo: "repo" },
        selectedBlueprint: fixture.filename,
    });

    state.onToolStart({
        toolCallId: "task-replicate",
        toolName: "task",
        arguments: {
            name: "replicate",
            agent_type: "general-purpose",
        },
    });
    const replicateRun = state.snapshot().phases.find((phase) => phase.id === "replicate").runs.at(-1);
    assert.equal(replicateRun.phase, "replicate");
    assert.equal(state.hasActiveFlowWorkers(), true);

    state.onToolStart({
        toolCallId: "native-fallback",
        toolName: "task",
        arguments: {
            name: "replicate",
            agent_type: "general-purpose",
        },
    });
    state.onSubagentStarted({
        agentId: "agent-replicate",
        data: {
            toolCallId: "native-fallback",
            agentName: "general-purpose",
            agentDisplayName: "replicate",
            model: "gpt-5.3-codex",
        },
    });
    const fallbackRun = state.snapshot().phases.find((phase) => phase.id === "replicate").runs.at(-1);
    assert.equal(fallbackRun.phase, "replicate");
});

test("ignores unrelated generic tasks in active flow worker detection", async (t) => {
    const fixture = await createFixtureRoot("unrelated-worker");
    t.after(async () => rm(fixture.root, { recursive: true, force: true }));

    const state = new FlowState({
        root: fixture.root,
        repository: { org: "acme", repo: "repo" },
        selectedBlueprint: fixture.filename,
    });

    state.onToolStart({
        toolCallId: "unrelated",
        toolName: "task",
        arguments: {
            name: "native-lifecycle-proof",
            agent_type: "general-purpose",
        },
    });
    assert.equal(state.hasActiveFlowWorkers(), false);
});

test("tracks native subagent lifecycle and cancelled completion distinctly", async (t) => {
    const fixture = await createFixtureRoot("subagent-events");
    t.after(async () => rm(fixture.root, { recursive: true, force: true }));

    const state = new FlowState({
        root: fixture.root,
        repository: { org: "acme", repo: "repo" },
        selectedBlueprint: fixture.filename,
    });

    assert.equal(typeof state.onSubagentStarted, "function");
    assert.equal(typeof state.onSubagentConfigured, "function");
    assert.equal(typeof state.onSubagentCompleted, "function");

    state.onToolStart({
        toolCallId: "direct-task",
        toolName: "task",
        arguments: { phase: "inspect", name: "inspect task", agent_type: "minime:frau" },
    });
    state.onToolComplete({ toolCallId: "direct-task", success: true });
    let run = state.snapshot().phases.find((phase) => phase.id === "inspect").runs.at(-1);
    assert.notEqual(run.status, "completed");

    state.onSubagentStarted({
        agentId: "agent-2",
        data: {
            toolCallId: "direct-task",
            agentName: "general-purpose",
            agentDisplayName: "native-lifecycle-proof",
            agentDescription: "Native proof worker",
            parentId: "owner-1",
            model: "gpt-5.3-codex",
            executionMode: "sync",
        },
    });
    state.onSubagentConfigured({
        agentId: "agent-2",
        data: {
            model: "gpt-5.3-codex",
            multiTurn: true,
        },
    });
    state.onSubagentCompleted({
        agentId: "agent-2",
        data: {
            toolCallId: "direct-task",
            agentName: "general-purpose",
            agentDisplayName: "native-lifecycle-proof",
            cancelled: true,
            model: "gpt-5.3-codex",
            firstDispatchedModel: "gpt-5.3-codex",
            explicitModelOverride: "gpt-5.3-codex",
            totalToolCalls: 2,
            totalTokens: 111,
            durationMs: 999,
        },
    });

    run = state.snapshot().phases.find((phase) => phase.id === "inspect").runs.at(-1);
    assert.equal(run.status, "cancelled");
    assert.equal(run.agentId, "agent-2");
    assert.equal(run.parentAgentId, "owner-1");
    assert.equal(run.effectiveModel, "gpt-5.3-codex");
    assert.equal(run.explicitModelOverride, "gpt-5.3-codex");
    assert.equal(run.firstDispatchedModel, "gpt-5.3-codex");
    assert.equal(run.multiTurn, true);
    assert.equal(run.totalToolCalls, 2);
    assert.equal(run.totalTokens, 111);
    assert.equal(run.durationMs, 999);

    const events = state.snapshot().subagentEvents;
    assert.equal(events.length, 3);
    assert.equal(events[0].type, "subagent.started");
    assert.equal(events[0].agentId, "agent-2");
    assert.equal(events[0].data.toolCallId, "direct-task");
    assert.equal(events[0].data.executionMode, "sync");
    assert.equal(events[1].type, "subagent.configured");
    assert.equal(events[1].data.model, "gpt-5.3-codex");
    assert.equal(events[1].data.multiTurn, true);
    assert.equal(events[2].type, "subagent.completed");
    assert.equal(events[2].data.firstDispatchedModel, "gpt-5.3-codex");
    assert.equal(events[2].data.explicitModelOverride, "gpt-5.3-codex");
    assert.equal(events[2].data.totalToolCalls, 2);
    assert.equal(events[2].data.totalTokens, 111);
    assert.equal(events[2].data.durationMs, 999);
    assert.equal(events[2].data.cancelled, true);
    assert.deepEqual(state.snapshot().agentEvents, state.snapshot().subagentEvents);
});

test("accepts explicit owner progress reports with unknown fallback", async (t) => {
    const fixture = await createFixtureRoot("report");
    t.after(async () => rm(fixture.root, { recursive: true, force: true }));

    const state = new FlowState({
        root: fixture.root,
        repository: { org: "acme", repo: "repo" },
        selectedBlueprint: fixture.filename,
    });

    assert.equal(typeof state.reportProgress, "function");

    state.reportProgress({
        phase: "replicate",
        criterionId: "C0-7",
        criterion: "Apply correction waits for worker boundary.",
        needsInput: true,
        evidence: [{ label: "task log", detail: "request-77 pending" }],
        history: [{ status: "queued", requestId: "request-77" }],
    });

    let currentWork = state.snapshot().currentWork;
    assert.equal(currentWork.phase, "replicate");
    assert.equal(currentWork.criterionId, "C0-7");
    assert.equal(currentWork.needsInput, true);
    assert.deepEqual(currentWork.evidence, [{ label: "task log", detail: "request-77 pending" }]);
    assert.deepEqual(currentWork.history, [{ status: "queued", requestId: "request-77" }]);
    assert.equal(Array.isArray(currentWork.agents), true);

    state.reportProgress({});
    currentWork = state.snapshot().currentWork;
    assert.equal(currentWork.phase, "unknown");
    assert.equal(currentWork.criterionId, null);
});
