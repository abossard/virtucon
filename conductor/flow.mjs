// The minime flow as data and calculations. The conductor (minime.mjs) runs the actions.
// The flow itself is described in assets/ORCHESTRATION.md, which also owns the dispatch prompt.

export const PHASES = ["blueprint", "replicate", "inspect", "extract"];
const AGENTS = { inspect: "minime:frau" };
export const STALL_LIMIT = 2;
export const REPEAT_LIMIT = 2;

/* ── state ── */

// The wiki scope of a repo from its origin URL: <org>/<repo>. No remote: local/<directory name>.
export function scopeOf(origin, dirName) {
    const cleaned = String(origin ?? "").trim()
        .replace(/^https?:\/\/([^.]+)\.visualstudio\.com\/.+\/_git\/(.+)$/, "$1/$2")
        .replace(/^https?:\/\/dev\.azure\.com\/([^/]+)\/.+\/_git\/(.+)$/, "$1/$2")
        .replace(/^git@ssh\.dev\.azure\.com:v3\/([^/]+)\/[^/]+\/(.+)$/, "$1/$2")
        .replace(/^.*github\.com[:/]/, "")
        .replace(/^.*gitlab\.com[:/]/, "")
        .replace(/^.*bitbucket\.org[:/]/, "")
        .replace(/\.git$/, "");
    if (!cleaned) return { org: "local", repo: dirName };
    const [org, repo] = cleaned.split("/");
    return { org: org || "local", repo: repo || org };
}

// `budget` is the fuel gauge: premium requests, worker minutes, and how often the same blocking issue may return. null is no cap.
export function newRun({ task, repo, hq, plugin, model, now, budget = {} }) {
    return {
        task, repo, hq, plugin, model: model ?? null, started: now,
        budget: { requests: null, minutes: null, repeats: REPEAT_LIMIT, ...budget },
        stopReason: null,
        status: "running", // running | asking | paused | done | stopped | failed
        stage: { phase: "blueprint", message: task, input: [] },
        blueprint: null,
        baseline: null, // replicate's run of the project's tests on untouched HEAD, handed to inspect
        criteria: [],
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
const absorb = (state, r) => ({ criteria: union(state.criteria, r.criteria) });

// Feedback that arrived while workers ran goes to blueprint before anything else.
function withPending(state, next) {
    if (!state.pending.length) return next;
    return { ...next, stage: { phase: "blueprint", message: state.pending.map((p) => p.text).join("\n\n"), input: [] }, pending: [], status: "running", report: null, blocks: 0 };
}

/* ── the build ── */

const pick = (o, ...keys) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]));

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
export function advance(state, phase, results, { checkOpen = [], testLinesRemoved = 0, testFiles = [] } = {}) {
    const failed = results.find((r) => r.status === "failed");
    if (failed) return { ...state, status: "failed", report: { phase, blocking_issue: failed.blocking_issue ?? "worker failed without a result" } };

    if (phase === "blueprint") {
        const [r] = results;
        const { stage } = state;
        const blueprint = r.blueprint_path ?? state.blueprint;
        const open = openDecisions(r, checkOpen);
        // A pass that stops in the middle of the round after the test question still ends in the replicate fix round.
        if (r.status === "blocked") return { ...state, ...absorb(state, r), blueprint, status: "asking", ask: { decisions: open, issue: r.blocking_issue, ...(stage.fix && state.testsAnswer ? { fix: true } : {}) } };
        if (!blueprint) return { ...state, status: "failed", report: { phase, blocking_issue: "blueprint reported no path" } };
        const next = { ...state, ...absorb(state, r), blueprint, ask: null, rounds: state.rounds + 1 };
        // A pass in the middle of a build goes straight back to replicate.
        if (stage.fix) {
            const input = [`Findings file: ${state.findingsFile}`, ...(state.testsAnswer ? [testsInput(state.testsAnswer, state.testFiles)] : [])];
            return withPending(state, { ...next, testsAnswer: null, stage: { phase: "replicate", input, fix: true } });
        }
        // A blueprint that is done is built at once, by one replicate job: one build per blueprint.
        return withPending(state, { ...next, stage: { phase: "replicate", input: [] } });
    }
    if (phase === "replicate") {
        const blocked = results.find((r) => r.status === "blocked");
        const changed = union(state.changed, results.flatMap((r) => r.changed_files));
        const { stage } = state;
        // The preflight line (the tests on untouched HEAD) is inspect's baseline for the rest of the run.
        const baseline = results.flatMap((r) => r.evidence_excerpts).find((e) => /\bon HEAD\b/.test(e)) ?? state.baseline;
        // Only the blueprint can settle what replicate stops on; a second stop in the round ends the run.
        if (blocked) {
            if (state.blocks >= 1) return { ...state, changed, baseline, status: "failed", stage: null, report: { phase, blocking_issue: blocked.blocking_issue } };
            return { ...state, changed, baseline, blocks: state.blocks + 1, stage: { phase: "blueprint", message: null, input: [`Replicate stopped; settle this in the blueprint: ${blocked.blocking_issue}`], ...(stage.fix && { fix: true }) } };
        }
        // A feedback round rechecks only its criteria; a fix round rechecks everything.
        const recheck = state.rounds > 1 && !stage.fix ? state.criteria : [];
        return withPending(state, { ...state, changed, baseline, blocks: 0, stage: { phase: "inspect", input: [], recheck } });
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
        if (r.proposed_criteria.length) return { ...next, stage: { phase: "blueprint", message: null, input: [`Proposed criteria from inspect, with evidence in ${next.findingsFile}:`, ...r.proposed_criteria], fix: true } };
        if (findings > 0) return { ...next, stage: { phase: "replicate", input: [`Findings file: ${next.findingsFile}`], fix: true } };
        // A clean inspect ran the rewritten tests green, so only the user can say whether the rewrite was wanted. Once per
        // blueprint: the answer arms `testsDecided`, and the next inspect starts its findings count afresh.
        if (findings === 0 && testLinesRemoved > 0 && !state.testsDecided) {
            const issue = `Existing test lines were removed or rewritten: ${next.findingsFile}`;
            return { ...next, findings: null, testFiles, status: "asking", ask: { decisions: [testsAsk(testLinesRemoved, testFiles)], issue, fix: true } };
        }
        return { ...next, stage: { phase: "extract", input: [] } };
    }
    if (phase === "extract") {
        const [r] = results;
        const earlier = state.report?.captured ? state.report : { captured: [], retired: [] };
        return withPending(state, { ...state, status: "done", stage: null, report: { captured: [...earlier.captured, ...(r.captured ?? [])], retired: [...earlier.retired, ...(r.retired ?? [])] } });
    }
    return state;
}

// New feedback: queued while workers run, dispatched right away when the flow is idle.
// After a finished run it starts a new round.
export function feedback(state, text, now) {
    const pending = [...state.pending, { text, at: now }];
    const message = { pending: [], ask: null, status: "running", report: null, stage: { phase: "blueprint", message: pending.map((p) => p.text).join("\n\n"), input: [] } };
    if (state.status === "done" || state.status === "failed") return { ...state, ...message, criteria: [], blocks: 0, stallAsked: false };
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
    const tests = state.ask.decisions.find((d) => d.id === TESTS_ID);
    const issue = state.ask.issue ? [`Open issue: ${state.ask.issue}`] : [];
    // An ask with findings open, or about removed test lines, keeps the round a fix round, and the blueprint pass sees what the ask was about.
    const open = state.findings > 0 || state.ask.fix ? { input: issue, fix: true } : { input: [] };
    // Only an answer settles the test question: feedback that replaces it leaves the gate armed.
    const settled = tests ? { testsDecided: true, testsAnswer: chosen(tests, answers).text } : {};
    return { ...state, ...settled, status: "running", ask: null, stage: { phase: "blueprint", message: decided, ...open } };
}

/* ── jobs and prompts ── */

// One job per phase. The blueprint job carries the repo's wiki index and its past runs inline: a path in a nudge was
// never opened (rounds 3 and 4).
export function waves(state, { wiki = null } = {}) {
    const { stage } = state;
    if (!stage) return [];
    const input = [...stage.input];
    if (stage.phase === "blueprint" && wiki?.index) input.push(`Wiki index of this repo (${wiki.index.path}); cite a rule you apply as [research: wiki <page path>#<anchor>]:`, wiki.index.text.trim());
    if (stage.phase === "blueprint" && wiki?.runs) input.push(`Past runs of this repo (${wiki.runs.path}); the test command of a proven run is the preflight command:`, wiki.runs.text.trim());
    if (stage.phase === "replicate" && !stage.fix && state.criteria.length) input.push(`Criterion IDs: ${state.criteria.join(", ")}`);
    if (stage.phase === "inspect") {
        input.push(`Changed files: ${state.changed.join(", ") || "none reported"}`);
        if (stage.recheck?.length) input.push(`Criterion IDs to recheck: ${stage.recheck.join(", ")}`);
        if (state.baseline) input.push(`Baseline: ${state.baseline}`);
    }
    return [{ parallel: false, jobs: [{ phase: stage.phase, input, message: stage.phase === "blueprint" ? stage.message : null }] }];
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
        else if (line.startsWith("Blueprint:")) out.push(`Blueprint: ${state.blueprint ?? "new"}`);
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
        wiki: board?.check?.sources?.wiki ?? 0,
        rounds: state.rounds,
        requests: jobs.reduce((n, j) => n + (j.usage?.premiumRequests ?? 0), 0),
        minutes: Math.round(jobs.reduce((n, j) => n + (j.ended - j.started), 0) / 6000) / 10,
    };
}

/* ── the fuel gauge ── */

// The issue the last n finished jobs all returned: the identical blocking issue text, or the same open decisions by
// criterion ID. Workers reword an issue every time, the IDs stay (round 4: one decision asked 76 times, never caught).
function repeatedIssue(jobs, n) {
    const last = jobs.filter((j) => j.ended).slice(-n);
    if (n <= 0 || last.length < n) return null;
    const issues = last.map((j) => j.result?.blocking_issue ?? null);
    if (issues[0] && issues.every((i) => i === issues[0])) return issues[0];
    const ids = last.map((j) => (j.result?.open_decisions ?? []).map((d) => d.id).filter(Boolean).sort().join(", "));
    return ids[0] && ids.every((i) => i === ids[0]) ? `open decision ${ids[0]}` : null;
}

// Why the run is out of fuel, or null. Checked after every wave; a run that stops keeps the proof it has.
export function overBudget(state) {
    const { requests, minutes } = scores(state);
    const b = state.budget ?? {};
    if (b.requests != null && requests >= b.requests) return `${requests} premium requests, cap ${b.requests}`;
    if (b.minutes != null && minutes >= b.minutes) return `${minutes} worker minutes, cap ${b.minutes}`;
    const issue = repeatedIssue(state.jobs, b.repeats ?? REPEAT_LIMIT);
    return issue ? `the same blocking issue ${b.repeats ?? REPEAT_LIMIT} times: ${issue}` : null;
}

export const stopped = (state, reason) => ({ ...state, status: "stopped", stopReason: reason, stage: null, ask: null, paused: false });

/* ── the verdict ── */

const RATCHET = [["interface_changes_outside_boundaries", "interface changes outside the boundaries"], ["single_caller_functions", "single-caller functions"], ["copied_blocks", "copied blocks"]];

// Done is computed, never reported. Proven means: every criterion names a test file and has no finding, inspect
// ran on this exact tree and found nothing, and the ratchet is clean. A worker's status only says what to do next.
// One line of the repo's run receipts (raw/<org>/<repo>/runs.md): what this run used and what it proved, from the
// state alone. The next blueprint reads the last lines, so a repo's flow can repeat what worked and skip what blocked.
export const RUNS_HEADER = "# Runs\n\nOne line per conductor run, written by the conductor when the run ends: the verdict from the proof board, the jobs per phase, the cost, the preflight test command, and what stopped it.\n\n| Date | Task | Verdict | Phases | Cost | Tests | Stopped on |\n|---|---|---|---|---|---|---|\n";
export function receipt(state, board, verdict, now) {
    const jobs = state.jobs.filter((j) => j.ended);
    const phases = PHASES.map((p) => {
        const mine = jobs.filter((j) => j.phase === p);
        if (!mine.length) return null;
        const blocked = mine.filter((j) => (j.status ?? j.result?.status) === "blocked").length;
        const findings = p === "inspect" ? mine.map((j) => j.result?.findings).filter((n) => n != null) : [];
        return `${p} ${mine.length}${blocked ? ` (${blocked} blocked)` : ""}${findings.length ? ` (findings ${findings.join(" → ")})` : ""}`;
    }).filter(Boolean).join(", ");
    const { requests, minutes } = scores(state, board);
    const cell = (s) => String(s ?? "-").replace(/\s+/g, " ").replace(/\|/g, "/").trim().slice(0, 160);
    const stopped = state.stopReason ?? state.report?.blocking_issue ?? (state.status === "done" ? "-" : state.status);
    return `| ${new Date(now).toISOString().slice(0, 10)} | ${cell(state.task).slice(0, 60)} | ${verdict.proven ? "proven" : `unproven: ${cell(verdict.gaps.join("; "))}`} | ${phases || "-"} | ${requests} req, ${minutes} min | ${cell(state.baseline)} | ${cell(stopped)} |`;
}

export function verdict(state, board, tree = null) {
    const gaps = [];
    const criteria = board?.criteria ?? [];
    if (!criteria.length) gaps.push("no criteria");
    for (const c of criteria) {
        if (!c.tests.length) gaps.push(`${c.id}: no test`);
        else if (c.finding) gaps.push(`${c.id}: finding`);
    }
    const inspect = [...state.jobs].reverse().find((j) => j.phase === "inspect" && j.ended);
    if (!inspect) gaps.push("no inspection");
    else if (tree && inspect.tree && inspect.tree !== tree) gaps.push("the tree changed after the last inspection");
    if (state.findings !== 0) gaps.push(state.findings === null ? "no findings count" : `${state.findings} findings`);
    const r = state.ratchet ?? {};
    for (const [key, label] of RATCHET) if (Number(r[key]) > 0) gaps.push(`ratchet: ${r[key]} ${label}`);
    if (Number(r.test_lines_removed) > 0 && !state.testsDecided) gaps.push(`ratchet: ${r.test_lines_removed} test lines removed`);
    return { proven: gaps.length === 0, gaps };
}
