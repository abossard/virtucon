import test from "node:test";
import assert from "node:assert/strict";
import { collectAgentRecords, toAgentSummary } from "./agent-state.js";

test("toAgentSummary supports proved native subagent payload keys", () => {
    const cases = [
        {
            record: {
                type: "subagent.started",
                agentId: "agent-1",
                data: {
                    toolCallId: "tool-1",
                    agentName: "minime:frau",
                    agentDisplayName: "Inspect worker",
                    model: "gpt-5.3-codex",
                    executionMode: "background",
                },
            },
            name: "Inspect worker",
            status: "started",
            model: "gpt-5.3-codex",
        },
        {
            record: {
                type: "subagent.configured",
                agentId: "agent-2",
                data: {
                    model: "claude-sonnet-5",
                    multiTurn: true,
                },
            },
            name: "agent-2",
            status: "configured",
            model: "claude-sonnet-5",
        },
        {
            record: {
                type: "subagent.completed",
                agentId: "agent-3",
                data: {
                    toolCallId: "tool-3",
                    model: "gpt-5.6-sol",
                    firstDispatchedModel: "gpt-5.6-sol",
                    explicitModelOverride: "gpt-5.6-sol",
                    totalToolCalls: 5,
                    totalTokens: 1200,
                    durationMs: 8000,
                },
            },
            name: "agent-3",
            status: "completed",
            model: "gpt-5.6-sol",
        },
        {
            record: {
                type: "subagent.failed",
                agentId: "agent-4",
                data: {
                    toolCallId: "tool-4",
                    agentName: "minime:dr-evil",
                    agentDisplayName: "Orchestrator worker",
                    model: "claude-sonnet-5",
                    parentId: "root-session",
                    cancelled: true,
                    error: "Task cancelled by parent",
                },
            },
            name: "Orchestrator worker",
            status: "failed",
            model: "claude-sonnet-5",
        },
    ];

    for (const testCase of cases) {
        const summary = toAgentSummary(testCase.record);
        assert.equal(summary.name, testCase.name);
        assert.equal(summary.status, testCase.status);
        assert.equal(summary.model, testCase.model);
        assert.equal(summary.description.includes("agentId"), true);
        if (testCase.record.type === "subagent.completed") {
            assert.equal(summary.description.includes("explicitModelOverride gpt-5.6-sol"), true);
        }
        if (testCase.record.type === "subagent.failed") {
            assert.equal(summary.description.includes("parentId root-session"), true);
            assert.equal(summary.description.includes("cancelled true"), true);
            assert.equal(summary.description.includes("error Task cancelled by parent"), true);
        }
    }
});

test("toAgentSummary keeps backward compatibility for existing agent summary shape", () => {
    const summary = toAgentSummary({
        name: "Replicate worker",
        status: "running",
        effectiveModel: "gpt-5.4",
    });

    assert.deepEqual(summary, {
        name: "Replicate worker",
        status: "running",
        model: "gpt-5.4",
        description: "agentId not provided",
    });
});

test("collectAgentRecords prefers top-level events and falls back to currentWork", () => {
    const cases = [
        {
            flow: {
                subagentEvents: [{ type: "subagent.started", agentId: "top-level-subagent" }],
                currentWork: { agents: [{ agentId: "legacy-current-work" }] },
            },
            expectedAgentId: "top-level-subagent",
        },
        {
            flow: {
                subagentEvents: [],
                agentEvents: [{ type: "subagent.completed", agentId: "top-level-agent" }],
                currentWork: { agents: [{ agentId: "legacy-current-work" }] },
            },
            expectedAgentId: "top-level-agent",
        },
        {
            flow: {
                subagentEvents: [],
                agentEvents: [],
                currentWork: { agents: [{ agentId: "legacy-current-work" }] },
            },
            expectedAgentId: "legacy-current-work",
        },
    ];

    for (const testCase of cases) {
        const records = collectAgentRecords(testCase.flow, testCase.flow.currentWork);
        assert.equal(records.length, 1);
        assert.equal(records[0].agentId, testCase.expectedAgentId);
    }
});
