#!/usr/bin/env node
// The minime conductor: runs blueprint → replicate → inspect → extract as fresh Copilot CLI workers
// and serves a board on 127.0.0.1 to watch and steer the run. No dependencies.
//   node conductor/minime.mjs [--repo <dir>] [--port <n>] [--model <id>] [--open] ["task"]
//   node conductor/minime.mjs --blueprint <file> [--open]   the board for an existing blueprint, to view and edit its boundaries

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { applyEdit, check, checkFile, coverage, diff, parse } from "../skills/blueprint/scripts/blueprint.mjs";
import * as flow from "./flow.mjs";

const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Unattended workers never change history or anything outside the machine: no git history commands, no GitHub writes.
const DENIED = ["git push", "git commit", "git add", "git stash", "git reset", "git checkout", "git restore", "git rebase",
    "gh repo fork", "gh repo create", "gh repo delete", "gh pr create", "gh pr merge", "gh release create", "gh issue create", "gh api -X", "gh api --method"];

/* ── workers ── */

function copilotArgs({ phase, prompt, repo, hq, model }) {
    const args = ["-p", prompt, "--output-format", "json", "--allow-all-tools", "--no-auto-update",
        "--plugin-dir", PLUGIN, "--add-dir", PLUGIN, "--add-dir", hq, "-C", repo];
    for (const tool of DENIED) args.push("--deny-tool", `shell(${tool})`);
    const agent = flow.agentFor(phase);
    if (agent) args.push("--agent", agent);
    if (model) args.push("--model", model);
    return args;
}

// One fresh headless Copilot run. Streams activity, resolves with the last main-agent message and the usage.
function runWorker(job, state, onActivity, children) {
    return new Promise((resolve) => {
        const child = spawn("copilot", copilotArgs({ ...job, repo: state.repo, hq: state.hq, model: state.model }), {
            env: { ...process.env, VIRTUCON_HQ: state.hq },
            stdio: ["ignore", "pipe", "pipe"],
        });
        children.add(child);
        let text = "";
        let usage = null;
        let sessionId = null;
        let buffer = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
            buffer += chunk;
            const lines = buffer.split("\n");
            buffer = lines.pop();
            for (const line of lines) {
                let event;
                try { event = JSON.parse(line); } catch { continue; }
                if (event.type === "assistant.message" && !event.agentId && event.data?.content) text = event.data.content;
                if (event.type === "tool.execution_start") onActivity(describe(event.data));
                if (event.type === "result") {
                    usage = event.usage ?? null;
                    sessionId = event.sessionId ?? null;
                }
            }
        });
        child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-2000); });
        child.on("close", (code) => {
            children.delete(child);
            resolve({ text, usage, sessionId, code, stderr });
        });
    });
}

function describe(data) {
    const args = data?.arguments ?? {};
    const detail = args.command ?? args.path ?? args.pattern ?? args.skill ?? args.description ?? "";
    return `${data?.toolName ?? "tool"} ${String(detail).replace(/\s+/g, " ").slice(0, 120)}`.trim();
}

/* ── the blueprint tree ── */

// What the flow reads from the blueprint files, from the root through the rows that name a child:
// { [file]: { children, criteria, own: the rows that name no child } }.
function readFacts(root) {
    const facts = {};
    const visit = (file) => {
        if (facts[file] || !existsSync(file)) return;
        const bp = parse(readFileSync(file, "utf8"));
        const own = bp.boundaries.filter((b) => !b.child);
        facts[file] = {
            children: [...new Set(bp.boundaries.filter((b) => b.child).map((b) => path.join(path.dirname(file), b.child)))],
            criteria: bp.criteria.map((c) => c.id),
            own: { boundaries: own.map((b) => b.id), criteria: [...new Set(own.flatMap((b) => b.criteria))].sort() },
        };
        facts[file].children.forEach(visit);
    };
    visit(root);
    return facts;
}

/* ── existing tests ── */

// Lines of existing tests the change removed, counted by the blueprint tool's diff on the run's repo.
// The inspector's own count stands in when the repo can't be read.
export function removedTestLines(repo, result) {
    try {
        const { testLinesRemoved, testFiles } = diff(repo);
        return { testLinesRemoved, testFiles };
    } catch {
        return { testLinesRemoved: Number(result?.ratchet?.test_lines_removed) || 0, testFiles: [] };
    }
}

/* ── the run ── */

export function createConductor({ repo, hq, model, store, state: seeded = null }) {
    const template = flow.templateFrom(readFileSync(path.join(PLUGIN, "assets", "ORCHESTRATION.md"), "utf8"));
    const children = new Set();
    // A blueprint opened without a run is a tree of finished nodes.
    let state = seeded?.blueprint && !seeded.nodes?.length ? { ...seeded, nodes: flow.grow([], seeded.blueprint, readFacts(seeded.blueprint)).map((n) => ({ ...n, status: "done" })) } : seeded;
    let board = null;
    let driving = false;
    let resume = null;

    const save = () => state && store(state);
    const set = (next) => {
        state = next;
        save();
    };

    // One node's blueprint as the board shows it. The findings file belongs to the node it sits next to.
    function readNode({ file, parent, status }) {
        const text = readFileSync(file, "utf8");
        const bp = parse(text);
        const covered = new Map(coverage(text, { repo: state.repo }).covered.map((c) => [c.id, c.files]));
        const mine = state.findingsFile?.startsWith(`${file.slice(0, -3)}.runs${path.sep}`) && existsSync(state.findingsFile);
        const withFindings = new Set(flow.criteriaWithFindings(mine ? readFileSync(state.findingsFile, "utf8") : ""));
        return {
            file, parent, status,
            check: checkFile(file),
            bytes: Buffer.byteLength(text) - Buffer.byteLength((bp.sections.Inputs ?? []).map((l) => `${l.text}\n`).join("")),
            criteria: bp.criteria.map((c) => ({ id: c.id, quote: c.inputs.map((i) => i.quote).filter(Boolean).join(" · "), text: c.text, evidence: c.evidence.map((e) => e.body), tests: covered.get(c.id) ?? [], finding: withFindings.has(c.id) })),
            boundaries: bp.boundaries.map(({ id, owner, contract, change, criteria }) => ({ id, owner, contract, change, criteria })),
        };
    }

    // The root's fields stay at the top of the board, every node (the root included) is listed under `nodes`.
    function refreshBoard() {
        if (!state?.blueprint || !existsSync(state.blueprint)) return;
        try {
            const nodes = (state.nodes.length ? state.nodes : [{ file: state.blueprint, parent: null, status: state.status }]).filter((n) => existsSync(n.file)).map(readNode);
            board = { ...nodes.find((n) => !n.parent), nodes, diff: diff(state.repo) };
        } catch (error) {
            board = { ...(board ?? {}), error: error.message };
        }
    }

    // The blueprint before a hand edit goes to raw, like any correction: <org>/_<repo>/blueprints/<name>.md → raw/<org>/<repo>/blueprints/<name>/<stamp>.md
    function keepOld(text, blueprint) {
        const [org, repoDir, folder, file] = path.relative(hq, blueprint).split(path.sep);
        if (!file || !repoDir.startsWith("_") || folder !== "blueprints") return;
        const dir = path.join(hq, "raw", org, repoDir.slice(1), "blueprints", path.basename(file, ".md"));
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, `${new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "")}.md`), text);
    }

    async function runJob(job) {
        const record = { id: state.jobs.length + 1, phase: job.phase, group: job.group ?? null, node: job.node ?? null, started: Date.now(), ended: null, status: "running", activity: [], usage: null };
        set({ ...state, jobs: [...state.jobs, record] });
        const prompt = flow.promptFor(template, job, state);
        const onActivity = (line) => { record.activity = [...record.activity.slice(-7), line]; };
        let run = await runWorker({ ...job, prompt }, state, onActivity, children);
        let result = flow.parseResult(run.text);
        if (!run.text && state.status === "running") {
            // A model or network error leaves no result: one more try with the same prompt.
            onActivity("retrying after a run without a result");
            run = await runWorker({ ...job, prompt }, state, onActivity, children);
            result = flow.parseResult(run.text);
        }
        if (!run.text) result = { ...result, status: "failed", blocking_issue: `copilot exited ${run.code} without a result: ${run.stderr.trim().slice(-300)}` };
        Object.assign(record, { ended: Date.now(), status: result.status, usage: run.usage, sessionId: run.sessionId, result });
        set({ ...state, jobs: state.jobs.map((j) => (j.id === record.id ? record : j)) });
        // The flow matches a result to its node.
        return job.node ? { ...result, node: job.node } : result;
    }

    async function drive() {
        if (driving) return;
        driving = true;
        try {
            while (state.status === "running" && state.stage) {
                if (state.paused) await new Promise((r) => { resume = r; });
                if (state.status !== "running") break;
                const phase = state.stage.phase;
                const results = [];
                const rows = state.blueprint && existsSync(state.blueprint) ? parse(readFileSync(state.blueprint, "utf8")).boundaries : [];
                const boundaryCriteria = Object.fromEntries(rows.map((b) => [b.id, b.criteria]));
                for (const wave of flow.waves(state, { boundaryCriteria, facts: state.blueprint ? readFacts(state.blueprint) : {} })) {
                    if (wave.parallel) results.push(...await Promise.all(wave.jobs.map(runJob)));
                    else for (const job of wave.jobs) results.push(await runJob(job));
                    if (state.status !== "running") break;
                }
                if (state.status !== "running") break;
                // A pass on a child works on the child's file; any other pass names the root.
                const reported = results.find((r) => r.blueprint_path)?.blueprint_path;
                const root = state.stage.node ? state.blueprint : reported ?? state.blueprint;
                const file = state.stage.node ?? root;
                const checkOpen = phase === "blueprint" && file && existsSync(file) ? check(readFileSync(file, "utf8")).open : [];
                const tests = phase === "inspect" ? removedTestLines(state.repo, results[0]) : {};
                set(flow.advance(state, phase, results, { checkOpen, facts: root ? readFacts(root) : {}, ...tests }));
                refreshBoard();
                save();
            }
        } finally {
            driving = false;
        }
    }

    if (state) refreshBoard();
    return {
        start(task) {
            set(flow.newRun({ task, repo, hq, plugin: PLUGIN, model, now: Date.now() }));
            drive();
        },
        feedback(text) {
            if (!state) return this.start(text);
            set(flow.feedback(state, text, Date.now()));
            drive();
        },
        answer(answers) {
            set(flow.answer(state, answers));
            drive();
        },
        learn(text) {
            set(flow.learn(state, text));
            drive();
        },
        pause() { set({ ...state, paused: true }); },
        resume() {
            set({ ...state, paused: false });
            resume?.();
            resume = null;
        },
        stop() {
            for (const child of children) child.kill("SIGTERM");
            if (state) set({ ...state, status: "stopped", stage: null, paused: false });
            resume?.();
        },
        // Boundaries of one node (the root without `node`), and only while no worker can be writing the blueprint.
        edit(rows) {
            if (!state?.blueprint || !existsSync(state.blueprint)) return { ok: false, errors: ["there is no blueprint yet"] };
            if (!["asking", "done", "stopped", "failed"].includes(state.status)) return { ok: false, errors: ["a worker may be writing the blueprint: wait until it asks or finishes"] };
            const file = rows?.node ?? state.blueprint;
            if (file !== state.blueprint && !state.nodes.some((n) => n.file === file)) return { ok: false, errors: ["unknown blueprint"] };
            if (!existsSync(file)) return { ok: false, errors: ["that blueprint file is gone"] };
            const text = readFileSync(file, "utf8");
            const edited = applyEdit(text, rows ?? {});
            if (!edited.ok) return edited;
            keepOld(text, file);
            writeFileSync(file, edited.text);
            refreshBoard();
            return { ok: true };
        },
        view() {
            if (!state) return { state: null };
            return { state, board, scores: flow.scores(state, board) };
        },
    };
}

/* ── board server ── */

function serve(conductor, { token }) {
    const html = readFileSync(path.join(PLUGIN, "conductor", "board.html"), "utf8");
    const send = (res, status, body, type = "application/json") => {
        res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
        res.end(type === "application/json" ? JSON.stringify(body) : body);
    };
    return createServer((req, res) => {
        const url = new URL(req.url, "http://127.0.0.1");
        if (req.method === "GET" && url.pathname === "/") {
            // The page URL carries the token: keep it out of referrers, and let only this page's own script and style run.
            const nonce = randomBytes(12).toString("base64url");
            res.writeHead(200, {
                "content-type": "text/html; charset=utf-8",
                "cache-control": "no-store",
                "referrer-policy": "no-referrer",
                "x-content-type-options": "nosniff",
                "content-security-policy": `default-src 'none'; connect-src 'self'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'`,
            });
            return res.end(html.replace("<script>", `<script nonce="${nonce}">`).replace("<style>", `<style nonce="${nonce}">`));
        }
        // Any page in the browser can reach 127.0.0.1. The token keeps them from steering an agent that may run tools.
        if (req.headers["x-minime-token"] !== token) return send(res, 403, { error: "token required" });
        if (req.method === "GET" && url.pathname === "/state") return send(res, 200, conductor.view());
        if (req.method !== "POST") return send(res, 404, { error: "not found" });
        let body = "";
        req.on("data", (c) => { body = (body + c).slice(0, 100_000); });
        req.on("end", () => {
            let data = {};
            try { data = body ? JSON.parse(body) : {}; } catch { return send(res, 400, { error: "invalid JSON" }); }
            const text = String(data.text ?? "").trim();
            const actions = {
                "/start": () => text && conductor.start(text),
                "/feedback": () => text && conductor.feedback(text),
                "/answer": () => conductor.answer(data.answers ?? { text }),
                "/learn": () => text && conductor.learn(text),
                "/pause": () => conductor.pause(),
                "/resume": () => conductor.resume(),
                "/stop": () => conductor.stop(),
                "/blueprint": () => conductor.edit(data),
            };
            if (!actions[url.pathname]) return send(res, 404, { error: "not found" });
            const out = actions[url.pathname]();
            const refused = out?.ok === false;
            send(res, refused ? 409 : 200, refused ? out : { ok: true });
        });
    });
}

// One board: a conductor for one repository and its page on 127.0.0.1. The command line and the
// Copilot canvas both start it here, so they share the flow, the page and the run files.
const defaultHq = () => path.resolve(process.env.VIRTUCON_HQ ?? path.join(os.homedir(), ".minime"));

export async function startBoard({ repo, hq = defaultHq(), model, port = 0, task, state }) {
    const runs = path.join(hq, "conductor");
    mkdirSync(runs, { recursive: true });
    const runFile = path.join(runs, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    const conductor = createConductor({ repo, hq, model, state, store: (run) => writeFileSync(runFile, JSON.stringify(run, null, 2)) });
    const token = randomBytes(12).toString("hex");
    const server = serve(conductor, { token });
    await new Promise((resolve, reject) => server.once("error", reject).listen(port, "127.0.0.1", resolve));
    if (task) conductor.start(task);
    return {
        url: `http://127.0.0.1:${server.address().port}/?t=${token}`,
        conductor,
        close: () => new Promise((resolve) => {
            conductor.stop();
            server.close(() => resolve());
        }),
    };
}

async function main(argv) {
    const opt = (name) => {
        const i = argv.indexOf(`--${name}`);
        return i >= 0 ? argv[i + 1] : undefined;
    };
    const valued = new Set(["--repo", "--port", "--model", "--blueprint"]);
    const repo = path.resolve(opt("repo") ?? process.cwd());
    const hq = defaultHq();
    const blueprint = opt("blueprint");
    const board = await startBoard({
        repo,
        hq,
        model: opt("model"),
        // No run yet: the blueprint is open for reading and editing, and a task typed on the page starts a run.
        state: blueprint && {
            ...flow.newRun({ task: `Blueprint ${path.basename(blueprint, ".md")}`, repo, hq, plugin: PLUGIN, model: opt("model"), now: Date.now() }),
            status: "stopped", stage: null, blueprint: path.resolve(blueprint),
        },
        port: Number(opt("port") ?? 4177),
        task: argv.filter((a, i) => !a.startsWith("--") && !valued.has(argv[i - 1])).join(" ").trim(),
    });
    process.stdout.write(`Dr. Evil's board: ${board.url}\n`);
    if (argv.includes("--open")) spawn(process.platform === "darwin" ? "open" : "xdg-open", [board.url], { stdio: "ignore", detached: true }).unref();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main(process.argv.slice(2));
