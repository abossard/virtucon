// The board the command line and the Copilot canvas share: page, token and actions. No workers start.
// Run: node --test  (from this directory)

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { newRun } from "./flow.mjs";
import { removedTestLines, startBoard, treeHash } from "./minime.mjs";

async function board(t, seed) {
    const repo = mkdtempSync(path.join(tmpdir(), "board-repo-"));
    spawnSync("git", ["init", "-q"], { cwd: repo });
    spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "x"], { cwd: repo });
    const hq = mkdtempSync(path.join(tmpdir(), "board-hq-"));
    const b = await startBoard({ repo, hq, state: seed?.(hq, repo) });
    t.after(() => b.close());
    const url = new URL(b.url);
    return { b, hq, repo, origin: url.origin, token: url.searchParams.get("t") };
}

test("the page is served with a per-response nonce, no referrer and no inline code from elsewhere", async (t) => {
    const { origin } = await board(t);
    const res = await fetch(`${origin}/`);
    const html = await res.text();
    const nonce = res.headers.get("content-security-policy").match(/script-src 'nonce-([^']+)'/)[1];
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    assert.match(res.headers.get("content-security-policy"), /default-src 'none'; connect-src 'self'/);
    assert.ok(html.includes(`<script nonce="${nonce}">`) && html.includes(`<style nonce="${nonce}">`));
    assert.ok(!/style="/.test(html), "inline style attributes would be blocked by the policy");
});

for (const [name, method, pathname, headers] of [
    ["reading state without the token", "GET", "/state", {}],
    ["reading state with a wrong token", "GET", "/state", { "x-minime-token": "nope" }],
    ["starting a task without the token", "POST", "/start", {}],
    ["stopping without the token", "POST", "/stop", {}],
    ["sending a correction without the token", "POST", "/learn", {}],
    ["editing the blueprint without the token", "POST", "/blueprint", {}],
]) {
    test(`board refuses ${name}`, async (t) => {
        const { origin } = await board(t);
        const res = await fetch(`${origin}${pathname}`, { method, headers, ...(method === "POST" ? { body: JSON.stringify({ text: "x" }) } : {}) });
        assert.equal(res.status, 403);
    });
}

test("the tree hash is stable until a tracked or an untracked file changes", async (t) => {
    const { repo } = await board(t);
    writeFileSync(path.join(repo, "a.js"), "1");
    spawnSync("git", ["-C", repo, "add", "a.js"], { cwd: repo });
    spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "a"], { cwd: repo });
    const clean = treeHash(repo);
    assert.equal(treeHash(repo), clean);
    writeFileSync(path.join(repo, "a.js"), "2");
    const edited = treeHash(repo);
    assert.notEqual(edited, clean);
    writeFileSync(path.join(repo, "new.js"), "3");
    assert.notEqual(treeHash(repo), edited);
    assert.match(clean, /^[0-9a-f]{12}$/);
});

test("the view carries the tree, the verdict and whether a PAUSED file holds the run", async (t) => {
    const { origin, token, hq, b } = await board(t, (hq, repo) => ({ ...newRun({ task: "x", repo, hq, plugin: "p", now: 0 }), status: "stopped", stage: null }));
    const headers = { "x-minime-token": token };
    const view = await (await fetch(`${origin}/state`, { headers })).json();
    assert.match(view.tree, /^[0-9a-f]{12}$/);
    assert.deepEqual(view.verdict, { proven: false, gaps: ["no criteria", "no inspection", "no findings count"] });
    assert.equal(view.pausedByFile, false);
    writeFileSync(path.join(hq, "PAUSED"), "");
    assert.equal(b.conductor.view().pausedByFile, true);
});

test("with the token, the board reads an idle run and accepts stop before any task", async (t) => {
    const { origin, token } = await board(t);
    const headers = { "x-minime-token": token };
    assert.deepEqual(await (await fetch(`${origin}/state`, { headers })).json(), { state: null });
    assert.equal((await fetch(`${origin}/stop`, { method: "POST", headers })).status, 200);
    assert.equal((await fetch(`${origin}/nothing`, { method: "POST", headers })).status, 404);
});

test("two boards run side by side on their own ports and tokens", async (t) => {
    const first = await board(t);
    const second = await board(t);
    assert.notEqual(first.origin, second.origin);
    assert.notEqual(first.token, second.token);
    assert.equal((await fetch(`${second.origin}/state`, { headers: { "x-minime-token": first.token } })).status, 403);
});

test("closing a board frees its port and keeps no run file for a board that never started", async (t) => {
    const { b, origin, hq } = await board(t);
    await b.close();
    await assert.rejects(fetch(`${origin}/state`));
    assert.deepEqual(readdirSync(path.join(hq, "conductor")), []);
});

const BLUEPRINT = `# Blueprint: due-dates

Repo: acme/todo | Created: 2026-10-22 | Extracted: 2026-10-23

## Inputs

- **I1** (2026-10-22 09:14):
  > add a --due flag so I can sort by due date

## Criteria

- **C1** (I1 "sort by due date"): When the user passes \`--due\`, the list command shall print items sorted by due date. [data: src/store.js:42] [ran: node src/cli.js list --due → items in order]

## Boundaries

| ID | Owner | Contract | Change | Criteria |
|----|-------|----------|--------|----------|
| B1 | \`src/cli.js\` parseArgs | argv → options | changed | C1 |
| B2 | \`src/store.js\` sortByDue | items → sorted items | new | C1 |
`;

// A finished run on a blueprint in the hq, as the conductor would leave it.
const finished = (status = "done", text = BLUEPRINT) => (hq, repo) => {
    const file = path.join(hq, "acme", "_todo", "blueprints", "2026-10-22-due-dates.md");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
    return { ...newRun({ task: "x", repo, hq, plugin: "p", now: 0 }), status, stage: null, blueprint: file };
};
const edit = ({ origin, token }, body) => fetch(`${origin}/blueprint`, { method: "POST", headers: { "x-minime-token": token }, body: JSON.stringify(body) });
const rows = (b) => ({ boundaries: b });
const BOUNDARIES = [
    { id: "B1", owner: "`src/cli.js` parseArgs", contract: "argv → options", change: "changed", criteria: ["C1"] },
    { id: "B2", owner: "`src/store.js` sortByDue", contract: "items → sorted items", change: "new", criteria: ["C1"] },
];

test("a seeded lean blueprint (no decisions, no flows) shows its boundaries and proof on the board", async (t) => {
    const ctx = await board(t, finished());
    const view = await (await fetch(`${ctx.origin}/state`, { headers: { "x-minime-token": ctx.token } })).json();
    assert.equal(view.board.error, undefined);
    assert.deepEqual(view.board.boundaries.map((b) => [b.id, b.change, b.criteria]), [["B1", "changed", ["C1"]], ["B2", "new", ["C1"]]]);
    assert.deepEqual(view.board.criteria.map((c) => [c.id, c.quote, c.evidence, c.tests, c.finding]), [["C1", "sort by due date", ["data: src/store.js:42", "ran: node src/cli.js list --due → items in order"], [], false]]);
    assert.deepEqual([view.board.check.status, view.board.check.errors, view.board.check.sources.data, view.board.check.sources.ran], ["ready", [], 1, 1]);
    assert.deepEqual([view.board.decisions, view.board.flows], [undefined, undefined]);
    assert.ok(view.board.bytes < 2048);
    assert.deepEqual(view.scores.surprises, 0);
});

test("an open bracket reaches the board as an open question of its criterion", async (t) => {
    const ctx = await board(t, finished("asking", BLUEPRINT.replace("[data: src/store.js:42]", "[open: a) earliest first b) latest first; recommend a]")));
    const view = await (await fetch(`${ctx.origin}/state`, { headers: { "x-minime-token": ctx.token } })).json();
    assert.deepEqual([view.board.check.status, view.board.check.open.map((q) => [q.id, q.answer])], ["questions", [["C1", "open: a) earliest first b) latest first; recommend a"]]]);
});

test("a hand edit rewrites the boundaries, keeps the old text in raw and clears the Extracted date", async (t) => {
    const ctx = await board(t, finished());
    const file = path.join(ctx.hq, "acme", "_todo", "blueprints", "2026-10-22-due-dates.md");
    const res = await edit(ctx, rows([BOUNDARIES[0], { ...BOUNDARIES[1], contract: "items → items sorted by date" }]));
    assert.equal(res.status, 200);
    const text = readFileSync(file, "utf8");
    assert.ok(text.includes("| B2 | `src/store.js` sortByDue | items → items sorted by date | new | C1 |") && !text.includes("Extracted"));
    const raw = path.join(ctx.hq, "raw", "acme", "todo", "blueprints", "2026-10-22-due-dates");
    assert.deepEqual(readdirSync(raw).map((f) => readFileSync(path.join(raw, f), "utf8")), [BLUEPRINT]);
    const view = await (await fetch(`${ctx.origin}/state`, { headers: { "x-minime-token": ctx.token } })).json();
    assert.deepEqual(view.board.boundaries.map((b) => b.contract), ["argv → options", "items → items sorted by date"]);
});

test("a hand edit that breaks the blueprint is refused with the new errors and leaves the file alone", async (t) => {
    const ctx = await board(t, finished());
    const res = await edit(ctx, { boundaries: BOUNDARIES.map((b) => ({ ...b, criteria: [] })) });
    assert.equal(res.status, 409);
    assert.ok((await res.json()).errors.some((e) => e.includes("C1 is in no boundary")));
    assert.equal(readFileSync(path.join(ctx.hq, "acme", "_todo", "blueprints", "2026-10-22-due-dates.md"), "utf8"), BLUEPRINT);
    assert.ok(!existsSync(path.join(ctx.hq, "raw")));
});

for (const status of ["running", "paused"]) {
    test(`a hand edit is refused while the run is ${status}`, async (t) => {
        const ctx = await board(t, finished(status));
        assert.equal((await edit(ctx, rows(BOUNDARIES))).status, 409);
    });
}

test("a hand edit before any run is refused", async (t) => {
    const ctx = await board(t);
    assert.equal((await edit(ctx, rows(BOUNDARIES))).status, 409);
});

test("the command line opens the board on an existing blueprint, ready to edit", async (t) => {
    const ctx = await board(t, finished());
    const file = path.join(ctx.hq, "acme", "_todo", "blueprints", "2026-10-22-due-dates.md");
    const child = spawn("node", [path.join(path.dirname(fileURLToPath(import.meta.url)), "minime.mjs"), "--blueprint", file, "--repo", ctx.repo, "--port", "0"], { env: { ...process.env, VIRTUCON_HQ: ctx.hq }, stdio: ["ignore", "pipe", "inherit"] });
    t.after(() => child.kill());
    const url = new URL(await new Promise((resolve) => child.stdout.once("data", (d) => resolve(String(d).match(/http\S+/)[0]))));
    const headers = { "x-minime-token": url.searchParams.get("t") };
    const view = await (await fetch(`${url.origin}/state`, { headers })).json();
    assert.equal(view.state.status, "stopped");
    assert.deepEqual(view.board.boundaries.map((b) => b.id), ["B1", "B2"]);
    assert.equal((await edit({ origin: url.origin, token: headers["x-minime-token"] }, rows(BOUNDARIES))).status, 200);
});

/* ── a split blueprint: a root and the child its row names ── */

/* ── existing tests ── */

// A repo with the files committed, then changed by `edit`; or a plain directory that is no repository.
function repoWith(files, edit) {
    const dir = mkdtempSync(path.join(tmpdir(), "board-tests-"));
    if (!files) return dir;
    for (const [rel, text] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        writeFileSync(path.join(dir, rel), text);
    }
    spawnSync("git", ["init", "-q"], { cwd: dir });
    spawnSync("git", ["add", "."], { cwd: dir });
    spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "x"], { cwd: dir });
    edit(dir);
    return dir;
}

for (const [name, files, edit, ratchet, expected] of [
    ["a rewritten test is counted from the repo, not from the inspector", { "test/a.test.js": "a\nb\nc\n", "src/a.js": "x\ny\n" }, (d) => writeFileSync(path.join(d, "test", "a.test.js"), "a\n"), { test_lines_removed: 9 },
        { testLinesRemoved: 2, testFiles: ["test/a.test.js"] }],
    ["a source file with test in its name is no test file", { "src/latest.py": "x\ny\n", "inspect.py": "a\nb\n" }, (d) => { writeFileSync(path.join(d, "src", "latest.py"), "x\n"); writeFileSync(path.join(d, "inspect.py"), "a\n"); }, { test_lines_removed: 9 },
        { testLinesRemoved: 0, testFiles: [] }],
    ["lines removed from source are no test lines", { "test/a.test.js": "a\n", "src/a.js": "x\ny\n" }, (d) => writeFileSync(path.join(d, "src", "a.js"), "x\n"), { test_lines_removed: 9 },
        { testLinesRemoved: 0, testFiles: [] }],
    ["a repo that can't be read falls back to the inspector's count", null, null, { test_lines_removed: 4 },
        { testLinesRemoved: 4, testFiles: [] }],
    ["no count anywhere is zero", null, null, undefined,
        { testLinesRemoved: 0, testFiles: [] }],
]) {
    test(`removedTestLines: ${name}`, () => {
        const ceiling = process.env.GIT_CEILING_DIRECTORIES;
        const dir = repoWith(files, edit);
        // A directory outside any repository must not find one above it.
        if (!files) process.env.GIT_CEILING_DIRECTORIES = path.dirname(dir);
        try {
            assert.deepEqual(removedTestLines(dir, { ratchet }), expected);
        } finally {
            if (ceiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
            else process.env.GIT_CEILING_DIRECTORIES = ceiling;
        }
    });
}
