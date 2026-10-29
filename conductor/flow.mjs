// The minime flow as data and calculations. The conductor (minime.mjs) runs the actions.
// The flow itself is described in assets/ORCHESTRATION.md, which also owns the dispatch prompt.

export const PHASES = ["blueprint", "replicate", "inspect", "extract"];
const AGENTS = { inspect: "minime:frau" };
export const STALL_LIMIT = 2;

/* ── state ── */

export function newRun({ task, repo, hq, plugin, model, now }) {
    return {
        task, repo, hq, plugin, model: model ?? null, started: now,
        status: "running", // running | asking | paused | done | stopped | failed
        stage: { phase: "blueprint", message: task, input: [] },
        blueprint: null,
        size: "full",
        criteria: [],
        groups: [],
        nodes: [], // the blueprint tree: { file, parent, status }, status drafting | building | inspecting | done
        changed: [],
        findings: null,
        stalls: 0,
        stallAsked: false,
        testsDecided: false,
        testFiles: [],
        testsAnswer: null,
        blocks: 0,
        rounds: 0,
        pending: [],
        ask: null,
        report: null,
        jobs: [],
    };
}

/* ── results ── */

// A worker ends with a JSON object, ideally in a ```json block; a bare one may be followed by a sign-off line. Fall back to `key: value` lines.
export function parseResult(text) {
    const source = String(text ?? "");
    const blocks = [...source.matchAll(/```json\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
    const bare = source.slice(source.lastIndexOf("\n{") + 1, source.lastIndexOf("}") + 1);
    for (const candidate of [...blocks.reverse(), bare]) {
        try {
            const value = JSON.parse(candidate.trim());
            if (value && typeof value === "object" && "status" in value) return normalize(value);
        } catch { /* not JSON */ }
    }
    const fields = {};
    for (const m of source.matchAll(/^\s*[-*]?\s*`?(\w+)(?:\[\])?`?\s*:\s*(.+)$/gm)) fields[m[1].toLowerCase()] ??= m[2].trim();
    return normalize({ ...fields, changed_files: list(fields.changed_files), evidence_excerpts: list(fields.evidence_excerpts) });
}

function list(value) {
    // An item may arrive as an object (a proposed criterion with its evidence); it goes on as its JSON, not as `[object Object]`.
    if (Array.isArray(value)) return value.map((v) => (v && typeof v === "object" ? JSON.stringify(v) : String(v))).filter(Boolean);
    if (!value || /^(none|null|\[\])$/i.test(value)) return [];
    return String(value).replace(/^\[|\]$/g, "").split(",").map((s) => s.trim().replace(/^["'`]|["'`]$/g, "")).filter(Boolean);
}

function normalize(r) {
    const status = String(r.status ?? "").toLowerCase().match(/done|blocked|failed/)?.[0] ?? "failed";
    const blocking = r.blocking_issue;
    return {
        ...r,
        status,
        changed_files: list(r.changed_files),
        evidence_excerpts: list(r.evidence_excerpts),
        blocking_issue: blocking && !/^(null|none)$/i.test(String(blocking)) ? blocking : null,
        criteria: list(r.criteria),
        open_decisions: Array.isArray(r.open_decisions) ? r.open_decisions : [],
        groups: Array.isArray(r.groups) ? r.groups : [],
        proposed_criteria: list(r.proposed_criteria),
        findings: r.findings === undefined ? null : Number(r.findings),
    };
}

// `open: a) 10/s b) 100/s; recommend a` from the blueprint, for decisions the worker didn't describe.
export function optionsOf(answer) {
    const body = String(answer).replace(/^open:\s*/i, "");
    const options = [...body.matchAll(/(?:^|\s)([a-z])\)\s*(.+?)(?=\s+[a-z]\)\s|;|$)/g)].map((m) => ({ key: m[1], text: m[2].trim() }));
    const recommend = body.match(/recommend\s+([a-z])\b/i)?.[1];
    return { options: options.map((o) => o.text), recommend: options.find((o) => o.key === recommend)?.text ?? null };
}

const OPTION_KEY = /^\(?([a-z])[).:]\s+/i;

// Workers write options as "a) text" or "text" and recommend by key ("b"), by "b) text" or by text.
function recommended(options, recommend) {
    if (!recommend) return null;
    const key = String(recommend).trim().match(/^\(?([a-z])(?:[).:]|$)/i)?.[1];
    if (key && options[key.toLowerCase().charCodeAt(0) - 97]) return options[key.toLowerCase().charCodeAt(0) - 97];
    const text = String(recommend).replace(OPTION_KEY, "").trim().toLowerCase();
    return options.find((o) => o.toLowerCase() === text) ?? options.find((o) => o.toLowerCase().startsWith(text) || text.startsWith(o.toLowerCase())) ?? null;
}

export function openDecisions(result, checkOpen = []) {
    const described = new Map(result.open_decisions.map((d) => [d.id, d]));
    const ids = new Set([...described.keys(), ...checkOpen.map((d) => d.id)]);
    return [...ids].map((id) => {
        const d = described.get(id) ?? {};
        const fromBlueprint = checkOpen.find((o) => o.id === id);
        const parsed = fromBlueprint ? optionsOf(fromBlueprint.answer) : { options: [], recommend: null };
        const options = Array.isArray(d.options) && d.options.length ? d.options.map((o) => String(o).replace(OPTION_KEY, "").trim()) : parsed.options;
        return {
            id,
            question: d.question ?? fromBlueprint?.question ?? id,
            options,
            recommend: recommended(options, d.recommend) ?? parsed.recommend,
            confidence: d.confidence ?? null,
            reason: d.reason ?? null,
        };
    });
}

// What the user answered to one decision: own words, else the option picked, else the recommendation.
function chosen(d, answers) {
    const a = answers[d.id] ?? {};
    const text = String(a.text ?? "").trim() || String(a.choice ?? "").trim() || d.recommend || "";
    return { text, isDefault: !String(a.text ?? "").trim() && text === d.recommend };
}

// The user's answers go to blueprint as Q/A pairs. An unchanged recommendation is marked so blueprint records `default:`.
export function answerMessage(decisions, answers) {
    return decisions.map((d) => {
        const { text, isDefault } = chosen(d, answers);
        return `Q: ${d.question} A${isDefault ? " (default)" : ""}: ${text}`;
    }).join("\n");
}

/* ── transitions ── */

const union = (a, b) => [...new Set([...a, ...b])].sort();

// What a round's blueprint passes decided, kept across answers and fixes until replicate takes it.
// A round is small only when none of its passes added a boundary row or a dependency.
function absorb(state, r) {
    return {
        criteria: union(state.criteria, r.criteria),
        groups: r.groups.length ? r.groups : state.groups,
        size: state.size === "full" || r.size !== "small" ? "full" : "small",
    };
}

// Feedback that arrived while workers ran goes to blueprint before anything else.
function withPending(state, next) {
    if (!state.pending.length) return next;
    return { ...next, stage: { phase: "blueprint", message: state.pending.map((p) => p.text).join("\n\n"), input: [] }, pending: [], status: "running", report: null, blocks: 0 };
}

/* ── the blueprint tree ── */

// What a node's own bounds start from: each node has its own blocks, stalls and findings.
const FRESH = { blocks: 0, stalls: 0, stallAsked: false, testsDecided: false, findings: null, findingsFile: null, ratchet: null };

// `facts` is what the conductor read from the blueprint files: { [file]: { children, criteria, own } }.
// The root and the children its rows name, parent first. A known node keeps its status.
export function grow(nodes, root, facts = {}) {
    const known = new Map(nodes.map((n) => [n.file, n]));
    const out = [];
    const visit = (file, parent) => {
        if (out.some((n) => n.file === file)) return;
        out.push(known.get(file) ?? { file, parent, status: "drafting" });
        for (const child of facts[file]?.children ?? []) visit(child, file);
    };
    visit(root, null);
    return out;
}

const pick = (o, ...keys) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]));
const here = (state) => state.stage?.node ?? state.blueprint;
const setStatus = (nodes, files, status) => nodes.map((n) => (files.includes(n.file) ? { ...n, status } : n));
// A node is built when every child of it is done.
const ready = (nodes) => nodes.filter((n) => n.status === "building" && nodes.filter((c) => c.parent === n.file).every((c) => c.status === "done"));

// What comes next in the tree: inspect what is built, then build the nodes whose children are done.
// In a small round a child without a criterion of the round sits it out.
function walk(state, nodes, facts) {
    const sitsOut = (n) => n.parent && state.size === "small" && state.criteria.length && facts[n.file] && !facts[n.file].criteria.some((c) => state.criteria.includes(c));
    const rest = nodes.map((n) => (n.status !== "done" && sitsOut(n) ? { ...n, status: "done" } : n));
    const inspecting = rest.find((n) => n.status === "inspecting");
    if (inspecting) return { nodes: rest, stage: { phase: "inspect", input: [], recheck: [], node: inspecting.file } };
    return { nodes: rest, stage: ready(rest).length ? { phase: "replicate", input: [] } : null };
}

// A node is done: the walk goes on with the next one, or the run ends with the report.
function finishNode(state, report, facts) {
    const up = walk(state, setStatus(state.nodes, [here(state)], "done"), facts);
    return up.stage ? { ...state, ...up, ...FRESH, report } : { ...state, nodes: up.nodes, status: "done", stage: null, report };
}

// Removing or rewriting lines of existing tests is the user's call, never the worker's: keep them is the recommendation.
const TESTS_ID = "T1";
const testsAsk = (removed, files) => ({
    id: TESTS_ID,
    question: `${removed} ${removed === 1 ? "line" : "lines"} of existing tests ${removed === 1 ? "was" : "were"} removed or rewritten by the change${files.length ? ` (${files.join(", ")})` : ""}. Keep them and change the code until they pass, or confirm the removal?`,
    options: ["keep", "remove"],
    recommend: "keep",
    confidence: null,
    reason: null,
});

// What the replicate fix round after that answer is told, besides the findings file: the blueprint holds the answer, this says what to do.
const testsInput = (answer, files) => answer === "keep"
    ? `The user keeps the existing tests: restore every removed or rewritten line in ${files.length ? files.join(", ") : "the existing test files"} and change the code until they pass.`
    : answer === "remove" ? "The user confirmed removing the existing test lines." : `The user answered the question about the existing tests: ${answer}`;

// `testLinesRemoved` and `testFiles` are what the conductor counted in the repo after an inspect.
export function advance(state, phase, results, { checkOpen = [], facts = {}, testLinesRemoved = 0, testFiles = [] } = {}) {
    const failed = results.find((r) => r.status === "failed");
    if (failed) return { ...state, status: "failed", report: { phase, blocking_issue: failed.blocking_issue ?? "worker failed without a result" } };

    if (phase === "blueprint") {
        const [r] = results;
        const { stage } = state;
        const blueprint = stage.node ? state.blueprint : r.blueprint_path ?? state.blueprint;
        const open = openDecisions(r, checkOpen);
        // A pass that stops in the middle of the round after the test question still ends in the replicate fix round.
        if (r.status === "blocked") return { ...state, ...absorb(state, r), blueprint, status: "asking", ask: { decisions: open, issue: r.blocking_issue, ...(stage.fix && state.testsAnswer ? { fix: true } : {}) } };
        if (!blueprint) return { ...state, status: "failed", report: { phase, blocking_issue: "blueprint reported no path" } };
        const next = { ...state, ...absorb(state, r), blueprint, ask: null, rounds: state.rounds + 1 };
        // A pass in the middle of a build goes straight back to replicate.
        if (stage.fix) {
            const input = [`Findings file: ${state.findingsFile}`, ...(state.testsAnswer ? [testsInput(state.testsAnswer, state.testFiles)] : [])];
            return withPending(state, { ...next, testsAnswer: null, stage: { phase: "replicate", input, fix: true, ...pick(stage, "node") } });
        }
        if (state.blocks > 0) return withPending(state, { ...next, stage: { phase: "replicate", input: [] } });
        // A draft, an answer or feedback changes the plan, and a blueprint that is done is built at once: every node is built again.
        const nodes = grow(state.nodes, blueprint, facts).map((n) => ({ ...n, status: "building" }));
        return withPending(state, { ...next, ...walk(next, nodes, facts) });
    }
    if (phase === "replicate") {
        const blocked = results.find((r) => r.status === "blocked");
        const changed = union(state.changed, results.flatMap((r) => r.changed_files));
        const { stage } = state;
        const nodes = state.nodes.map((n) => {
            const mine = results.filter((r) => r.node === n.file).flatMap((r) => r.changed_files);
            return mine.length ? { ...n, changed: union(n.changed ?? [], mine) } : n;
        });
        const finished = results.filter((r) => r.status !== "blocked").map((r) => r.node);
        // Only the blueprint can settle what replicate stops on; a second stop in the round ends the run.
        if (blocked) {
            if (state.blocks >= 1) return { ...state, changed, nodes, status: "failed", stage: null, report: { phase, blocking_issue: blocked.blocking_issue } };
            return { ...state, changed, nodes: setStatus(nodes, finished, "inspecting"), blocks: state.blocks + 1, stage: { phase: "blueprint", message: null, input: [`Replicate stopped; settle this in the blueprint: ${blocked.blocking_issue}`], ...(stage.fix && { fix: true }), ...pick(blocked, "node") } };
        }
        // A feedback round rechecks only its criteria; a fix round rechecks everything.
        const recheck = state.rounds > 1 && !stage.fix ? state.criteria : [];
        const built = { ...state, changed, blocks: 0, groups: [] };
        if (state.nodes.length > 1 && !stage.fix) return withPending(state, { ...built, ...walk(state, setStatus(nodes, ready(nodes).map((n) => n.file), "inspecting"), facts) });
        return withPending(state, { ...built, nodes: setStatus(nodes, [here(state)], "inspecting"), stage: { phase: "inspect", input: [], recheck, ...pick(stage, "node") } });
    }
    if (phase === "inspect") {
        const [r] = results;
        const findings = r.findings ?? (r.status === "done" ? 0 : null);
        const progress = state.findings === null || findings < state.findings;
        const stalls = findings > 0 && !progress ? state.stalls + 1 : 0;
        const next = { ...state, findings, stalls, stallAsked: stalls ? state.stallAsked : false, findingsFile: r.findings_file ?? state.findingsFile ?? null, ratchet: r.ratchet ?? null };
        if (state.pending.length) return withPending(state, next);
        if (findings > 0 && stalls >= STALL_LIMIT) {
            const issue = `${findings} findings after ${stalls} rounds without progress: ${next.findingsFile}`;
            // The user was asked once already and the answer changed nothing: stop instead of asking again.
            if (state.stallAsked) return { ...next, status: "failed", stage: null, report: { phase, blocking_issue: issue } };
            return { ...next, stallAsked: true, status: "asking", ask: { decisions: [], issue } };
        }
        const node = pick(state.stage, "node");
        if (r.proposed_criteria.length) return { ...next, stage: { phase: "blueprint", message: null, input: [`Proposed criteria from inspect, with evidence in ${next.findingsFile}:`, ...r.proposed_criteria], fix: true, ...node } };
        if (findings > 0) return { ...next, stage: { phase: "replicate", input: [`Findings file: ${next.findingsFile}`], fix: true, ...node } };
        // A clean inspect ran the rewritten tests green, so only the user can say whether the rewrite was wanted. Once per node:
        // the answer arms `testsDecided`, and the next inspect starts its findings count afresh.
        if (findings === 0 && testLinesRemoved > 0 && !state.testsDecided) {
            const issue = `Existing test lines were removed or rewritten: ${next.findingsFile}`;
            return { ...next, findings: null, testFiles, status: "asking", ask: { decisions: [testsAsk(testLinesRemoved, testFiles)], issue, fix: true } };
        }
        if (state.size === "small") return finishNode(next, { skippedExtract: true }, facts);
        return { ...next, stage: { phase: "extract", input: [], ...node } };
    }
    if (phase === "extract") {
        const [r] = results;
        const earlier = state.report?.captured ? state.report : { captured: [], retired: [] };
        return withPending(state, finishNode(state, { captured: [...earlier.captured, ...(r.captured ?? [])], retired: [...earlier.retired, ...(r.retired ?? [])] }, facts));
    }
    return state;
}

// New feedback: queued while workers run, dispatched right away when the flow is idle.
// After a finished run it starts a new round, small until a blueprint pass says otherwise.
export function feedback(state, text, now) {
    const pending = [...state.pending, { text, at: now }];
    const message = { pending: [], ask: null, status: "running", report: null, stage: { phase: "blueprint", message: pending.map((p) => p.text).join("\n\n"), input: [] } };
    if (state.status === "done" || state.status === "failed") return { ...state, ...message, criteria: [], groups: [], size: "small", blocks: 0, stallAsked: false };
    if (state.status === "asking") return { ...state, ...message };
    return { ...state, pending };
}

// A correction after the report that asks for no new work (a reviewer's diff, a CI result) goes to extract alone.
export function learn(state, text) {
    if (!["done", "failed", "stopped"].includes(state.status)) return state;
    return { ...state, status: "running", ask: null, report: null, stage: { phase: "extract", input: ["Correction after the report:", ...String(text).trim().split("\n")] } };
}

export function answer(state, answers) {
    if (state.status !== "asking") return state;
    const decided = state.ask.decisions.length ? answerMessage(state.ask.decisions, answers) : String(answers.text ?? "").trim();
    const { stage } = state;
    const tests = state.ask.decisions.find((d) => d.id === TESTS_ID);
    const issue = state.ask.issue ? [`Open issue: ${state.ask.issue}`] : [];
    // An ask with findings open, or about removed test lines, keeps the round a fix round, and the blueprint pass sees what the ask was about.
    const open = state.findings > 0 || state.ask.fix ? { input: issue, fix: true, ...pick(stage, "node") } : { input: [], ...pick(stage, "node") };
    // Only an answer settles the test question: feedback that replaces it leaves the gate armed.
    const settled = tests ? { testsDecided: true, testsAnswer: chosen(tests, answers).text } : {};
    return { ...state, ...settled, status: "running", ask: null, stage: { phase: "blueprint", message: decided, ...open } };
}

/* ── jobs and prompts ── */

// One job per phase, except replicate with groups: one job per group, run in waves. In a tree the replicate jobs
// are the nodes whose children are done, one per node.
// A group works on this round's criteria only: those it names and those of its boundary rows in the current
// blueprint (a later pass may have added one). A group left without any sits the round out.
export function waves(state, { boundaryCriteria = {}, facts = {} } = {}) {
    const { stage } = state;
    if (!stage) return [];
    const round = (ids) => (state.criteria.length ? ids.filter((c) => state.criteria.includes(c)) : ids);
    if (stage.phase === "replicate" && !stage.fix && state.nodes.length > 1) return nodeJobs(state, facts, round);
    const groups = state.groups
        .map((g) => ({ ...g, criteria: round(union(list(g.criteria), list(g.boundaries).flatMap((b) => boundaryCriteria[b] ?? []))) }))
        .filter((g) => g.criteria.length);
    if (stage.phase === "replicate" && !stage.fix && groups.length > 1) {
        const byWave = new Map();
        for (const g of groups) byWave.set(Number(g.wave ?? 1), [...(byWave.get(Number(g.wave ?? 1)) ?? []), g]);
        return [...byWave.entries()].sort(([a], [b]) => a - b).map(([, wave]) => ({
            parallel: wave.every((g) => g.parallel !== false),
            jobs: wave.map((g) => ({ phase: "replicate", group: g.id, input: [`Group ${g.id}, wave ${g.wave ?? 1}: boundaries ${list(g.boundaries).join(", ")}; criteria ${g.criteria.join(", ")}. Other groups may edit other files at the same time.`] })),
        }));
    }
    const input = [...stage.input];
    if (stage.phase === "replicate" && !stage.fix && state.criteria.length) input.push(`Criterion IDs: ${state.criteria.join(", ")}`);
    if (stage.phase === "inspect") {
        // A child is inspected on the files its own replicate changed; the root on all of them.
        const node = state.nodes.find((n) => n.file === stage.node);
        input.push(`Changed files: ${(node?.parent ? node.changed ?? [] : state.changed).join(", ") || "none reported"}`);
        if (stage.recheck?.length) input.push(`Criterion IDs to recheck: ${stage.recheck.join(", ")}`);
    }
    return [{ parallel: false, jobs: [{ phase: stage.phase, input, message: stage.phase === "blueprint" ? stage.message : null, ...pick(stage, "node") }] }];
}

// A parent builds the rows that name no child. Children are built one after another.
// A round without a criterion of its own for a node builds all of the node's criteria, except in a small round.
function nodeJobs(state, facts, round) {
    const pickIds = (ids) => {
        const mine = round(ids);
        return mine.length || state.size === "small" ? mine : ids;
    };
    const jobs = [];
    for (const n of ready(state.nodes)) {
        const f = facts[n.file] ?? { criteria: [], own: { boundaries: [], criteria: [] } };
        const parent = state.nodes.some((c) => c.parent === n.file);
        const ids = pickIds(parent ? f.own.criteria : f.criteria);
        if (!ids.length) continue;
        jobs.push({ phase: "replicate", node: n.file, input: [`Criterion IDs: ${ids.join(", ")}`, ...(parent ? [`Boundary rows: ${f.own.boundaries.join(", ")}`] : [])] });
    }
    return jobs.length ? [{ parallel: false, jobs }] : [];
}

// The dispatch prompt template is the ```text block in ORCHESTRATION.md.
export function templateFrom(orchestration) {
    const m = orchestration.match(/```text\n([\s\S]*?)```/);
    if (!m) throw new Error("ORCHESTRATION.md has no ```text dispatch template");
    return m[1].split("\n").map((l) => l.replace(/^ {2}/, "")).join("\n").trim();
}

export function promptFor(template, job, state) {
    const out = [];
    let inMessage = false;
    for (const line of template.split("\n")) {
        if (line.startsWith("Use the minime")) out.push(`Use the minime ${job.phase} skill.`);
        else if (line.startsWith("Blueprint:")) out.push(`Blueprint: ${job.node ?? state.blueprint ?? "new"}`);
        else if (line.startsWith("Repo:")) out.push(`Repo: ${state.repo}`);
        else if (line.startsWith("<phase input")) out.push(...job.input);
        else if (line.startsWith("User message:")) {
            inMessage = true;
            if (job.message) out.push("User message:", job.message);
        } else if (line.startsWith("End of user message.")) {
            inMessage = false;
            if (job.message) out.push(line);
        } else if (!inMessage) out.push(line);
    }
    return out.join("\n");
}

export const agentFor = (phase) => AGENTS[phase] ?? null;

/* ── board ── */

// Criterion IDs that the findings file names under "## Findings".
export function criteriaWithFindings(findingsText) {
    const section = String(findingsText ?? "").split(/^## /m).find((s) => /^Findings\b/.test(s)) ?? "";
    if (/^Findings\s*\n+\s*None\./.test(section)) return [];
    return [...new Set([...section.matchAll(/\bC\d+\b/g)].map((m) => m[0]))];
}

export function scores(state, board) {
    const jobs = state.jobs.filter((j) => j.ended);
    const criteria = board?.criteria ?? [];
    return {
        proven: criteria.filter((c) => c.tests.length && !c.finding).length,
        criteria: criteria.length,
        netLines: board?.diff ? board.diff.added - board.diff.removed : 0,
        copiedBlocks: board?.diff?.duplicates?.length ?? 0,
        surprises: board?.check?.sources?.surprise ?? 0,
        defaults: board?.check?.sources?.default ?? 0,
        rounds: state.rounds,
        requests: jobs.reduce((n, j) => n + (j.usage?.premiumRequests ?? 0), 0),
        minutes: Math.round(jobs.reduce((n, j) => n + (j.ended - j.started), 0) / 6000) / 10,
    };
}
