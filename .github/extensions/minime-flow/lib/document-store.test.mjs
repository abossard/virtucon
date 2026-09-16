import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { access, chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
    commitQueuedDocument,
    queueDocumentApply,
    readDocumentWithDraft,
    resolveHqRoot,
    saveDocumentDraft,
} from "./document-store.mjs";

const BLUEPRINT_TEXT = `# Blueprint: Native integration

Created: 2026-09-16 07:16 +02:00 | Status: implementing | Repo: acme/repo

## Goal

Keep this file as the source of truth.

## Active criteria

- [ ] C0-10 Conflicting saves keep both drafts. | VOI: decided-by-data

## Criteria archive

- [x] Legacy accepted criterion.

## User's original request

\`\`\`text
Preserve this request block exactly.
\`\`\`

## Decisions made

- Preserve acceptance records verbatim.
`;

function moduleUrl() {
    return pathToFileURL(
        resolve(process.cwd(), ".github/extensions/minime-flow/lib/document-store.mjs"),
    ).href;
}

async function createFixtureRoot(label) {
    const root = resolve(
        process.cwd(),
        `.github/extensions/minime-flow/lib/.test-work/${label}-${randomUUID()}`,
    );
    await mkdir(root, { recursive: true });
    const documentPath = resolve(root, "2026-09-16-native-copilot-integration.blueprint.md");
    await writeFile(documentPath, BLUEPRINT_TEXT, "utf8");
    return { root, documentPath };
}

async function createNestedFixtureRoot(label) {
    const root = resolve(
        process.cwd(),
        `.github/extensions/minime-flow/lib/.test-work/${label}-${randomUUID()}`,
    );
    const docsRoot = resolve(root, "docs");
    await mkdir(docsRoot, { recursive: true });
    const documentPath = resolve(docsRoot, "2026-09-16-native-copilot-integration.blueprint.md");
    await writeFile(documentPath, BLUEPRINT_TEXT, "utf8");
    return { root, docsRoot, documentPath };
}

async function createMissingFixtureRoot(label) {
    const root = resolve(
        process.cwd(),
        `.github/extensions/minime-flow/lib/.test-work/${label}-${randomUUID()}`,
    );
    const docsRoot = resolve(root, "wiki", "orgs", "acme", "repo");
    await mkdir(docsRoot, { recursive: true });
    const documentPath = resolve(docsRoot, "derived-rules.md");
    return { root, documentPath };
}

async function createWikiArticleFixtureRoot(label) {
    const root = resolve(
        process.cwd(),
        `.github/extensions/minime-flow/lib/.test-work/${label}-${randomUUID()}`,
    );
    const docsRoot = resolve(root, "wiki", "orgs", "acme", "repo");
    await mkdir(docsRoot, { recursive: true });
    const documentPath = resolve(docsRoot, "integration-notes.md");
    await writeFile(documentPath, "# Rulebook\n\n## Summary\n\nOld summary.\n", "utf8");
    return { root, documentPath };
}

function draftKey(sessionId, documentPath) {
    return createHash("sha256").update(`${sessionId}\n${documentPath}`, "utf8").digest("hex");
}

function inChild(functionName, args) {
    return new Promise((resolveChild) => {
        const script = `
            const fn = process.env.MINIME_FN;
            const args = JSON.parse(process.env.MINIME_ARGS);
            const mod = await import(process.env.MINIME_MODULE);
            try {
                const result = await mod[fn](args);
                process.stdout.write(JSON.stringify({ ok: true, result }));
            } catch (error) {
                process.stdout.write(JSON.stringify({
                    ok: false,
                    status: error?.status ?? null,
                    message: error?.message ?? "",
                    conflict: error?.conflict ?? null
                }));
                process.exitCode = 1;
            }
        `;
        const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
            env: {
                ...process.env,
                MINIME_FN: functionName,
                MINIME_ARGS: JSON.stringify(args),
                MINIME_MODULE: moduleUrl(),
            },
            stdio: ["ignore", "pipe", "pipe"],
        });
        let output = "";
        child.stdout.on("data", (chunk) => { output += chunk.toString("utf8"); });
        child.stderr.on("data", (chunk) => { output += chunk.toString("utf8"); });
        child.once("close", (code) => {
            const parsed = output ? JSON.parse(output) : { ok: false, status: null, message: "No output." };
            resolveChild({ code, ...parsed });
        });
    });
}

function withCriteriaUpdate(markdown, value) {
    return markdown.replace("C0-10 Conflicting saves keep both drafts.", value);
}

test("prefers VIRTUCON_HQ over MINIME_HOME and default", () => {
    const root = resolveHqRoot({
        HOME: "/home/default",
        VIRTUCON_HQ: "/hq/preferred",
        MINIME_HOME: "/legacy/minime-home",
    });
    assert.equal(root, "/hq/preferred");
});

test("retains losing drafts for duplicate-create and stale-base conflicts", async (t) => {
    const fixture = await createFixtureRoot("retain-conflicts");
    t.after(async () => rm(fixture.root, { recursive: true, force: true }));
    const sessionId = "owner-session";

    const baseline = readDocumentWithDraft({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId,
    });
    const first = await saveDocumentDraft({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId,
        markdown: withCriteriaUpdate(BLUEPRINT_TEXT, "C0-10 Baseline draft."),
        baseRevision: baseline.revision,
        expectedDraftRevision: null,
    });
    assert.equal(first.draft.status, "saved");

    let duplicateError;
    try {
        await saveDocumentDraft({
            draftRoot: fixture.root,
            documentPath: fixture.documentPath,
            sessionId,
            markdown: withCriteriaUpdate(BLUEPRINT_TEXT, "C0-10 Duplicate create attempt."),
            baseRevision: baseline.revision,
            expectedDraftRevision: null,
        });
        assert.fail("Expected duplicate create to fail.");
    } catch (error) {
        duplicateError = error;
    }
    assert.equal(duplicateError.status, 409);
    assert.equal(typeof duplicateError.conflict?.retainedDraftPath, "string");
    await access(duplicateError.conflict.retainedDraftPath);
    const duplicateRetained = JSON.parse(await readFile(duplicateError.conflict.retainedDraftPath, "utf8"));
    assert.match(duplicateRetained.markdown, /Duplicate create attempt/);

    let staleBaseError;
    try {
        await saveDocumentDraft({
            draftRoot: fixture.root,
            documentPath: fixture.documentPath,
            sessionId,
            markdown: withCriteriaUpdate(BLUEPRINT_TEXT, "C0-10 Stale base attempt."),
            baseRevision: "stale-base-revision",
            expectedDraftRevision: first.draft.revision,
        });
        assert.fail("Expected stale base save to fail.");
    } catch (error) {
        staleBaseError = error;
    }
    assert.equal(staleBaseError.status, 409);
    assert.equal(typeof staleBaseError.conflict?.retainedDraftPath, "string");
    await access(staleBaseError.conflict.retainedDraftPath);
    const staleRetained = JSON.parse(await readFile(staleBaseError.conflict.retainedDraftPath, "utf8"));
    assert.match(staleRetained.markdown, /Stale base attempt/);
});

test("rejects save over queued apply and retains user draft candidate", async (t) => {
    const fixture = await createFixtureRoot("queued-overwrite");
    t.after(async () => rm(fixture.root, { recursive: true, force: true }));
    const sessionId = "owner-session";

    const baseline = readDocumentWithDraft({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId,
    });
    const draft = await saveDocumentDraft({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId,
        markdown: withCriteriaUpdate(BLUEPRINT_TEXT, "C0-10 Queued baseline."),
        baseRevision: baseline.revision,
        expectedDraftRevision: null,
    });
    const queued = await queueDocumentApply({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId,
        expectedDraftRevision: draft.draft.revision,
    });

    let queuedSaveError;
    try {
        await saveDocumentDraft({
            draftRoot: fixture.root,
            documentPath: fixture.documentPath,
            sessionId,
            markdown: withCriteriaUpdate(BLUEPRINT_TEXT, "C0-10 New draft while queued."),
            baseRevision: baseline.revision,
            expectedDraftRevision: draft.draft.revision,
        });
        assert.fail("Expected save-over-queued draft to fail.");
    } catch (error) {
        queuedSaveError = error;
    }
    assert.equal(queuedSaveError.status, 409);
    assert.equal(queuedSaveError.conflict?.currentRequestId, queued.requestId);
    assert.equal(typeof queuedSaveError.conflict?.retainedDraftPath, "string");
    await access(queuedSaveError.conflict.retainedDraftPath);

    const reread = readDocumentWithDraft({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId,
    });
    assert.equal(reread.draft.status, "queued");
    assert.equal(reread.draft.requestId, queued.requestId);
});

test("rejects protected request and archive changes rather than silently dropping them", async (t) => {
    const fixture = await createFixtureRoot("protected-sections");
    t.after(async () => rm(fixture.root, { recursive: true, force: true }));
    const sessionId = "owner-session";

    const baseline = readDocumentWithDraft({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId,
    });
    const tamperedDraft = BLUEPRINT_TEXT
        .replace("C0-10 Conflicting saves keep both drafts.", "C0-10 Updated criterion text.")
        .replace("Legacy accepted criterion.", "Tampered archive row.")
        .replace("Preserve this request block exactly.", "Tampered request block.");

    const draft = await saveDocumentDraft({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId,
        markdown: tamperedDraft,
        baseRevision: baseline.revision,
        expectedDraftRevision: null,
    });
    const queued = await queueDocumentApply({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId,
        expectedDraftRevision: draft.draft.revision,
    });

    await assert.rejects(() => commitQueuedDocument({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId,
        requestId: queued.requestId,
        expectedRevision: baseline.revision,
    }), /protected section/);

    const persisted = await readFile(fixture.documentPath, "utf8");
    assert.equal(persisted, BLUEPRINT_TEXT);
    assert.match(persisted, /Legacy accepted criterion\./);
    assert.match(persisted, /Preserve this request block exactly\./);
    assert.doesNotMatch(persisted, /Tampered archive row\./);
    assert.doesNotMatch(persisted, /Tampered request block\./);
});

test("rejects malformed commit candidates missing mandatory headings", async (t) => {
    const fixture = await createFixtureRoot("mandatory-headings");
    t.after(async () => rm(fixture.root, { recursive: true, force: true }));
    const sessionId = "owner-session";

    const baseline = readDocumentWithDraft({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId,
    });
    const malformedDraft = BLUEPRINT_TEXT.replace("## Active criteria", "## Removed active criteria");

    const draft = await saveDocumentDraft({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId,
        markdown: malformedDraft,
        baseRevision: baseline.revision,
        expectedDraftRevision: null,
    });
    const queued = await queueDocumentApply({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId,
        expectedDraftRevision: draft.draft.revision,
    });

    await assert.rejects(
        () =>
            commitQueuedDocument({
                draftRoot: fixture.root,
                documentPath: fixture.documentPath,
                sessionId,
                requestId: queued.requestId,
                expectedRevision: baseline.revision,
            }),
        (error) => {
            assert.equal(error.status, 422);
            return true;
        },
    );
});

test("serializes compare-and-replace across processes and retains losing draft", async (t) => {
    const fixture = await createFixtureRoot("parallel-save");
    t.after(async () => rm(fixture.root, { recursive: true, force: true }));

    const baseline = readDocumentWithDraft({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId: "owner-session",
    });
    const first = await saveDocumentDraft({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId: "owner-session",
        markdown: withCriteriaUpdate(BLUEPRINT_TEXT, "C0-10 baseline"),
        baseRevision: baseline.revision,
        expectedDraftRevision: null,
    });

    const [left, right] = await Promise.all([
        inChild("saveDocumentDraft", {
            draftRoot: fixture.root,
            documentPath: fixture.documentPath,
            sessionId: "owner-session",
            markdown: withCriteriaUpdate(BLUEPRINT_TEXT, "C0-10 left"),
            baseRevision: baseline.revision,
            expectedDraftRevision: first.draft.revision,
        }),
        inChild("saveDocumentDraft", {
            draftRoot: fixture.root,
            documentPath: fixture.documentPath,
            sessionId: "owner-session",
            markdown: withCriteriaUpdate(BLUEPRINT_TEXT, "C0-10 right"),
            baseRevision: baseline.revision,
            expectedDraftRevision: first.draft.revision,
        }),
    ]);

    const successes = [left, right].filter((item) => item.ok);
    const failures = [left, right].filter((item) => !item.ok);
    assert.equal(successes.length, 1);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].status, 409);
    assert.equal(typeof failures[0].conflict?.retainedDraftPath, "string");
    await access(failures[0].conflict.retainedDraftPath);
});

test("allows only one commit winner across two sessions on same document revision", async (t) => {
    const fixture = await createFixtureRoot("two-session-commit-race");
    t.after(async () => rm(fixture.root, { recursive: true, force: true }));
    const base = readDocumentWithDraft({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId: "session-a",
    });

    const sessionA = await saveDocumentDraft({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId: "session-a",
        markdown: withCriteriaUpdate(BLUEPRINT_TEXT, "C0-10 session-a commit"),
        baseRevision: base.revision,
        expectedDraftRevision: null,
    });
    const sessionB = await saveDocumentDraft({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId: "session-b",
        markdown: withCriteriaUpdate(BLUEPRINT_TEXT, "C0-10 session-b commit"),
        baseRevision: base.revision,
        expectedDraftRevision: null,
    });

    const queuedA = await queueDocumentApply({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId: "session-a",
        expectedDraftRevision: sessionA.draft.revision,
    });
    const queuedB = await queueDocumentApply({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId: "session-b",
        expectedDraftRevision: sessionB.draft.revision,
    });

    const [commitA, commitB] = await Promise.all([
        inChild("commitQueuedDocument", {
            draftRoot: fixture.root,
            documentPath: fixture.documentPath,
            sessionId: "session-a",
            requestId: queuedA.requestId,
            expectedRevision: base.revision,
        }),
        inChild("commitQueuedDocument", {
            draftRoot: fixture.root,
            documentPath: fixture.documentPath,
            sessionId: "session-b",
            requestId: queuedB.requestId,
            expectedRevision: base.revision,
        }),
    ]);

    const successes = [commitA, commitB].filter((item) => item.ok);
    const failures = [commitA, commitB].filter((item) => !item.ok);
    assert.equal(successes.length, 1);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].status, 409);

    const persisted = await readFile(fixture.documentPath, "utf8");
    assert.match(persisted, /session-a commit|session-b commit/);
});

test("shares draft and apply state across different roots for same canonical document", async (t) => {
    const fixture = await createNestedFixtureRoot("canonical-artifacts");
    t.after(async () => rm(fixture.root, { recursive: true, force: true }));
    const sessionId = "owner-session";

    const baseline = readDocumentWithDraft({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId,
    });

    const saved = await saveDocumentDraft({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId,
        markdown: withCriteriaUpdate(BLUEPRINT_TEXT, "C0-10 canonical domain"),
        baseRevision: baseline.revision,
        expectedDraftRevision: null,
    });

    await assert.rejects(
        () =>
            saveDocumentDraft({
                draftRoot: fixture.docsRoot,
                documentPath: fixture.documentPath,
                sessionId,
                markdown: withCriteriaUpdate(BLUEPRINT_TEXT, "C0-10 duplicate create"),
                baseRevision: baseline.revision,
                expectedDraftRevision: null,
            }),
        (error) => {
            assert.equal(error.status, 409);
            return true;
        },
    );

    const queued = await queueDocumentApply({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId,
        expectedDraftRevision: saved.draft.revision,
    });
    const committed = await commitQueuedDocument({
        draftRoot: fixture.docsRoot,
        documentPath: fixture.documentPath,
        sessionId,
        requestId: queued.requestId,
        expectedRevision: baseline.revision,
    });
    assert.equal(committed.status, "committed");
});

test("concurrent create-only commits cannot overwrite the first created document", async (t) => {
    const fixture = await createFixtureRoot("create-only-race");
    t.after(async () => rm(fixture.root, { recursive: true, force: true }));
    const documentPath = resolve(fixture.root, "new-article.md");
    const requests = [];
    for (const sessionId of ["creator-a", "creator-b"]) {
        const input = { draftRoot: fixture.root, documentPath, sessionId, createIfMissing: true };
        const saved = await saveDocumentDraft({
            ...input,
            markdown: `# ${sessionId}\n`,
            baseRevision: null,
            expectedDraftRevision: null,
        });
        const queued = await queueDocumentApply({ ...input, expectedDraftRevision: saved.draft.revision });
        requests.push({ ...input, requestId: queued.requestId, expectedRevision: null });
    }
    const results = await Promise.allSettled(requests.map(commitQueuedDocument));
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
});

test("supports explicit create-only commits with opaque expected revisions", async (t) => {
    const fixture = await createMissingFixtureRoot("create-only");
    t.after(async () => rm(fixture.root, { recursive: true, force: true }));
    const sessionId = "owner-session";
    const expectedRevision = 20260916;
    const markdown = "# Derived rules\n\n- Keep interfaces small.\n";

    assert.throws(
        () =>
            readDocumentWithDraft({
                draftRoot: fixture.root,
                documentPath: fixture.documentPath,
                sessionId,
            }),
        (error) => {
            assert.equal(error.status, 404);
            return true;
        },
    );
    const missing = readDocumentWithDraft({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId,
        allowMissing: true,
    });
    assert.equal(missing.revision, null);
    assert.equal(missing.markdown, "");

    await assert.rejects(
        () =>
            saveDocumentDraft({
                draftRoot: fixture.root,
                documentPath: fixture.documentPath,
                sessionId,
                markdown,
                baseRevision: expectedRevision,
                expectedDraftRevision: null,
            }),
        (error) => {
            assert.equal(error.status, 404);
            return true;
        },
    );

    const saved = await saveDocumentDraft({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId,
        markdown,
        baseRevision: expectedRevision,
        expectedDraftRevision: null,
        createIfMissing: true,
    });
    assert.equal(saved.revision, null);
    assert.equal(saved.draft.baseRevision, expectedRevision);

    const queued = await queueDocumentApply({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId,
        expectedDraftRevision: saved.draft.revision,
        createIfMissing: true,
    });

    await assert.rejects(
        () =>
            commitQueuedDocument({
                draftRoot: fixture.root,
                documentPath: fixture.documentPath,
                sessionId,
                requestId: queued.requestId,
                expectedRevision: 20260917,
                createIfMissing: true,
            }),
        (error) => {
            assert.equal(error.status, 409);
            return true;
        },
    );

    const committed = await commitQueuedDocument({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId,
        requestId: queued.requestId,
        expectedRevision,
        createIfMissing: true,
    });
    assert.equal(committed.status, "committed");
    assert.equal(await readFile(fixture.documentPath, "utf8"), markdown);
});

test("supports create-only commits when expected and base revisions are null", async (t) => {
    const fixture = await createMissingFixtureRoot("create-only-null");
    t.after(async () => rm(fixture.root, { recursive: true, force: true }));
    const sessionId = "owner-session";
    const markdown = "# Derived rules\n\n- Preserve null create-only token.\n";

    const saved = await saveDocumentDraft({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId,
        markdown,
        baseRevision: null,
        expectedDraftRevision: null,
        createIfMissing: true,
    });
    assert.equal(saved.revision, null);
    assert.equal(saved.draft.baseRevision, null);

    const queued = await queueDocumentApply({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId,
        expectedDraftRevision: saved.draft.revision,
        createIfMissing: true,
    });
    const committed = await commitQueuedDocument({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId,
        requestId: queued.requestId,
        expectedRevision: null,
        createIfMissing: true,
    });
    assert.equal(committed.status, "committed");
    assert.equal(await readFile(fixture.documentPath, "utf8"), markdown);
});

test("allows non-blueprint article restructuring without heading guard failures", async (t) => {
    const fixture = await createWikiArticleFixtureRoot("wiki-restructure");
    t.after(async () => rm(fixture.root, { recursive: true, force: true }));
    const sessionId = "wiki-session";

    const base = readDocumentWithDraft({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId,
    });
    const saved = await saveDocumentDraft({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId,
        markdown: "# Renamed rulebook\n\n## Notes\n\nRestructured content.\n",
        baseRevision: base.revision,
        expectedDraftRevision: null,
    });
    const queued = await queueDocumentApply({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId,
        expectedDraftRevision: saved.draft.revision,
    });
    const committed = await commitQueuedDocument({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId,
        requestId: queued.requestId,
        expectedRevision: base.revision,
    });
    assert.equal(committed.status, "committed");
    const persisted = await readFile(fixture.documentPath, "utf8");
    assert.match(persisted, /# Renamed rulebook/);
    assert.match(persisted, /## Notes/);
    assert.doesNotMatch(persisted, /## Summary/);
});

test("rejects commit when supplied expected revision matches current but draft base is stale", async (t) => {
    const fixture = await createFixtureRoot("stale-base-under-lock");
    t.after(async () => rm(fixture.root, { recursive: true, force: true }));
    const sessionId = "owner-session";

    const base = readDocumentWithDraft({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId,
    });
    const saved = await saveDocumentDraft({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId,
        markdown: withCriteriaUpdate(BLUEPRINT_TEXT, "C0-10 stale-base check"),
        baseRevision: base.revision,
        expectedDraftRevision: null,
    });
    await writeFile(
        fixture.documentPath,
        withCriteriaUpdate(BLUEPRINT_TEXT, "C0-10 worker changed current bytes"),
        "utf8",
    );
    const current = readDocumentWithDraft({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId,
    });
    const queued = await queueDocumentApply({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId,
        expectedDraftRevision: saved.draft.revision,
    });
    await assert.rejects(
        () =>
            commitQueuedDocument({
                draftRoot: fixture.root,
                documentPath: fixture.documentPath,
                sessionId,
                requestId: queued.requestId,
                expectedRevision: current.revision,
            }),
        (error) => {
            assert.equal(error.status, 409);
            assert.equal(error.conflict?.expectedBaseRevision, base.revision);
            return true;
        },
    );
});

test("preserves existing document mode when atomic commit replaces file", async (t) => {
    const fixture = await createFixtureRoot("preserve-file-mode");
    t.after(async () => rm(fixture.root, { recursive: true, force: true }));
    const sessionId = "owner-session";

    await chmod(fixture.documentPath, 0o600);
    const baseline = readDocumentWithDraft({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId,
    });
    const saved = await saveDocumentDraft({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId,
        markdown: withCriteriaUpdate(BLUEPRINT_TEXT, "C0-10 Preserve existing mode."),
        baseRevision: baseline.revision,
        expectedDraftRevision: null,
    });
    const queued = await queueDocumentApply({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId,
        expectedDraftRevision: saved.draft.revision,
    });
    await commitQueuedDocument({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId,
        requestId: queued.requestId,
        expectedRevision: baseline.revision,
    });

    const mode = (await stat(fixture.documentPath)).mode & 0o777;
    assert.equal(mode, 0o600);
});

test("writes draft artifacts with private file modes", async (t) => {
    const fixture = await createFixtureRoot("private-artifacts");
    t.after(async () => rm(fixture.root, { recursive: true, force: true }));
    const sessionId = "owner-session";

    const baseline = readDocumentWithDraft({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId,
    });
    const first = await saveDocumentDraft({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId,
        markdown: withCriteriaUpdate(BLUEPRINT_TEXT, "C0-10 Private artifact baseline."),
        baseRevision: baseline.revision,
        expectedDraftRevision: null,
    });

    const key = draftKey(sessionId, fixture.documentPath);
    const draftPath = resolve(dirname(fixture.documentPath), ".drafts", `${key}.json`);
    const draftMode = (await stat(draftPath)).mode & 0o777;
    assert.equal(draftMode, 0o600);

    let conflictError;
    try {
        await saveDocumentDraft({
            draftRoot: fixture.root,
            documentPath: fixture.documentPath,
            sessionId,
            markdown: withCriteriaUpdate(BLUEPRINT_TEXT, "C0-10 Conflict copy."),
            baseRevision: baseline.revision,
            expectedDraftRevision: null,
        });
        assert.fail("Expected duplicate draft save to fail.");
    } catch (error) {
        conflictError = error;
    }
    assert.equal(conflictError.status, 409);
    assert.equal(typeof conflictError.conflict?.retainedDraftPath, "string");
    const conflictMode = (await stat(conflictError.conflict.retainedDraftPath)).mode & 0o777;
    assert.equal(conflictMode, 0o600);

    assert.equal(first.draft.status, "saved");
});

test("recovers from abandoned lock files", async (t) => {
    const fixture = await createFixtureRoot("stale-lock");
    t.after(async () => rm(fixture.root, { recursive: true, force: true }));
    const sessionId = "owner-session";
    const key = draftKey(sessionId, fixture.documentPath);
    const lockPath = resolve(fixture.root, ".drafts", `${key}.lock`);
    await mkdir(resolve(fixture.root, ".drafts"), { recursive: true });
    await writeFile(lockPath, JSON.stringify({
        pid: 999999,
        acquiredAt: new Date(Date.now() - 60_000).toISOString(),
    }), "utf8");

    const baseline = readDocumentWithDraft({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId,
    });
    const saved = await saveDocumentDraft({
        draftRoot: fixture.root,
        documentPath: fixture.documentPath,
        sessionId,
        markdown: withCriteriaUpdate(BLUEPRINT_TEXT, "C0-10 lock recovered"),
        baseRevision: baseline.revision,
        expectedDraftRevision: null,
    });
    assert.equal(saved.draft.status, "saved");
});
