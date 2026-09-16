import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
    clearDraft,
    readDocument,
    readDraft,
    replaceDocument,
    saveDraft,
} from "./documents.mjs";

const BLUEPRINT_TEXT = `# Blueprint: Native integration

## Goal

Keep this file as the source of truth.
`;

async function createFixtureRoot(label) {
    const root = resolve(
        process.cwd(),
        `.github/extensions/minime-flow/lib/.test-work/${label}-${randomUUID()}`,
    );
    await mkdir(root, { recursive: true });
    const relPath = "wiki/orgs/acme/repo/rules.md";
    const documentPath = resolve(root, relPath);
    await mkdir(resolve(root, "wiki", "orgs", "acme", "repo"), { recursive: true });
    await writeFile(documentPath, BLUEPRINT_TEXT, "utf8");
    return { root, relPath, documentPath };
}

async function createMissingFixtureRoot(label) {
    const root = resolve(
        process.cwd(),
        `.github/extensions/minime-flow/lib/.test-work/${label}-${randomUUID()}`,
    );
    const relPath = "wiki/orgs/acme/repo/derived-rules.md";
    const documentPath = resolve(root, relPath);
    await mkdir(resolve(root, "wiki", "orgs", "acme", "repo"), { recursive: true });
    return { root, relPath, documentPath };
}

test("readDocument returns content, revision, and draft", async (t) => {
    const fixture = await createFixtureRoot("documents-read");
    t.after(async () => rm(fixture.root, { recursive: true, force: true }));
    const key = "wiki-session";

    const initial = await readDocument({
        root: fixture.root,
        relPath: fixture.relPath,
    });
    assert.equal(initial.content, BLUEPRINT_TEXT);
    assert.equal(typeof initial.revision, "string");
    assert.equal(initial.draft, null);

    await saveDraft({
        root: fixture.root,
        relPath: fixture.relPath,
        draftSessionKey: key,
        draft: {
            content: "# Drafted rule\n",
            baseRevision: initial.revision,
        },
    });
    const withDraft = await readDocument({
        root: fixture.root,
        relPath: fixture.relPath,
        draftSessionKey: key,
    });
    assert.equal(withDraft.content, BLUEPRINT_TEXT);
    assert.equal(withDraft.draft.content, "# Drafted rule\n");
    assert.equal(withDraft.draft.baseRevision, initial.revision);
});

test("replaceDocument requires expectedRevision", async (t) => {
    const fixture = await createFixtureRoot("documents-write-required");
    t.after(async () => rm(fixture.root, { recursive: true, force: true }));

    await assert.rejects(
        () =>
            replaceDocument({
                root: fixture.root,
                relPath: fixture.relPath,
                content: "# Updated\n",
            }),
        (error) => {
            assert.equal(error.status, 422);
            return true;
        },
    );
});

test("replaceDocument commits and clears draft", async (t) => {
    const fixture = await createFixtureRoot("documents-write");
    t.after(async () => rm(fixture.root, { recursive: true, force: true }));
    const key = "wiki-session";

    const current = await readDocument({
        root: fixture.root,
        relPath: fixture.relPath,
    });
    await saveDraft({
        root: fixture.root,
        relPath: fixture.relPath,
        draftSessionKey: key,
        draft: {
            content: `${BLUEPRINT_TEXT}\n## Decisions made\n\n- Drafted update.\n`,
            baseRevision: current.revision,
        },
    });

    const written = await replaceDocument({
        root: fixture.root,
        relPath: fixture.relPath,
        draftSessionKey: key,
        expectedRevision: current.revision,
        content: `${BLUEPRINT_TEXT}\n## Decisions made\n\n- Applied update.\n`,
    });
    assert.equal(typeof written.revision, "string");
    assert.match(await readFile(fixture.documentPath, "utf8"), /Applied update\./);

    const draft = await readDraft({
        root: fixture.root,
        relPath: fixture.relPath,
        draftSessionKey: key,
    });
    assert.equal(draft, null);
});

test("replaceDocument returns conflict object on stale expectedRevision", async (t) => {
    const fixture = await createFixtureRoot("documents-conflict");
    t.after(async () => rm(fixture.root, { recursive: true, force: true }));

    const current = await readDocument({
        root: fixture.root,
        relPath: fixture.relPath,
    });
    await writeFile(fixture.documentPath, "# Remote update\n", "utf8");

    const result = await replaceDocument({
        root: fixture.root,
        relPath: fixture.relPath,
        expectedRevision: current.revision,
        content: "# Local update\n",
    });
    assert.equal(result.conflict, true);
    assert.equal(typeof result.currentRevision, "string");
    assert.equal(result.currentContent, "# Remote update\n");
});

test("supports create-only writes with opaque expected revision token", async (t) => {
    const fixture = await createMissingFixtureRoot("documents-create-only");
    t.after(async () => rm(fixture.root, { recursive: true, force: true }));
    const key = "wiki-session";

    await assert.rejects(
        () =>
            readDocument({
                root: fixture.root,
                relPath: fixture.relPath,
            }),
        (error) => {
            assert.equal(error.status, 404);
            return true;
        },
    );

    const created = await replaceDocument({
        root: fixture.root,
        relPath: fixture.relPath,
        draftSessionKey: key,
        expectedRevision: "new",
        content: "# Derived rules\n",
    });
    assert.equal(typeof created.revision, "string");
    assert.equal(await readFile(fixture.documentPath, "utf8"), "# Derived rules\n");

    const stale = await replaceDocument({
        root: fixture.root,
        relPath: fixture.relPath,
        draftSessionKey: key,
        expectedRevision: "new",
        content: "# Derived rules v2\n",
    });
    assert.equal(stale.conflict, true);
    assert.equal(typeof stale.currentRevision, "string");
});

test("saveDraft and clearDraft round-trip", async (t) => {
    const fixture = await createFixtureRoot("documents-draft");
    t.after(async () => rm(fixture.root, { recursive: true, force: true }));
    const key = "wiki-session";

    const current = await readDocument({
        root: fixture.root,
        relPath: fixture.relPath,
    });
    const saved = await saveDraft({
        root: fixture.root,
        relPath: fixture.relPath,
        draftSessionKey: key,
        draft: {
            content: "# Draft v1\n",
            baseRevision: current.revision,
        },
    });
    assert.equal(saved.content, "# Draft v1\n");
    const loaded = await readDraft({
        root: fixture.root,
        relPath: fixture.relPath,
        draftSessionKey: key,
    });
    assert.equal(loaded.content, "# Draft v1\n");

    await clearDraft({
        root: fixture.root,
        relPath: fixture.relPath,
        draftSessionKey: key,
    });
    const cleared = await readDraft({
        root: fixture.root,
        relPath: fixture.relPath,
        draftSessionKey: key,
    });
    assert.equal(cleared, null);
});
