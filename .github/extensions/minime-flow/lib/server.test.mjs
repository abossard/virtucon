import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { startCanvasServer } from "./server.mjs";

const BLUEPRINT_NAME = "2026-09-16-native-copilot-integration.blueprint.md";
const BLUEPRINT_TEXT = `# Blueprint: Native integration

Created: 2026-09-16 07:16 +02:00 | Status: implementing | Repo: acme/repo

## Goal

Keep this file as the source of truth.

## Active criteria

- [ ] C0-7 Apply correction waits for worker boundary. | VOI: decided-by-data

## Criteria archive

- [x] Legacy accepted criterion.

## User's original request

\`\`\`text
Preserve this request block exactly.
\`\`\`
`;

async function createFixtureRoot(label) {
    const root = resolve(
        process.cwd(),
        `.github/extensions/minime-flow/lib/.test-work/${label}-${randomUUID()}`,
    );
    await mkdir(root, { recursive: true });
    const path = resolve(root, BLUEPRINT_NAME);
    await writeFile(path, BLUEPRINT_TEXT, "utf8");
    return { root, path };
}

async function createFixtureRootWithTwoBlueprints(label) {
    const fixture = await createFixtureRoot(label);
    const secondBlueprint = "2026-09-17-follow-up.blueprint.md";
    await writeFile(
        resolve(fixture.root, secondBlueprint),
        BLUEPRINT_TEXT
            .replace("Native integration", "Follow-up integration")
            .replace("C0-7 Apply correction waits for worker boundary.", "C0-8 Follow-up criterion."),
        "utf8",
    );
    return {
        ...fixture,
        firstBlueprint: BLUEPRINT_NAME,
        secondBlueprint,
    };
}

function makeSession(sessionId = "server-test-session") {
    const listeners = new Map();
    const events = [];
    let historyEnabled = true;
    let taskList = [];
    let taskListError = null;
    let taskListHook = null;
    const session = {
        sessionId,
        sent: [],
        sendAndWaitCalls: 0,
        taskListCalls: 0,
        async send(payload) {
            session.sent.push(payload);
        },
        async sendAndWait() {
            session.sendAndWaitCalls += 1;
            return {};
        },
        async getEvents() {
            if (!historyEnabled) throw Object.assign(new Error("event history unavailable"), { status: 503 });
            return events.map((event) => ({
                ...event,
                data: event?.data && typeof event.data === "object" ? { ...event.data } : event?.data,
            }));
        },
        on(type, handler) {
            const handlers = listeners.get(type) ?? [];
            handlers.push(handler);
            listeners.set(type, handlers);
            return () => {
                const current = listeners.get(type) ?? [];
                listeners.set(type, current.filter((item) => item !== handler));
            };
        },
        emit(type, event) {
            events.push({
                type,
                ...event,
            });
            for (const handler of listeners.get(type) ?? []) handler(event);
        },
        setHistoryEnabled(value) {
            historyEnabled = Boolean(value);
        },
        setTaskList(tasks) {
            taskList = Array.isArray(tasks)
                ? tasks.map((task) => ({ ...task }))
                : [];
        },
        setTaskListError(error) {
            taskListError = error;
        },
        setTaskListHook(hook) {
            taskListHook = typeof hook === "function" ? hook : null;
        },
        disableTaskListApi() {
            delete session.rpc.tasks.list;
        },
        rpc: {
            tasks: {
                async list() {
                    session.taskListCalls += 1;
                    if (taskListHook) await taskListHook({ count: session.taskListCalls, session });
                    if (taskListError) throw taskListError;
                    return {
                        tasks: taskList.map((task) => ({ ...task })),
                    };
                },
            },
        },
    };
    return session;
}

function makeAgentTask(overrides = {}) {
    return {
        type: "agent",
        id: "agent-1",
        toolCallId: "tool-1",
        displayName: "replicate",
        description: "phase: replicate",
        status: "running",
        startedAt: new Date().toISOString(),
        agentType: "general-purpose",
        prompt: "phase: replicate",
        ...overrides,
    };
}

async function requestJson(url, { method = "GET", nonce, body } = {}) {
    const origin = new URL(url).origin;
    const response = await fetch(url, {
        method,
        headers: {
            ...(method === "POST" ? { Origin: origin } : {}),
            ...(nonce ? { "X-Minime-Nonce": nonce } : {}),
            ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json();
    return { response, payload };
}

test("owner resolves a stale queued correction without losing worker proof or the submission", async (t) => {
    const fixture = await createFixtureRoot("resolve-stale-apply");
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    const server = await startCanvasServer({
        session: makeSession("resolve-owner"),
        selectedBlueprint: BLUEPRINT_NAME,
        repository: { org: "acme", repo: "repo" },
        root: fixture.root,
    });
    t.after(() => server.close());
    const original = server.readDocument();
    const submitted = original.markdown.replace("Keep this file as the source of truth.", "Keep the requested correction verbatim.");
    const saved = await server.saveDraft({
        blueprint: BLUEPRINT_NAME, markdown: submitted,
        baseRevision: original.revision, expectedDraftRevision: null,
    });
    const queued = await server.queueApply({ blueprint: BLUEPRINT_NAME, expectedDraftRevision: saved.draft.revision });
    const workerVersion = original.markdown + "\n## Evidence collected\n\nWorker proof: PASS.\n";
    await writeFile(fixture.path, workerVersion);
    await assert.rejects(() => server.commitApply({ requestId: queued.requestId }), /revision/);
    const stale = server.readDocument();
    assert.equal(stale.draft.baseMarkdown, original.markdown);
    const merged = submitted + "\n## Evidence collected\n\nWorker proof: PASS.\n";
    const resolved = await server.resolveApply({
        requestId: queued.requestId,
        expectedRevision: stale.revision,
        expectedDraftRevision: stale.draft.revision,
        markdown: merged,
    });
    assert.equal(await readFile(fixture.path, "utf8"), workerVersion);
    assert.equal(resolved.draft.status, "queued");
    const retained = JSON.parse(await readFile(resolved.draft.submissionPath, "utf8"));
    assert.equal(retained.markdown, submitted);
    assert.equal(retained.baseMarkdown, original.markdown);
    await assert.rejects(() => server.resolveApply({
        requestId: queued.requestId, expectedRevision: stale.revision,
        expectedDraftRevision: stale.draft.revision, markdown: submitted,
    }), /revision/);
    const committed = await server.commitApply({ requestId: queued.requestId, expectedRevision: resolved.revision });
    assert.equal(committed.status, "committed");
    assert.equal(await readFile(fixture.path, "utf8"), merged);
});

test("serves root CSP allowing inline styles for mermaid while keeping script self-only", async (t) => {
    const fixture = await createFixtureRoot("server-csp");
    t.after(async () => rm(fixture.root, { recursive: true, force: true }));
    const session = makeSession();
    const server = await startCanvasServer({
        session,
        selectedBlueprint: BLUEPRINT_NAME,
        repository: { org: "acme", repo: "repo" },
        root: fixture.root,
    });
    t.after(async () => server.close());

    const response = await fetch(server.url);
    assert.equal(response.status, 200);
    const csp = response.headers.get("content-security-policy");
    assert.equal(typeof csp, "string");
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /style-src 'self' 'unsafe-inline'/);
    assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
});

test("does not silently rebase queued drafts when document changed after save", async (t) => {
    const fixture = await createFixtureRoot("no-silent-rebase");
    t.after(async () => rm(fixture.root, { recursive: true, force: true }));
    const session = makeSession();
    const server = await startCanvasServer({
        session,
        selectedBlueprint: BLUEPRINT_NAME,
        repository: { org: "acme", repo: "repo" },
        root: fixture.root,
    });
    t.after(async () => server.close());

    const baseRevision = server.readDocument({ blueprint: BLUEPRINT_NAME }).revision;
    const draft = await server.saveDraft({
        blueprint: BLUEPRINT_NAME,
        markdown: `${BLUEPRINT_TEXT}\n\n## Decisions made\n\n- stale draft`,
        baseRevision,
        expectedDraftRevision: null,
    });
    await writeFile(
        fixture.path,
        `${BLUEPRINT_TEXT}\n\n## Decisions made\n\n- worker update`,
        "utf8",
    );

    const queued = await server.queueApply({
        blueprint: BLUEPRINT_NAME,
        expectedDraftRevision: draft.draft.revision,
    });
    assert.match(session.sent[0]?.prompt ?? "", new RegExp(`expectedRevision: ${baseRevision}`));
    await assert.rejects(
        () => server.commitApply({ requestId: queued.requestId }),
        (error) => {
            assert.equal(error.status, 409);
            return true;
        },
    );
    const persisted = await readFile(fixture.path, "utf8");
    assert.match(persisted, /worker update/);
    assert.doesNotMatch(persisted, /stale draft/);
});

test("serves document draft/apply contract and queues apply with session.send", async (t) => {
    const fixture = await createFixtureRoot("server-contract");
    t.after(async () => rm(fixture.root, { recursive: true, force: true }));
    const session = makeSession();
    const server = await startCanvasServer({
        session,
        selectedBlueprint: BLUEPRINT_NAME,
        repository: { org: "acme", repo: "repo" },
        root: fixture.root,
    });
    t.after(async () => server.close());

    const documentResult = await requestJson(`${server.url}api/document?blueprint=${BLUEPRINT_NAME}`, {
        nonce: server.nonce,
    });
    assert.equal(documentResult.response.status, 200);
    assert.equal(documentResult.payload.filename, BLUEPRINT_NAME);
    const originalRevision = documentResult.payload.revision;

    const stateResult = await requestJson(`${server.url}api/state`, {
        nonce: server.nonce,
    });
    assert.equal(stateResult.response.status, 200);
    assert.equal(stateResult.payload.blueprint.filename, BLUEPRINT_NAME);
    assert.equal(stateResult.payload.blueprint.revision, originalRevision);
    assert.equal(Array.isArray(stateResult.payload.currentWork.history), true);
    assert.equal(Array.isArray(stateResult.payload.currentWork.agents), true);
    assert.equal(Array.isArray(stateResult.payload.subagentEvents), true);
    assert.equal(Array.isArray(stateResult.payload.agentEvents), true);

    const draftResult = await requestJson(`${server.url}api/draft`, {
        method: "POST",
        nonce: server.nonce,
        body: {
            nonce: server.nonce,
            blueprint: BLUEPRINT_NAME,
            markdown: `${BLUEPRINT_TEXT}\n\n## Decisions made\n\n- New decision.`,
            baseRevision: originalRevision,
            expectedDraftRevision: null,
        },
    });
    assert.equal(draftResult.response.status, 200);
    assert.equal(draftResult.payload.draft.status, "saved");

    const applyResult = await requestJson(`${server.url}api/apply`, {
        method: "POST",
        nonce: server.nonce,
        body: {
            nonce: server.nonce,
            blueprint: BLUEPRINT_NAME,
            expectedDraftRevision: draftResult.payload.draft.revision,
        },
    });
    assert.equal(applyResult.response.status, 200);
    assert.equal(applyResult.payload.status, "queued");
    assert.equal(session.sendAndWaitCalls, 0);
    assert.equal(session.sent.length, 1);

    const commitResult = await server.commitApply({
        requestId: applyResult.payload.requestId,
        expectedRevision: originalRevision,
    });
    assert.equal(commitResult.status, "committed");
    const reread = await server.readDocument({ blueprint: BLUEPRINT_NAME });
    assert.equal(reread.draft.status, "committed");
});

test("returns explicit conflicts for stale draft and stale commit revisions", async (t) => {
    const fixture = await createFixtureRoot("server-conflict");
    t.after(async () => rm(fixture.root, { recursive: true, force: true }));
    const session = makeSession();
    const server = await startCanvasServer({
        session,
        selectedBlueprint: BLUEPRINT_NAME,
        repository: { org: "acme", repo: "repo" },
        root: fixture.root,
    });
    t.after(async () => server.close());

    const first = await server.saveDraft({
        blueprint: BLUEPRINT_NAME,
        markdown: `${BLUEPRINT_TEXT}\n\n## Extra\n\n- first`,
        baseRevision: server.readDocument({ blueprint: BLUEPRINT_NAME }).revision,
        expectedDraftRevision: null,
    });

    await assert.rejects(
        () =>
            server.saveDraft({
                blueprint: BLUEPRINT_NAME,
                markdown: `${BLUEPRINT_TEXT}\n\n## Extra\n\n- stale`,
                baseRevision: first.revision,
                expectedDraftRevision: "draft-revision-that-does-not-exist",
            }),
        (error) => {
            assert.equal(error.status, 409);
            return true;
        },
    );

    const queued = await server.queueApply({
        blueprint: BLUEPRINT_NAME,
        expectedDraftRevision: first.draft.revision,
    });
    await assert.rejects(
        () =>
            server.commitApply({
                requestId: queued.requestId,
                expectedRevision: "stale-committed-revision",
            }),
        (error) => {
            assert.equal(error.status, 409);
            return true;
        },
    );
});

test("blocks commit for mapped flow workers and ignores unrelated tasks", async (t) => {
    const fixture = await createFixtureRoot("worker-scope");
    t.after(async () => rm(fixture.root, { recursive: true, force: true }));
    const session = makeSession();
    const server = await startCanvasServer({
        session,
        selectedBlueprint: BLUEPRINT_NAME,
        repository: { org: "acme", repo: "repo" },
        root: fixture.root,
    });
    t.after(async () => server.close());

    const baseRevision = server.readDocument({ blueprint: BLUEPRINT_NAME }).revision;
    const draft = await server.saveDraft({
        blueprint: BLUEPRINT_NAME,
        markdown: `${BLUEPRINT_TEXT}\n\n## Decisions made\n\n- Worker scope test.`,
        baseRevision,
        expectedDraftRevision: null,
    });
    const queued = await server.queueApply({
        blueprint: BLUEPRINT_NAME,
        expectedDraftRevision: draft.draft.revision,
    });

    session.emit("tool.execution_start", {
        data: {
            toolCallId: "mapped-worker",
            toolName: "task",
            arguments: {
                name: "replicate",
                agent_type: "general-purpose",
            },
        },
    });
    await assert.rejects(
        () =>
            server.commitApply({
                requestId: queued.requestId,
                expectedRevision: baseRevision,
            }),
        (error) => {
            assert.equal(error.status, 409);
            return true;
        },
    );

    session.emit("subagent.completed", {
        agentId: "mapped-agent",
        data: {
            toolCallId: "mapped-worker",
            agentName: "general-purpose",
            agentDisplayName: "replicate",
            model: "gpt-5.3-codex",
            firstDispatchedModel: "gpt-5.3-codex",
        },
    });
    session.emit("tool.execution_start", {
        data: {
            toolCallId: "unrelated-worker",
            toolName: "task",
            arguments: {
                name: "native-lifecycle-proof",
                agent_type: "general-purpose",
            },
        },
    });

    const committed = await server.commitApply({
        requestId: queued.requestId,
        expectedRevision: baseRevision,
    });
    assert.equal(committed.status, "committed");
});

test("recovers queued request for original file after select switch and restart", async (t) => {
    const fixture = await createFixtureRootWithTwoBlueprints("request-recovery");
    t.after(async () => rm(fixture.root, { recursive: true, force: true }));
    const session = makeSession("request-recovery-session");
    const serverA = await startCanvasServer({
        session,
        selectedBlueprint: fixture.firstBlueprint,
        repository: { org: "acme", repo: "repo" },
        root: fixture.root,
    });

    const baseRevision = serverA.readDocument({ blueprint: fixture.firstBlueprint }).revision;
    const draft = await serverA.saveDraft({
        blueprint: fixture.firstBlueprint,
        markdown: `${BLUEPRINT_TEXT}\n\n## Decisions made\n\n- Recovery commit.`,
        baseRevision,
        expectedDraftRevision: null,
    });
    const queued = await serverA.queueApply({
        blueprint: fixture.firstBlueprint,
        expectedDraftRevision: draft.draft.revision,
    });

    serverA.select(fixture.secondBlueprint);
    await serverA.close();

    const serverB = await startCanvasServer({
        session,
        selectedBlueprint: fixture.secondBlueprint,
        repository: { org: "acme", repo: "repo" },
        root: fixture.root,
    });
    t.after(async () => serverB.close());

    const commit = await serverB.commitApply({
        requestId: queued.requestId,
    });
    assert.equal(commit.status, "committed");
    const updated = await readFile(fixture.path, "utf8");
    assert.match(updated, /Recovery commit/);
});

test("queries native tasks on open and before commit, filtering to flow-owned tasks", async (t) => {
    const fixture = await createFixtureRoot("native-task-list-guard");
    t.after(async () => rm(fixture.root, { recursive: true, force: true }));
    const session = makeSession("native-task-list-guard-session");
    const server = await startCanvasServer({
        session,
        selectedBlueprint: BLUEPRINT_NAME,
        repository: { org: "acme", repo: "repo" },
        root: fixture.root,
    });
    t.after(async () => server.close());
    assert.equal(session.taskListCalls, 1);

    const baseRevision = server.readDocument({ blueprint: BLUEPRINT_NAME }).revision;
    const draft = await server.saveDraft({
        blueprint: BLUEPRINT_NAME,
        markdown: `${BLUEPRINT_TEXT}\n\n## Decisions made\n\n- Pending commit.`,
        baseRevision,
        expectedDraftRevision: null,
    });
    const queued = await server.queueApply({
        blueprint: BLUEPRINT_NAME,
        expectedDraftRevision: draft.draft.revision,
    });

    session.setTaskList([
        makeAgentTask({
            id: "agent-replicate",
            toolCallId: "tool-replicate",
            displayName: "replicate",
            description: "phase: replicate",
            prompt: "phase: replicate",
        }),
        makeAgentTask({
            id: "agent-research",
            toolCallId: "tool-research",
            displayName: "research",
            description: "research helper",
            prompt: "please inspect this area",
            status: "running",
            agentType: "research",
        }),
    ]);

    await assert.rejects(
        () => server.commitApply({ requestId: queued.requestId }),
        (error) => {
            assert.equal(error.status, 409);
            assert.deepEqual(error.conflict.activeAgentIds, ["agent-replicate"]);
            assert.deepEqual(error.conflict.activeToolCallIds, ["tool-replicate"]);
            return true;
        },
    );
    assert.equal(session.taskListCalls, 2);
});

test("fails closed for commit apply when native task recovery is unavailable", async (t) => {
    const fixture = await createFixtureRoot("tasks-unavailable");
    t.after(async () => rm(fixture.root, { recursive: true, force: true }));
    const session = makeSession("tasks-unavailable-session");
    session.disableTaskListApi();
    const server = await startCanvasServer({
        session,
        selectedBlueprint: BLUEPRINT_NAME,
        repository: { org: "acme", repo: "repo" },
        root: fixture.root,
    });
    t.after(async () => server.close());
    const startupState = server.refresh();
    assert.equal(startupState.apply.state, "error");
    assert.match(startupState.apply.message, /Native task recovery unavailable/);

    const baseRevision = server.readDocument({ blueprint: BLUEPRINT_NAME }).revision;
    const draft = await server.saveDraft({
        blueprint: BLUEPRINT_NAME,
        markdown: `${BLUEPRINT_TEXT}\n\n## Decisions made\n\n- Pending reconciled commit.`,
        baseRevision,
        expectedDraftRevision: null,
    });
    const queued = await server.queueApply({
        blueprint: BLUEPRINT_NAME,
        expectedDraftRevision: draft.draft.revision,
    });

    await assert.rejects(
        () => server.commitApply({ requestId: queued.requestId }),
        (error) => {
            assert.equal(error.status, 409);
            assert.equal(error.conflict.workerState, "unknown");
            assert.match(error.conflict.replayError, /unavailable/);
            return true;
        },
    );
});

test("subscribes before initial task list query so startup events are not lost", async (t) => {
    const fixture = await createFixtureRoot("subscribe-before-list");
    t.after(async () => rm(fixture.root, { recursive: true, force: true }));
    const session = makeSession("subscribe-before-list-session");
    session.setTaskListHook(({ count, session: source }) => {
        if (count !== 1) return;
        source.emit("tool.execution_start", {
            data: {
                toolCallId: "startup-run",
                toolName: "task",
                arguments: {
                    name: "replicate",
                    agent_type: "general-purpose",
                },
            },
        });
    });

    const server = await startCanvasServer({
        session,
        selectedBlueprint: BLUEPRINT_NAME,
        repository: { org: "acme", repo: "repo" },
        root: fixture.root,
    });
    t.after(async () => server.close());

    const baseRevision = server.readDocument({ blueprint: BLUEPRINT_NAME }).revision;
    const draft = await server.saveDraft({
        blueprint: BLUEPRINT_NAME,
        markdown: `${BLUEPRINT_TEXT}\n\n## Decisions made\n\n- Startup worker race.`,
        baseRevision,
        expectedDraftRevision: null,
    });
    const queued = await server.queueApply({
        blueprint: BLUEPRINT_NAME,
        expectedDraftRevision: draft.draft.revision,
    });

    await assert.rejects(
        () => server.commitApply({ requestId: queued.requestId }),
        (error) => {
            assert.equal(error.status, 409);
            return true;
        },
    );
});

test("blocks recovered commit after reload using persisted native worker ids", async (t) => {
    const fixture = await createFixtureRoot("rehydrate-workers");
    t.after(async () => rm(fixture.root, { recursive: true, force: true }));
    const session = makeSession("rehydrate-workers-session");
    const serverA = await startCanvasServer({
        session,
        selectedBlueprint: BLUEPRINT_NAME,
        repository: { org: "acme", repo: "repo" },
        root: fixture.root,
    });

    const baseRevision = serverA.readDocument({ blueprint: BLUEPRINT_NAME }).revision;
    const draft = await serverA.saveDraft({
        blueprint: BLUEPRINT_NAME,
        markdown: `${BLUEPRINT_TEXT}\n\n## Decisions made\n\n- Pending worker.`,
        baseRevision,
        expectedDraftRevision: null,
    });
    session.emit("tool.execution_start", {
        data: {
            toolCallId: "replicate-active",
            toolName: "task",
            arguments: {
                name: "replicate",
                agent_type: "general-purpose",
            },
        },
    });
    session.emit("subagent.started", {
        agentId: "agent-active",
        data: {
            toolCallId: "replicate-active",
            agentName: "general-purpose",
            agentDisplayName: "replicate",
            model: "gpt-5.3-codex",
            executionMode: "background",
        },
    });
    const queued = await serverA.queueApply({
        blueprint: BLUEPRINT_NAME,
        expectedDraftRevision: draft.draft.revision,
    });
    await serverA.close();
    session.setTaskList([
        makeAgentTask({
            id: "agent-active",
            toolCallId: "replicate-active",
            displayName: "background-general-purpose",
            description: "Read-only native worker drain probe",
            prompt: "Run exactly one command: sleep 12",
            status: "running",
        }),
    ]);

    const serverB = await startCanvasServer({
        session,
        selectedBlueprint: BLUEPRINT_NAME,
        repository: { org: "acme", repo: "repo" },
        root: fixture.root,
    });
    t.after(async () => serverB.close());

    await assert.rejects(
        () => serverB.commitApply({ requestId: queued.requestId }),
        (error) => {
            assert.equal(error.status, 409);
            assert.deepEqual(error.conflict.activeAgentIds, ["agent-active"]);
            return true;
        },
    );
});

test("rejects open input when blueprint and blueprintPath identify different files", async (t) => {
    const fixture = await createFixtureRootWithTwoBlueprints("blueprint-path-mismatch");
    t.after(async () => rm(fixture.root, { recursive: true, force: true }));
    const session = makeSession();
    let server = null;

    try {
        server = await startCanvasServer({
            session,
            selectedBlueprint: fixture.firstBlueprint,
            selectedBlueprintPath: `acme/_repo/blueprints/${fixture.secondBlueprint}`,
            repository: { org: "acme", repo: "repo" },
            root: fixture.root,
        });
        assert.fail("Expected blueprint path mismatch to fail.");
    } catch (error) {
        assert.equal(error.status, 422);
    } finally {
        if (server) await server.close();
    }
});

test("uses blueprintPath to choose the initial blueprint identity", async (t) => {
    const fixture = await createFixtureRootWithTwoBlueprints("blueprint-path-selection");
    t.after(async () => rm(fixture.root, { recursive: true, force: true }));
    const session = makeSession();
    const server = await startCanvasServer({
        session,
        selectedBlueprintPath: `acme/_repo/blueprints/${fixture.firstBlueprint}`,
        repository: { org: "acme", repo: "repo" },
        root: fixture.root,
    });
    t.after(async () => server.close());

    const document = server.readDocument();
    assert.equal(document.filename, fixture.firstBlueprint);
});

test("rechecks committed request proof and rejects stale repeat after file change", async (t) => {
    const fixture = await createFixtureRoot("stale-proof");
    t.after(async () => rm(fixture.root, { recursive: true, force: true }));
    const session = makeSession();
    const server = await startCanvasServer({
        session,
        selectedBlueprint: BLUEPRINT_NAME,
        repository: { org: "acme", repo: "repo" },
        root: fixture.root,
    });
    t.after(async () => server.close());

    const baseRevision = server.readDocument({ blueprint: BLUEPRINT_NAME }).revision;
    const draft = await server.saveDraft({
        blueprint: BLUEPRINT_NAME,
        markdown: `${BLUEPRINT_TEXT}\n\n## Decisions made\n\n- First commit.`,
        baseRevision,
        expectedDraftRevision: null,
    });
    const queued = await server.queueApply({
        blueprint: BLUEPRINT_NAME,
        expectedDraftRevision: draft.draft.revision,
    });
    const firstCommit = await server.commitApply({
        requestId: queued.requestId,
        expectedRevision: baseRevision,
    });
    assert.equal(firstCommit.status, "committed");

    await writeFile(
        fixture.path,
        `${await readFile(fixture.path, "utf8")}\n\n## Notes\n\n- External change.`,
        "utf8",
    );

    await assert.rejects(
        () =>
            server.commitApply({
                requestId: queued.requestId,
            }),
        (error) => {
            assert.equal(error.status, 409);
            return true;
        },
    );
});
