// Wiki calculations and guarded write interfaces.
// Run: node --test  (from this directory)

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { queueDocumentApply } from "../minime-flow/lib/document-store.mjs";

import {
    classify,
    parseMeta,
    patchMeta,
    buildTree,
    buildFileTree,
    searchCorpus,
    computeStats,
    findDuplicates,
    safeResolve,
    renderMarkdown,
    escapeHtml,
    parseBlueprintMeta,
    buildBlueprintTree,
    isBlueprintPath,
    readArticle,
    resolveScopeMode,
    saveDraft,
    scopeCorpus,
    writeArticle,
    rateArticle,
} from "./wiki.mjs";

/* ── shared fixtures ── */

const TOPIC = `# Private endpoints are per-stamp
**Summary:** enablePrivateEndpoints gives every stamp its own VNet and private endpoints.
- **Scope:** \`infra/**\`
- **LastVerified:** 2026-06-21
## Rules
- Flag + CIDR threading through modules.
`;

const ENTRY = `# Git safety: never stage or rebase

- **Summary:** The agent edits files only; the user stages and commits.
- **Trigger:** Any task that touches git state.
- **Scope:** All repositories.
- **ValueScore:** 8
- **Confidence:** high
- **Status:** active
- **LastVerified:** 2026-06-21
`;

// A corpus with deliberately *uneven* shape so aggregation is actually exercised:
// org "a" has 2 repos (one with 2 articles), org "b" has 1, plus a pattern + raw.
const CORPUS = [
    doc("wiki/orgs/a/repo1/private-endpoints.md", "Private endpoints per stamp", "VNet and private endpoints for stamps", { lastverified: "2026-06-21", confidence: "high" }),
    doc("wiki/orgs/a/repo1/private-network.md", "Private network per stamp", "VNet subnets and stamps", { lastverified: "2020-01-01", confidence: "low" }),
    doc("wiki/orgs/a/repo2/kql-prev.md", "KQL prev default type", "prev() default must match column", { lastverified: "2026-06-19" }),
    doc("wiki/orgs/b/repoX/bicep-deps.md", "Prefer implicit Bicep dependencies", "implicit dependsOn via property references", {}),
    doc("wiki/patterns/git-safety.md", "Git safety never stage", "agent edits files only", { confidence: "high" }),
    doc("raw/a/repo1/private-endpoints-2026-06-21.md", "raw source", "raw distilled source about private endpoints VNet", {}),
];

function doc(relPath, title, summary, fields) {
    const c = classify(relPath);
    const fieldText = Object.entries(fields).map(([k, v]) => `- **${cap(k)}:** ${v}`).join("\n");
    const text = `# ${title}\n- **Summary:** ${summary}\n${fieldText}\n`;
    const meta = parseMeta(text);
    return { relPath, ...c, title, summary, meta, text };
}
function cap(k) {
    return ({ lastverified: "LastVerified", valuescore: "ValueScore" })[k] || k[0].toUpperCase() + k.slice(1);
}

/* ── parseMeta: one rich fixture, many asserts (input identical → don't parametrize) ── */

test("parseMeta extracts title/summary/fields from topic-page style", () => {
    const m = parseMeta(TOPIC);
    assert.equal(m.title, "Private endpoints are per-stamp");
    assert.match(m.summary, /enablePrivateEndpoints/);
    assert.equal(m.scope, "`infra/**`");
    assert.equal(m.lastVerified, "2026-06-21");
});

test("parseMeta extracts template-entry style fields", () => {
    const m = parseMeta(ENTRY);
    assert.equal(m.confidence, "high");
    assert.equal(m.status, "active");
    assert.equal(m.valueScore, "8");
    assert.equal(m.trigger, "Any task that touches git state.");
});

/* ── classify: parametrized over path shapes (varied inputs) ── */

const CLASSIFY_CASES = [
    ["wiki/orgs/abossard/always-on-v2/x.md", { area: "wiki", org: "abossard", repo: "always-on-v2", name: "x" }],
    ["wiki\\orgs\\abossard\\always-on-v2\\x.md", { area: "wiki", org: "abossard", repo: "always-on-v2", name: "x" }],
    ["wiki/patterns/git-safety.md", { area: "pattern", org: null, repo: null, name: "git-safety" }],
    ["raw/abossard/cmux/note.md", { area: "raw", org: "abossard", repo: "cmux", name: "note" }],
    ["schema.md", { area: "other", org: null, repo: null, name: "schema" }],
];
for (const [input, expected] of CLASSIFY_CASES) {
    test(`classify ${input}`, () => assert.deepEqual(classify(input), expected));
}

/* ── safeResolve: parametrized — escapes throw, valid resolves under root ── */

const ROOT = "/virtual/minime-root";
const ESCAPES = ["../etc/passwd", "/etc/passwd", "wiki/../../secret", "", "   "];
for (const bad of ESCAPES) {
    test(`safeResolve rejects ${JSON.stringify(bad)}`, () => {
        assert.throws(() => safeResolve(ROOT, bad));
    });
}
test("safeResolve accepts an in-root path", () => {
    assert.equal(safeResolve(ROOT, "wiki/orgs/a/b/x.md"), `${ROOT}/wiki/orgs/a/b/x.md`);
});

test("resolveScopeMode falls back to global when current repo is unknown", () => {
    assert.equal(resolveScopeMode("current", null), "all");
    assert.equal(resolveScopeMode(undefined, null), "all");
    assert.equal(resolveScopeMode(undefined, { org: "a", repo: "r" }), "current");
});

test("scopeCorpus current preset keeps current repo wiki/raw plus shared patterns", () => {
    const scoped = scopeCorpus(CORPUS, { mode: "current", currentRepository: { org: "a", repo: "repo1" } });
    assert.deepEqual(
        scoped.map((d) => d.relPath).sort(),
        [
            "raw/a/repo1/private-endpoints-2026-06-21.md",
            "wiki/orgs/a/repo1/private-endpoints.md",
            "wiki/orgs/a/repo1/private-network.md",
            "wiki/patterns/git-safety.md",
        ].sort(),
    );
});

/* ── write/read actions: guarded writes + shared helper integration ── */

async function withScratchRoot(name, run) {
    const base = path.join(process.cwd(), ".test-work");
    const root = path.join(base, `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    await mkdir(root, { recursive: true });
    try {
        return await run(root);
    } finally {
        await rm(root, { recursive: true, force: true });
        try { await rm(base); } catch {}
    }
}

async function seedMarkdown(root, relPath, markdown) {
    const abs = path.join(root, relPath);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, markdown, "utf8");
    return abs;
}

test("metadata edits reject unsaved text and apply changes with an unchanged draft", async () => {
    await withScratchRoot("metadata-draft", async (root) => {
        const relPath = "wiki/orgs/acme/repo/rule.md";
        const original = "# Rule\n\n- **Status:** active\n";
        const file = await seedMarkdown(root, relPath, original);
        const article = await readArticle(root, relPath);
        const options = { expectedRevision: article.revision, draftSessionKey: "metadata-editor" };
        await assert.rejects(() => rateArticle(root, relPath, { status: "stale" }, {
            ...options, draft: { content: "# Unsaved text\n", baseRevision: article.revision },
        }), /Save article text before changing properties/);
        assert.equal(await readFile(file, "utf8"), original);
        await rateArticle(root, relPath, { status: "stale" }, {
            ...options, draft: { content: original, baseRevision: article.revision },
        });
        assert.match(await readFile(file, "utf8"), /Status:\*\* stale/);
    });
});

test("writeArticle rejects missing expectedRevision", async () => {
    await withScratchRoot("wiki-no-rev", async (root) => {
        const relPath = "wiki/orgs/acme/repo/rule.md";
        await seedMarkdown(root, relPath, "# Base\n- **Summary:** old\n");
        await assert.rejects(
            () => writeArticle(root, relPath, "# x\n", { draftSessionKey: "edit:no-rev" }),
            (error) => error?.status === 422 && error?.code === "expected_revision_required",
        );
    });
});

test("writeArticle keeps raw and blueprints read-only", async () => {
    await assert.rejects(
        () => writeArticle(".", "raw/a/r/source.md", "# x\n", { expectedRevision: "rev-1", draftSessionKey: "s1" }),
        (error) => error?.status === 403 && error?.code === "read_only",
    );
    await assert.rejects(
        () => writeArticle(".", "abossard/_repo/blueprints/2026-09-16-test.md", "# x\n", { expectedRevision: "rev-1", draftSessionKey: "s1" }),
        (error) => error?.status === 403 && error?.code === "read_only",
    );
});

test("drafts are keyed by document and draft session key", async () => {
    await withScratchRoot("wiki-drafts", async (root) => {
        const relPath = "wiki/orgs/acme/repo/draft-key.md";
        await seedMarkdown(root, relPath, "# Base\n- **Summary:** base\n");
        const base = await readArticle(root, relPath, { draftSessionKey: "edit-A" });

        await saveDraft(root, relPath, { content: "# Draft A\n", baseRevision: base.revision }, {
            draftSessionKey: "edit-A",
        });

        const asA = await readArticle(root, relPath, { draftSessionKey: "edit-A" });
        const asB = await readArticle(root, relPath, { draftSessionKey: "edit-B" });
        assert.equal(asA.markdown, "# Draft A\n");
        assert.equal(asA.draft?.content, "# Draft A\n");
        assert.ok(asA.draft?.revision);
        assert.equal(asB.markdown, "# Base\n- **Summary:** base\n");
        assert.equal(asB.draft, null);
    });
});

test("saveDraft enforces expectedDraftRevision CAS", async () => {
    await withScratchRoot("wiki-draft-cas", async (root) => {
        const relPath = "wiki/orgs/acme/repo/draft-cas.md";
        await seedMarkdown(root, relPath, "# Draft\n- **Summary:** base\n");
        const initial = await readArticle(root, relPath, { draftSessionKey: "draft:cas" });
        const first = await saveDraft(root, relPath, {
            content: "# Draft\n- **Summary:** one\n",
            baseRevision: initial.revision,
        }, {
            draftSessionKey: "draft:cas",
        });
        const second = await saveDraft(root, relPath, {
            content: "# Draft\n- **Summary:** two\n",
            baseRevision: initial.revision,
        }, {
            draftSessionKey: "draft:cas",
            expectedDraftRevision: first.draft.revision,
        });
        assert.notEqual(second.draft.revision, first.draft.revision);

        await assert.rejects(
            () => saveDraft(root, relPath, {
                content: "# Draft\n- **Summary:** stale\n",
                baseRevision: initial.revision,
            }, {
                draftSessionKey: "draft:cas",
                expectedDraftRevision: first.draft.revision,
            }),
            (error) =>
                error?.status === 409 &&
                error?.code === "conflict" &&
                typeof error?.retainedDraftPath === "string",
        );
    });
});

test("saveDraft rejects queued overwrite and returns retained draft metadata", async () => {
    await withScratchRoot("wiki-draft-queued", async (root) => {
        const relPath = "wiki/orgs/acme/repo/draft-queued.md";
        const sessionId = "draft:queued";
        await seedMarkdown(root, relPath, "# Draft\n- **Summary:** base\n");
        const initial = await readArticle(root, relPath, { draftSessionKey: sessionId });
        const first = await saveDraft(root, relPath, {
            content: "# Draft\n- **Summary:** queued\n",
            baseRevision: initial.revision,
        }, {
            draftSessionKey: sessionId,
        });
        const queued = await queueDocumentApply({
            draftRoot: root,
            documentPath: path.join(root, relPath),
            sessionId,
            expectedDraftRevision: first.draft.revision,
        });
        assert.ok(queued.requestId);

        await assert.rejects(
            () => saveDraft(root, relPath, {
                content: "# Draft\n- **Summary:** overwrite attempt\n",
                baseRevision: initial.revision,
            }, {
                draftSessionKey: sessionId,
                expectedDraftRevision: first.draft.revision,
            }),
            (error) =>
                error?.status === 409 &&
                error?.code === "conflict" &&
                error?.currentRequestId === queued.requestId &&
                typeof error?.retainedDraftPath === "string",
        );
    });
});

test("writeArticle rejects symlink write paths", async () => {
    await withScratchRoot("wiki-symlink", async (root) => {
        const outside = path.join(root, "outside.md");
        await writeFile(outside, "# Outside\n", "utf8");
        const relPath = "wiki/orgs/acme/repo/link.md";
        const linkAbs = path.join(root, relPath);
        await mkdir(path.dirname(linkAbs), { recursive: true });
        await symlink(outside, linkAbs);
        await assert.rejects(
            () => writeArticle(root, relPath, "# nope\n", { expectedRevision: "rev-1", draftSessionKey: "edit:symlink" }),
            (error) => error?.status === 400 && error?.code === "path_escape",
        );
    });
});

test("writeArticle and rateArticle reject wiki alias paths resolving into raw", async () => {
    await withScratchRoot("wiki-alias-raw", async (root) => {
        await seedMarkdown(root, "raw/acme/repo/source.md", "# Raw\n");
        await mkdir(path.join(root, "wiki"), { recursive: true });
        await symlink(path.join(root, "raw", "acme", "repo"), path.join(root, "wiki", "alias"));

        await assert.rejects(
            () => writeArticle(root, "wiki/alias/source.md", "# Nope\n", {
                expectedRevision: "rev-1",
                draftSessionKey: "alias:write",
            }),
            (error) => error?.status === 400 && error?.code === "path_escape",
        );

        await assert.rejects(
            () => rateArticle(root, "wiki/alias/source.md", { status: "stale" }, {
                expectedRevision: "rev-1",
                draftSessionKey: "alias:rate",
            }),
            (error) => error?.status === 400 && error?.code === "path_escape",
        );
    });
});

test("writeArticle rejects writes when wiki root is a symlink", async () => {
    await withScratchRoot("wiki-root-symlink", async (root) => {
        await mkdir(path.join(root, "raw"), { recursive: true });
        await symlink(path.join(root, "raw"), path.join(root, "wiki"));
        await assert.rejects(
            () => writeArticle(root, "wiki/orgs/acme/repo/new.md", "# x\n", {
                createOnly: true,
                expectedRevision: null,
                draftSessionKey: "wiki-root-link",
            }),
            (error) => error?.status === 400 && error?.code === "path_escape",
        );
    });
});

test("writeArticle supports explicit create-only for new files", async () => {
    await withScratchRoot("wiki-create-only", async (root) => {
        const relPath = "wiki/orgs/acme/repo/new-note.md";
        const created = await writeArticle(root, relPath, "# New note\n", {
            createOnly: true,
            expectedRevision: null,
            draftSessionKey: "create:1",
        });
        assert.equal(created.created, true);
        assert.match(created.revision, /^[a-f0-9]{64}$/);
        assert.equal(await readFile(path.join(root, relPath), "utf8"), "# New note\n");

        await assert.rejects(
            () => writeArticle(root, relPath, "# replaced\n", {
                createOnly: true,
                expectedRevision: null,
                draftSessionKey: "create:2",
            }),
            (error) => error?.status === 409 && error?.code === "conflict",
        );
    });
});

test("writeArticle requires expectedRevision value for create-only writes", async () => {
    await withScratchRoot("wiki-create-missing-rev", async (root) => {
        const relPath = "wiki/orgs/acme/repo/new-note.md";
        await assert.rejects(
            () => writeArticle(root, relPath, "# New note\n", {
                createOnly: true,
                draftSessionKey: "create:missing-revision",
            }),
            (error) => error?.status === 422 && error?.code === "expected_revision_required",
        );
    });
});

test("writeArticle accepts opaque expectedRevision for create-only writes", async () => {
    await withScratchRoot("wiki-create-opaque-rev", async (root) => {
        const relPath = "wiki/orgs/acme/repo/new-note.md";
        const created = await writeArticle(root, relPath, "# New note\n", {
            createOnly: true,
            expectedRevision: "new",
            draftSessionKey: "create:opaque",
        });
        assert.equal(created.created, true);
        assert.match(created.revision, /^[a-f0-9]{64}$/);
    });
});

test("writeArticle rejects mismatched create-only draft baseRevision", async () => {
    await withScratchRoot("wiki-create-base-mismatch", async (root) => {
        const relPath = "wiki/orgs/acme/repo/new-note.md";
        await assert.rejects(
            () => writeArticle(root, relPath, "# New note\n", {
                createOnly: true,
                expectedRevision: "new",
                draftSessionKey: "create:base-mismatch",
                draft: {
                    content: "# New note\n",
                    baseRevision: "other",
                },
            }),
            (error) => error?.status === 422 && error?.code === "bad_input",
        );
    });
});

test("writeArticle rejects missing files without createOnly", async () => {
    await withScratchRoot("wiki-missing", async (root) => {
        await assert.rejects(
            () => writeArticle(root, "wiki/orgs/acme/repo/missing.md", "# nope\n", {
                expectedRevision: "rev-1",
                draftSessionKey: "missing:1",
            }),
            (error) => error?.status === 404 && error?.code === "not_found",
        );
    });
});

test("rateArticle applies metadata through guarded write path", async () => {
    await withScratchRoot("wiki-rate", async (root) => {
        const relPath = "wiki/orgs/acme/repo/rate.md";
        await seedMarkdown(root, relPath, "# Rate me\n- **Summary:** old\n");
        const current = await readArticle(root, relPath, { draftSessionKey: "rate:1" });
        const result = await rateArticle(root, relPath, { confidence: "high", status: "active" }, {
            expectedRevision: current.revision,
            draftSessionKey: "rate-1",
        });
        assert.deepEqual(result.updated.sort(), ["confidence", "status"]);
        assert.match(result.revision, /^[a-f0-9]{64}$/);
        const saved = await readFile(path.join(root, relPath), "utf8");
        assert.match(saved, /\*\*Confidence:\*\* high/);
        assert.match(saved, /\*\*Status:\*\* active/);
    });
});

test("shared document-store enforces cross-session expectedRevision conflicts", async () => {
    await withScratchRoot("wiki-shared-conflict", async (root) => {
        const relPath = "wiki/orgs/acme/repo/shared.md";
        await seedMarkdown(root, relPath, "# Shared\n- **Summary:** base\n");

        const firstRead = await readArticle(root, relPath, {
            draftSessionKey: "shared:s1",
        });
        assert.ok(firstRead.revision);

        const firstWrite = await writeArticle(root, relPath, "# Shared\n- **Summary:** first\n", {
            expectedRevision: firstRead.revision,
            draftSessionKey: "shared:s1",
            draft: { content: "# Shared\n- **Summary:** first\n", baseRevision: firstRead.revision },
        });
        assert.ok(firstWrite.revision);

        await assert.rejects(
            () => writeArticle(root, relPath, "# Shared\n- **Summary:** second\n", {
                expectedRevision: firstRead.revision,
                draftSessionKey: "shared:s2",
                draft: { content: "# Shared\n- **Summary:** second\n", baseRevision: firstRead.revision },
            }),
            (error) =>
                error?.status === 409 &&
                error?.code === "conflict" &&
                typeof error?.currentRevision === "string",
        );
        assert.match(await readFile(path.join(root, relPath), "utf8"), /Summary:\*\* first/);
    });
});

test("shared document-store supports draft CAS updates with expectedDraftRevision", async () => {
    await withScratchRoot("wiki-shared-draft-cas", async (root) => {
        const relPath = "wiki/orgs/acme/repo/shared-draft.md";
        await seedMarkdown(root, relPath, "# Draft\n- **Summary:** base\n");

        const initial = await readArticle(root, relPath, {
            draftSessionKey: "shared:edit",
        });
        const first = await saveDraft(root, relPath, {
            content: "# Draft\n- **Summary:** local 1\n",
            baseRevision: initial.revision,
        }, {
            draftSessionKey: "shared:edit",
        });
        assert.ok(first.draft?.revision);

        const second = await saveDraft(root, relPath, {
            content: "# Draft\n- **Summary:** local 2\n",
            baseRevision: initial.revision,
        }, {
            draftSessionKey: "shared:edit",
            expectedDraftRevision: first.draft.revision,
        });
        assert.notEqual(second.draft?.revision, first.draft?.revision);
        assert.equal(second.draft?.content, "# Draft\n- **Summary:** local 2\n");

        await assert.rejects(
            () => saveDraft(root, relPath, {
                content: "# Draft\n- **Summary:** stale\n",
                baseRevision: initial.revision,
            }, {
                draftSessionKey: "shared:edit",
                expectedDraftRevision: first.draft.revision,
            }),
            (error) => error?.status === 409 && error?.code === "conflict",
        );
    });
});

/* ── searchCorpus: parametrized queries that MUST produce different results ── */

const SEARCH_CASES = [
    { q: "private endpoints", top: "wiki/orgs/a/repo1/private-endpoints.md", minHits: 3 },
    { q: "kql prev", top: "wiki/orgs/a/repo2/kql-prev.md", minHits: 1 },
    { q: "bicep", top: "wiki/orgs/b/repoX/bicep-deps.md", minHits: 1 },
];
for (const { q, top, minHits } of SEARCH_CASES) {
    test(`searchCorpus "${q}" ranks ${top} first`, () => {
        const res = searchCorpus(CORPUS, q);
        assert.ok(res.length >= minHits, `expected >= ${minHits} hits, got ${res.length}`);
        assert.equal(res[0].relPath, top);
        assert.ok(res[0].score > 0 && res[0].snippet.length > 0);
    });
}
test("searchCorpus returns nothing for an empty query", () => {
    assert.deepEqual(searchCorpus(CORPUS, "   "), []);
});

/* ── buildTree: uneven corpus exercises aggregation (counts differ) ── */

test("buildTree groups orgs/repos with correct, varied counts", () => {
    const tree = buildTree(CORPUS);
    const orgA = tree.orgs.find((o) => o.org === "a");
    assert.equal(orgA.repos.length, 2);
    assert.equal(orgA.repos.find((r) => r.repo === "repo1").count, 2);
    assert.equal(orgA.repos.find((r) => r.repo === "repo2").count, 1);
    assert.equal(tree.patterns.length, 1);
    assert.equal(tree.counts.raw, 1);
});

/* ── buildFileTree: real nested folder/file tree, dirs-before-files ── */

test("buildFileTree nests folders, sorts dirs before files, keeps full paths", () => {
    const top = buildFileTree(CORPUS);
    const names = top.map((n) => n.name);
    assert.deepEqual(names, ["raw", "wiki"]); // dirs alpha
    const wiki = top.find((n) => n.name === "wiki");
    const orgs = wiki.children.find((n) => n.name === "orgs");
    const a = orgs.children.find((n) => n.name === "a");
    const repo1 = a.children.find((n) => n.name === "repo1");
    assert.equal(repo1.type, "dir");
    const files = repo1.children;
    assert.ok(files.every((f) => f.type === "file"));
    assert.equal(files[0].path, "wiki/orgs/a/repo1/private-endpoints.md");
    // patterns folder present under wiki, files carry their area
    const patterns = wiki.children.find((n) => n.name === "patterns");
    assert.equal(patterns.children[0].area, "pattern");
});

/* ── computeStats + findDuplicates ── */

test("computeStats flags stale + low-confidence and detects the dup pair", () => {
    const stats = computeStats(CORPUS, { today: new Date("2026-06-27"), staleDays: 120 });
    assert.equal(stats.byArea.raw, 1);
    assert.ok(stats.stale.some((s) => s.relPath.endsWith("private-network.md")));
    assert.ok(stats.lowConfidence.some((s) => s.relPath.endsWith("private-network.md")));
    const dup = stats.duplicates.find(
        (d) => d.a.endsWith("private-endpoints.md") && d.b.endsWith("private-network.md"),
    );
    assert.ok(dup && dup.score >= 0.5, "expected the two private-* titles to be flagged as duplicates");
});

test("findDuplicates ignores unrelated titles", () => {
    const docs = [
        { relPath: "x.md", name: "alpha thing", title: "alpha thing" },
        { relPath: "y.md", name: "beta widget", title: "beta widget" },
    ];
    assert.equal(findDuplicates(docs).length, 0);
});

/* ── patchMeta: update existing + insert missing ── */

test("patchMeta replaces an existing field and inserts a missing one", () => {
    const out = patchMeta(TOPIC, { lastVerified: "2026-06-27", status: "active" });
    assert.match(out, /- \*\*LastVerified:\*\* 2026-06-27/);
    assert.doesNotMatch(out, /2026-06-21/);
    assert.match(out, /- \*\*Status:\*\* active/);
});

/* ── markdown render: injection safety + structure ── */

test("renderMarkdown escapes HTML and keeps structure", () => {
    const html = renderMarkdown("# Hi <script>alert(1)</script>\n- a\n- b\n");
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /<ul>\n<li>a<\/li>/);
});

test("escapeHtml neutralizes quotes and brackets", () => {
    assert.equal(escapeHtml(`<a href="x">'&`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
});

/* ── renderMarkdown: tables, task lists, hr ── */

test("renderMarkdown renders a GFM table", () => {
    const html = renderMarkdown("| A | B |\n| --- | --- |\n| 1 | `x` |\n");
    assert.match(html, /<table><thead><tr><th>A<\/th><th>B<\/th><\/tr>/);
    assert.match(html, /<tbody><tr><td>1<\/td><td><code>x<\/code><\/td><\/tr>/);
});

test("renderMarkdown renders task checkboxes and hr", () => {
    const html = renderMarkdown("- [ ] todo\n- [x] done\n\n---\n");
    assert.match(html, /<li class="task ">/);
    assert.match(html, /<li class="task done">/);
    assert.match(html, /<hr\/>/);
});

/* ── blueprints ── */

const BLUEPRINT = `# Task: austin-powers-theming

Created: 2026-05-25  |  Status: planning  |  Repo: abossard/minime

## Goal
Apply Virtucon Labs theming to all skills.

## Acceptance criteria
- [x] AC1: skills renamed | Evidence: ls
- [ ] AC2: agents renamed | Evidence: ls
- [ ] AC3: refs updated | Evidence: grep
`;

test("parseBlueprintMeta extracts header + AC progress", () => {
    const m = parseBlueprintMeta(BLUEPRINT);
    assert.equal(m.title, "austin-powers-theming");
    assert.equal(m.created, "2026-05-25");
    assert.equal(m.status, "planning");
    assert.equal(m.repo, "abossard/minime");
    assert.match(m.goal, /Virtucon Labs theming/);
    assert.equal(m.acTotal, 3);
    assert.equal(m.acDone, 1);
});

const ISBP_CASES = [
    ["abossard/_minime/blueprints/2026-05-25-x.blueprint.md", true],
    ["abossard/_minime/blueprints/note.md", true],
    ["wiki/orgs/abossard/minime/x.md", false],
    ["raw/abossard/minime/blueprints-note.md", false],
];
for (const [p, exp] of ISBP_CASES) {
    test(`isBlueprintPath ${p} -> ${exp}`, () => assert.equal(isBlueprintPath(p), exp));
}

test("buildBlueprintTree groups by org/repo, newest first", () => {
    const bps = [
        { relPath: "abossard/_minime/blueprints/2026-05-20-a.md", org: "abossard", repo: "minime", name: "2026-05-20-a", created: "2026-05-20" },
        { relPath: "abossard/_minime/blueprints/2026-05-25-b.md", org: "abossard", repo: "minime", name: "2026-05-25-b", created: "2026-05-25" },
        { relPath: "One/_portal/blueprints/2026-06-01-c.md", org: "One", repo: "portal", name: "c", created: "2026-06-01" },
    ];
    const t = buildBlueprintTree(bps);
    assert.equal(t.count, 3);
    assert.deepEqual(t.orgs.map((o) => o.org), ["abossard", "One"]);
    const minime = t.orgs.find((o) => o.org === "abossard").repos[0];
    assert.equal(minime.count, 2);
    assert.equal(minime.items[0].created, "2026-05-25"); // newest first
});
