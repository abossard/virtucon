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
    ["templates path", (t, hq) => t.includes(`Templates: ${hq}/templates/`)],
    ["skill inventory", (t) => /\*\*minime:blueprint\*\*/.test(t) && /\*\*minime:replicate\*\*/.test(t)],
    ["single four-phase policy reference", (t) => t.split("blueprint -> replicate -> inspect -> extract").length === 2],
    ["result contract line", (t) => t.includes("Every phase returns status, blueprint_path, changed_files[], blocking_issue, and evidence_excerpts[].")],
    ["full coordinator starts a fresh native blueprint worker", (t) => /Dr\. Evil[^\n]*fresh native `?blueprint`? (worker|task)/i.test(t)],
    ["full coordinator does not load blueprint inline", (t) => /Dr\. Evil[^\n]*(never|not|rather than)[^\n]*inline/i.test(t)],
    ["assigned phase worker runs only its phase and returns", (t) => /assigned[^\n]*phase[^\n]*only[^\n]*return/i.test(t)],
    ["direct phase caller returns without successor", (t) => /Direct phase invocation returns to its caller and never invokes another phase\./.test(t)],
    ["no universal inline blueprint instruction", (t) => !/For non-trivial tasks, invoke skill\("blueprint"\) before starting implementation\./.test(t)],
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
        await stat(resolve(hq, "templates", "blueprint.template.md"));
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
    ["coordinator, not a phase worker", (b) => /coordinator[^\n]*not[^\n]*(phase worker|implement)/i.test(b)],
    ["new full-flow task starts a fresh native blueprint task", (b) => /fresh native `?blueprint`? task/i.test(b)],
    ["blueprint worker invokes the phase skill", (b) => /worker[^\n]*invokes?[^\n]*skill/i.test(b)],
    ["owner never runs a phase skill or implements inline", (b) => /never[^\n]*inline/i.test(b)],
    ["consumes matching persisted blueprint and shared results", (b) => /matching[^\n]*blueprint/i.test(b) && /result/i.test(b)],
    ["unavailable native capability is a blocker, not inline fallback", (b) => /blocker/i.test(b) && /fallback/i.test(b)],
    ["unrelated completed blueprint is not the supplied plan", (b) => /unrelated[^\n]*blueprint/i.test(b)],
    ["direct phase and question intent preserved", (b) => /direct/i.test(b) && /question/i.test(b)],
    ["guide still owns details", (b) => b.includes("../assets/ORCHESTRATION.md")],
    ["no duplicated four-phase order", (b) => !b.includes("blueprint -> replicate -> inspect -> extract")],
    ["sign-off preserved", (b) => b.includes("`One Million Dollars!`") && /never emit another agent's sign-off/.test(b)],
];

for (const [name, check] of AGENT_BODY) {
    test(`dr-evil body: ${name}`, async () => {
        const { body } = await readAgent();
        assert.ok(check(body), `${name} failed in:\n${body}`);
    });
}

test("dr-evil frontmatter metadata preserved", async () => {
    const { frontmatter } = await readAgent();
    for (const line of [
        "name: dr-evil",
        'tools: ["*"]',
        "model: inherit",
        "color: purple",
        "memory: project",
    ]) {
        assert.ok(frontmatter.split("\n").includes(line), line);
    }
});
