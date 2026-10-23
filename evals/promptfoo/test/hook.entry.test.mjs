import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const HOOK = resolve(PLUGIN_ROOT, "hooks", "session-start.js");
const SCRATCH_PARENT = resolve(fileURLToPath(new URL("../", import.meta.url)), ".tmp-hook-entry");

function runHook(hq, cwd) {
    const result = spawnSync(process.execPath, [HOOK], {
        cwd,
        encoding: "utf8",
        env: { PATH: process.env.PATH, HOME: cwd, PLUGIN_ROOT, VIRTUCON_HQ: hq },
    });
    return { ...result, json: JSON.parse(result.stdout) };
}

async function withScratch(fn) {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(SCRATCH_PARENT, { recursive: true });
    const dir = await mkdtemp(resolve(SCRATCH_PARENT, "case-"));
    try {
        return await fn(dir);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

test("emits one nudge through all three hook output fields", async () => {
    await withScratch(async (dir) => {
        const hq = resolve(dir, "hq");
        const { status, json } = runHook(hq, dir);
        assert.equal(status, 0);
        const text = json.additionalContext;
        assert.equal(json.additional_context, text);
        assert.equal(json.hookSpecificOutput.hookEventName, "SessionStart");
        assert.equal(json.hookSpecificOutput.additionalContext, text);
    });
});

const EXPECTED = [
    ["canonical HQ path", (t, hq) => t.includes(`VIRTUCON_HQ=${hq}`)],
    ["blueprints path", (t, hq) => t.includes(`Blueprints: ${hq}/`) && t.includes("/blueprints/")],
    ["absolute orchestration guide", (t) => t.includes(`Orchestration guide: ${resolve(PLUGIN_ROOT, "assets", "ORCHESTRATION.md")}`)],
    ["absolute blueprint tool", (t) => t.includes(`Blueprint tool: node ${resolve(PLUGIN_ROOT, "skills", "blueprint", "scripts", "blueprint.mjs")}`)],
    ["wiki paths", (t, hq) => t.includes(`Wiki index: ${hq}/wiki/index.md`) && t.includes(`Wiki schema: ${hq}/schema.md`) && /Repo wiki index: .*\/wiki\/orgs\/[^/]+\/[^/]+\/index\.md/.test(t)],
    ["absolute wiki lint tool", (t) => t.includes(`Wiki lint tool: node ${resolve(PLUGIN_ROOT, "skills", "extract", "scripts", "wiki-lint.mjs")}`)],
    ["full flow points to dr-evil", (t) => t.includes("minime:dr-evil")],
    ["flow rules live in the agent, not the nudge", (t) => !/blueprint -> replicate|Every phase returns/.test(t)],
    ["no invented role selector", (t) => !/MINIME_ROLE|process\.env\.ROLE/.test(t)],
];

for (const [name, check] of EXPECTED) {
    test(`hook text: ${name}`, async () => {
        await withScratch(async (dir) => {
            const hq = resolve(dir, "hq");
            const { json } = runHook(hq, dir);
            assert.ok(check(json.additionalContext, hq), `${name} failed in:\n${json.additionalContext}`);
        });
    });
}

async function makeRepo(dir, name, origin) {
    const { mkdir } = await import("node:fs/promises");
    const repo = resolve(dir, name);
    await mkdir(repo, { recursive: true });
    spawnSync("git", ["init", "-q"], { cwd: repo });
    spawnSync("git", ["remote", "add", "origin", origin], { cwd: repo });
    return repo;
}

for (const [name, stdin, expectedRepo] of [
    ["uses the cwd the host reports on stdin", (repo) => JSON.stringify({ cwd: repo }), "acme/_todo"],
    ["ignores a cwd that does not exist", () => JSON.stringify({ cwd: "/definitely/not/here" }), "local/_scratch"],
    ["survives invalid JSON on stdin", () => "{nope", "local/_scratch"],
    ["survives empty stdin", () => "", "local/_scratch"],
]) {
    test(`hook repo scope: ${name}`, async () => {
        await withScratch(async (dir) => {
            const hq = resolve(dir, "hq");
            const todo = await makeRepo(dir, "todo", "git@github.com:acme/todo.git");
            const scratch = await makeRepo(dir, "scratch", "git@github.com:local/scratch.git");
            const result = spawnSync(process.execPath, [HOOK], {
                cwd: scratch,
                input: stdin(todo),
                encoding: "utf8",
                env: { PATH: process.env.PATH, HOME: dir, PLUGIN_ROOT, VIRTUCON_HQ: hq },
            });
            assert.equal(result.status, 0);
            assert.ok(JSON.parse(result.stdout).additionalContext.includes(`Blueprints: ${hq}/${expectedRepo}/blueprints/`));
        });
    });
}

test("bootstrap failure stays nonfatal and still emits canonical paths", async () => {
    await withScratch(async (dir) => {
        const blocker = resolve(dir, "blocker");
        await writeFile(blocker, "file");
        const hq = resolve(blocker, "hq");
        const { status, json } = runHook(hq, dir);
        assert.equal(status, 0);
        assert.ok(json.additionalContext.includes(`VIRTUCON_HQ=${hq}`));
        await assert.rejects(stat(hq));
    });
});

test("bootstrap seeds only the scratch HQ", async () => {
    await withScratch(async (dir) => {
        const hq = resolve(dir, "hq");
        runHook(hq, dir);
        await stat(resolve(hq, "_TEMPLATE.md"));
        await stat(resolve(hq, "schema.md"));
    });
});

const AGENT = resolve(PLUGIN_ROOT, "agents", "dr-evil.md");

async function readAgent() {
    const { readFile } = await import("node:fs/promises");
    const text = await readFile(AGENT, "utf8");
    const [, frontmatter, body] = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    return { frontmatter, body };
}

const AGENT_BODY = [
    ["pure dispatcher", (b) => /dispatcher/i.test(b) && /don't plan, edit, run or verify/i.test(b)],
    ["never loads a phase skill inline", (b) => /never load the blueprint, replicate, inspect or extract skills/i.test(b)],
    ["flow policy is read from the orchestration guide", (b) => b.includes("../assets/ORCHESTRATION.md")],
    ["flow steps are not duplicated in the agent", (b) => !/dispatch \*\*blueprint\*\*/i.test(b)],
    ["one todo per phase", (b) => /one todo per phase/i.test(b)],
    ["sign-off preserved", (b) => b.includes("`One Million Dollars!`") && /never emit another agent's sign-off/.test(b)],
];

for (const [name, check] of AGENT_BODY) {
    test(`dr-evil body: ${name}`, async () => {
        const { body } = await readAgent();
        assert.ok(check(body), `${name} failed in:\n${body}`);
    });
}

const ORCHESTRATION = resolve(PLUGIN_ROOT, "assets", "ORCHESTRATION.md");

const FLOW = [
    ["new task dispatches blueprint with the message verbatim", (t) => /new task, dispatch \*\*blueprint\*\* with the user's message verbatim/i.test(t)],
    ["open decisions come back blocked and go to the user", (t) => /returns `blocked` with open decisions, ask the user/i.test(t)],
    ["questions use the native question tool with options, confidence and free text", (t) => /ask_user/.test(t) && /AskUserQuestion/.test(t) && /confidence/.test(t) && /free-text/.test(t)],
    ["tasks are named after their phase", (t) => /Name each task after its phase/i.test(t)],
    ["dispatch prompt carries the five-field result contract", (t) => /status \(done \| blocked \| failed\), blueprint_path, changed_files\[\], blocking_issue, evidence_excerpts\[\]/.test(t)],
    ["inspect runs on frau", (t) => /\*\*inspect\*\* to `minime:frau`/.test(t)],
    ["extract once", (t) => /\*\*extract\*\* once/.test(t)],
    ["synchronous workers, no polling", (t) => /synchronously/i.test(t) && /don't start background workers or poll/i.test(t)],
    ["self-contained dispatch prompt", (t) => /Use the minime <phase> skill\./.test(t)],
    ["direct phase and question intent preserved", (t) => /question gets a short answer/i.test(t) && /single phase gets only that phase/i.test(t)],
    ["criteria proposed by workers go through blueprint", (t) => /proposed criteria, dispatch \*\*blueprint\*\* with the proposals and their evidence/i.test(t)],
    ["the user's words are delimited for the blueprint worker", (t) => /User message:[\s\S]*End of user message\./.test(t)],
    ["the final report names the blueprint path and what extract captured", (t) => /absolute blueprint path[^\n]*what extract captured/i.test(t)],
    ["agent personas stay in the agent files", (t) => !/One Million Dollars|Laser On/.test(t)],
];

for (const [name, check] of FLOW) {
    test(`orchestration: ${name}`, async () => {
        const { readFile } = await import("node:fs/promises");
        const text = await readFile(ORCHESTRATION, "utf8");
        assert.ok(check(text), `${name} failed in:\n${text}`);
    });
}

test("dr-evil frontmatter: dispatcher tools only", async () => {
    const { frontmatter } = await readAgent();
    for (const line of ["name: dr-evil", "model: inherit", "color: purple", "memory: project"]) {
        assert.ok(frontmatter.split("\n").includes(line), line);
    }
    assert.match(frontmatter, /^initialPrompt: Accept the user's task/m);
    const tools = JSON.parse(frontmatter.match(/^tools: (.+)$/m)[1]);
    assert.ok(tools.includes("Task"));
    for (const forbidden of ["*", "Edit", "Write", "Bash", "Skill"]) assert.ok(!tools.includes(forbidden), forbidden);
});
