#!/usr/bin/env node
// The minime conductor: runs blueprint → replicate → inspect → extract as fresh Copilot CLI workers
// and serves a board on 127.0.0.1 to watch and steer the run. No dependencies.
//   node conductor/minime.mjs [--repo <dir>] [--port <n>] [--model <id>] [--requests <n>] [--minutes <n>] [--repeats <n>] [--open] ["task"]
//   node conductor/minime.mjs --blueprint <file> [--open]   the board for an existing blueprint, to view and edit its boundaries
// A file named PAUSED in VIRTUCON_HQ holds every run until it is removed (the guard hook reads the same file).

import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DENIED } from "../hooks/guard-rules.mjs";
import { applyEdit, check, checkFile, coverage, diff, parse } from "../skills/blueprint/scripts/blueprint.mjs";
import * as flow from "./flow.mjs";

const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Unattended workers never change history or anything outside the machine: the guard hook's list, denied to the worker's shell
// too; `git restore` is the hook's alone (by file, under a test directory), and MINIME_UNATTENDED keeps the user's allow-git
// lever from reaching a worker.

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
            env: { ...process.env, VIRTUCON_HQ: state.hq, MINIME_UNATTENDED: "1" },
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

/* ── the working tree ── */

// What the repository looks like right now: the diff against HEAD plus every untracked file. Evidence a worker
// returned belongs to the tree it saw; when the hash moves, that evidence is stale.
export function treeHash(repo) {
    const git = (...args) => {
        const run = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
        if (run.status !== 0 || run.error) throw new Error(`git ${args[0]} failed in ${repo}: ${String(run.stderr || run.error).trim()}`);
        return run.stdout;
    };
    const hash = createHash("sha1").update(git("rev-parse", "HEAD")).update(git("diff", "HEAD", "--no-color"));
    for (const file of git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean)) hash.update(`\n${file}\n`).update(readFileSync(path.join(repo, file)));
    return hash.digest("hex").slice(0, 12);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── the run ── */

export function createConductor({ repo, hq, model, budget, store, state: seeded = null }) {
    // The repo's wiki scope: its index and its run receipts go to every blueprint dispatch, and every run ends with a receipt.
    const scope = flow.scopeOf(spawnSync("git", ["remote", "get-url", "origin"], { cwd: repo, encoding: "utf8" }).stdout, path.basename(repo));
    const wikiIndex = path.join(hq, "wiki", "orgs", scope.org, scope.repo, "index.md");
    const runsFile = path.join(hq, "raw", scope.org, scope.repo, "runs.md");
    const wiki = () => ({
        index: existsSync(wikiIndex) ? { path: wikiIndex, text: readFileSync(wikiIndex, "utf8") } : null,
        runs: existsSync(runsFile) ? { path: runsFile, text: readFileSync(runsFile, "utf8").trim().split("\n").filter((l) => l.startsWith("| 2")).slice(-5).join("\n") } : null,
    });
    const writeReceipt = (line) => {
        mkdirSync(path.dirname(runsFile), { recursive: true });
        if (!existsSync(runsFile)) writeFileSync(runsFile, flow.RUNS_HEADER);
        appendFileSync(runsFile, line + "\n");
    };
    const template = flow.templateFrom(readFileSync(path.join(PLUGIN, "assets", "ORCHESTRATION.md"), "utf8"));
    const children = new Set();
    const pausedFile = path.join(hq, "PAUSED");
    let state = seeded;
    let board = null;
    let driving = false;
    const tree = () => { try { return treeHash(state.repo); } catch { return null; } };

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

    function refreshBoard() {
        if (!state?.blueprint || !existsSync(state.blueprint)) return;
        try {
            board = { ...readNode({ file: state.blueprint, parent: null, status: state.status }), diff: diff(state.repo) };
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
        const record = { id: state.jobs.length + 1, phase: job.phase, started: Date.now(), ended: null, status: "running", activity: [], usage: null };
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
        Object.assign(record, { ended: Date.now(), status: result.status, usage: run.usage, sessionId: run.sessionId, result, tree: tree() });
        set({ ...state, jobs: state.jobs.map((j) => (j.id === record.id ? record : j)) });
        // The flow matches a result to its node.
        return result;
    }

    async function drive() {
        if (driving) return;
        driving = true;
        try {
            while (state.status === "running" && state.stage) {
                // The Pause button and the PAUSED file hold the run before the next dispatch; Stop ends the wait.
                while (state.status === "running" && (state.paused || existsSync(pausedFile))) await sleep(500);
                if (state.status !== "running") break;
                const phase = state.stage.phase;
                const results = [];
                for (const wave of flow.waves(state, { wiki: wiki() })) {
                    if (wave.parallel) results.push(...await Promise.all(wave.jobs.map(runJob)));
                    else for (const job of wave.jobs) results.push(await runJob(job));
                    if (state.status !== "running") break;
                }
                if (state.status !== "running") break;
                const file = results.find((r) => r.blueprint_path)?.blueprint_path ?? state.blueprint;
                const checkOpen = phase === "blueprint" && file && existsSync(file) ? check(readFileSync(file, "utf8")).open : [];
                const tests = phase === "inspect" ? removedTestLines(state.repo, results[0]) : {};
                set(flow.advance(state, phase, results, { checkOpen, ...tests }));
                const fuel = flow.overBudget(state);
                if (fuel) set(flow.stopped(state, fuel));
                refreshBoard();
                // A run that ends, however it ends, records what the proof board says; the run file is the record.
                if (!state.stage) {
                    set({ ...state, verdict: flow.verdict(state, board, tree()) });
                    writeReceipt(flow.receipt(state, board, state.verdict, Date.now()));
                }
                save();
            }
        } finally {
            driving = false;
        }
    }

    if (state) refreshBoard();
    return {
        start(task) {
            set(flow.newRun({ task, repo, hq, plugin: PLUGIN, model, budget, now: Date.now() }));
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
        resume() { set({ ...state, paused: false }); },
        stop() {
            for (const child of children) child.kill("SIGTERM");
            if (state) set(flow.stopped(state, "stopped from the board"));
        },
        // The blueprint's boundaries, and only while no worker can be writing the blueprint.
        edit(rows) {
            if (!state?.blueprint || !existsSync(state.blueprint)) return { ok: false, errors: ["there is no blueprint yet"] };
            if (!["asking", "done", "stopped", "failed"].includes(state.status)) return { ok: false, errors: ["a worker may be writing the blueprint: wait until it asks or finishes"] };
            const file = state.blueprint;
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
            const now = tree();
            return { state, board, scores: flow.scores(state, board), tree: now, verdict: flow.verdict(state, board, now), pausedByFile: existsSync(pausedFile) };
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

export async function startBoard({ repo, hq = defaultHq(), model, budget, port = 0, task, state }) {
    const runs = path.join(hq, "conductor");
    mkdirSync(runs, { recursive: true });
    const runFile = path.join(runs, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    const conductor = createConductor({ repo, hq, model, budget, state, store: (run) => writeFileSync(runFile, JSON.stringify(run, null, 2)) });
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
    const valued = new Set(["--repo", "--port", "--model", "--blueprint", "--requests", "--minutes", "--repeats"]);
    const repo = path.resolve(opt("repo") ?? process.cwd());
    const hq = defaultHq();
    const blueprint = opt("blueprint");
    // Only the caps given on the command line; the run keeps its defaults for the rest.
    const budget = Object.fromEntries(["requests", "minutes", "repeats"].filter((name) => opt(name) !== undefined).map((name) => [name, Number(opt(name))]));
    const board = await startBoard({
        repo,
        hq,
        model: opt("model"),
        budget,
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
