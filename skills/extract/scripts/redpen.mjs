#!/usr/bin/env node
// Session red pen: the user's own corrections, read from Claude Code and Copilot CLI session logs.
// Lists the rules the user restated, each with the user's quote as its receipt, and the corrections no rule names.
//   node redpen.mjs [--since YYYY-MM-DD] [--repo <substring of the working directory>] [--claude <dir>] [--copilot <dir>] [--json]
// Reads only; prints markdown (or JSON) for extract to weigh against the wiki's bar.

import { readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* ── calculations ── */

// Turns the hosts inject as user messages. None of them is the user's words.
const INJECTED = [/<system-reminder>/, /<task-notification>/, /<command-name>/, /<local-command-/, /Another Claude session sent/, /\[Request interrupted/,
    /Stop hook feedback/, /<agent-message/, /<cross-session-message/, /This session is being continued/, /<bash-input>/, /^\[Image/, /<ide_/, /^\[Cross-session/, /<minime-workflow-nudge>/,
    /^Base directory for this skill:/, /^Review target:/, /session-scoped Stop hook is now active/];

export function isInjected(text) { return INJECTED.some((re) => re.test(text)); }

function textOf(content) {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content.filter((b) => b && b.type === "text").map((b) => b.text).join("\n");
}

function parseLines(jsonl) {
    const out = [];
    for (const line of jsonl.split("\n")) {
        if (!line.startsWith("{")) continue;
        try { out.push(JSON.parse(line)); } catch { /* a cut line */ }
    }
    return out;
}

// Claude Code: `turnOrigin` says who wrote the turn (human, scheduled, peer, task_notification); older entries carry none.
export function claudeTurns(jsonl, session) {
    const turns = [];
    for (const e of parseLines(jsonl)) {
        if (e.type !== "user") continue;
        const text = textOf(e.message?.content).trim();
        if (!text || isInjected(text)) continue;
        const origin = e.turnOrigin === "scheduled" ? "auto" : e.turnOrigin === "human" || e.turnOrigin == null ? "typed" : null;
        if (!origin) continue;
        turns.push({ host: "claude", session, cwd: e.cwd ?? "", ts: e.timestamp ?? "", origin, text });
    }
    return turns;
}

// Copilot CLI: `source` names another agent (steering), autopilot or system; `parentAgentTaskId` marks a scripted brief to a subagent.
export function copilotTurns(jsonl, session, cwd = "") {
    const turns = [];
    for (const e of parseLines(jsonl)) {
        if (e.type !== "user.message") continue;
        const text = (e.data?.content ?? "").trim();
        if (!text) continue;
        const source = e.data?.source ?? "";
        const origin = source.startsWith("agent-") ? "steer" : source === "autopilot" || source === "system" ? "auto" : e.data?.parentAgentTaskId ? "brief" : "typed";
        turns.push({ host: "copilot", session, cwd, ts: e.timestamp ?? "", origin, text });
    }
    return turns;
}

// Rules the user has restated across sessions. A pattern matches the user's wording, typos included.
export const RULES = [
    { id: "no-git-writes", rule: "Never stage, commit or push unless the user asks in this turn",
        patterns: [/\b(don'?t|dont|never|no|not|without)\b[^.\n]{0,40}\b(stag(e|ing)|commit|push)/i, /\bno commits?\b/i, /ondt push/i] },
    { id: "real-runs", rule: "Verification is a real run, never a summary or a mock",
        patterns: [/\breal\b[^.\n]{0,20}\b(copilot|run|rerun|runs|end to end|e2e|backend|model|environment)\b/i, /\b(actually|really) (run|work|red)/i, /run it against/i, /live validation/i, /no synt?hetic/i, /\btests? (it )?yourself\b/i, /\brun\b[^.\n]{0,30}\bend to end\b/i] },
    { id: "sub-sessions", rule: "Long work runs in sub-sessions; the parent keeps a ledger",
        patterns: [/sub ?sessions?/i, /subagents? [^.\n]{0,30}context/i, /(protect|manage|blow up|overfull)[^.\n]{0,20}context/i, /context[^.\n]{0,20}(overfull|size)/i] },
    { id: "no-sleep", rule: "No sleeps or polling intervals; wait on the thing with a timeout",
        patterns: [/(never|no|not|don'?t|dont|bad)[^.\n]{0,30}\b(sleep|poll|polling|interval)/i, /\b(sleep|poll(ing)?|interval)\b[^.\n]{0,40}\b(bad|not a goo?e?d)/i] },
    { id: "act-like-user", rule: "Tests act like a user: no URL navigation to blades, no focus(), no viewport asserts",
        patterns: [/like a (real )?user/i, /as a user would/i, /\buser would\b/i, /not a user action/i, /toBeInViewport/i, /open blades? by url/i, /\bfocus\(\)/i, /not use "?focus"?/i] },
    { id: "no-slop", rule: "No comments that restate code; short direct sentences",
        patterns: [/\bslop\b/i, /blabla/i, /obvious things/i, /useless details/i, /stupid [^.\n]{0,10}comments/i, /s[e]?micolon/i, /\bvomit\b/i] },
    { id: "inline-single-caller", rule: "A helper exists only when two places call it",
        patterns: [/single (place|caller|call ?site)/i, /only called (from|in) one/i, /called from a single/i, /called from one place/i, /used only in one place/i, /(only|just) (used|called) (in|from|at) (a )?(single|one) (place|site|caller)/i] },
    { id: "lean", rule: "Smaller is better: adapt, don't add",
        patterns: [/\blean\b/i, /small and efficient/i, /almost no prose/i, /light and fun/i, /faster and simpler/i, /not with adding more/i, /\bsimpl(er|e and predictable)\b/i] },
    { id: "browser-tool", rule: "Browser automation through Playwright MCP on Edge, not the built-in browser",
        patterns: [/playw\w{0,3}ight mcp/i, /not claude-in-chrome/i, /with edge\b/i] },
    { id: "upstream", rule: "Stay mergeable from upstream; update MANUAL_REVIEW.md after merges",
        patterns: [/\bupa?stream\b/i, /MANUAL_REVIEW/] },
    { id: "branch-policy", rule: "Branch policy is per repo: main allowed here, a named feature branch there",
        patterns: [/\b(on|into|to|with) (the )?main( branch)?\b/i, /directly on main/i, /dont change any branch/i, /don'?t change (the )?branch/i, /\bwork on branches?\b/i] },
    { id: "no-ai-attribution", rule: "No AI attribution in commits or PRs",
        patterns: [/co-?authored/i, /\battribution\b/i, /generated with claude/i] },
];

export function matches(text, rule) { return rule.patterns.some((re) => re.test(text)); }

// The shape of a correction: a turn that starts by pushing back, or carries a standing "never/don't".
const CORRECTION = [/^(no\b|not\b|don'?t|dont\b|never\b|stop\b|wrong\b|why (did|do|are)|only\b|please don'?t|again\b|instead\b|forget\b|revert\b|undo\b|that'?s not|i (said|told|asked)|no no)/i,
    /\b(never|don'?t|dont|please don'?t|no more|stop (adding|doing|using|with)|i said|i told you|not what i|what a mess|too brittle|overkill|weird)\b/i];
export function isCorrection(text) { return CORRECTION.some((re) => re.test(text)); }

export function quote(text, max = 160) {
    const one = text.replace(/\s+/g, " ").trim();
    return one.length > max ? one.slice(0, max - 1) + "…" : one;
}

const receipt = (t) => ({ host: t.host, session: t.session, ts: t.ts, cwd: t.cwd, quote: quote(t.text) });

// Per rule: how often the user said it, in how many sessions, how often an orchestrator relayed it; then the corrections no rule names.
export function tally(turns, rules = RULES) {
    const user = turns.filter((t) => t.origin === "typed");
    const steer = turns.filter((t) => t.origin === "steer");
    const byRule = rules.map((rule) => {
        const hits = user.filter((t) => matches(t.text, rule));
        const relays = steer.filter((t) => matches(t.text, rule)).length;
        return { id: rule.id, rule: rule.rule, count: hits.length, sessions: new Set(hits.map((t) => t.session)).size, relays, receipts: hits.map(receipt) };
    }).filter((r) => r.count > 0 || r.relays > 0).sort((a, b) => b.count - a.count || b.relays - a.relays);
    const other = user.filter((t) => isCorrection(t.text) && !rules.some((r) => matches(t.text, r))).map(receipt);
    return { typed: user.length, steer: steer.length, rules: byRule, other };
}

const where = (r) => `${r.host} ${r.session.slice(0, 8)} ${r.ts.slice(0, 10)}${r.cwd ? " " + path.basename(r.cwd) : ""}`;

export function render(report, { since, perRule = 5, others = 40 } = {}) {
    const lines = [`# Session red pen${since ? " since " + since : ""}`, "",
        `${report.typed} typed turns and ${report.steer} orchestrator steering messages read. Each quote is the user's receipt; a rule restated in two or more sessions earns a wiki rule when the schema's bar holds.`, "",
        "## Rules the user restated", ""];
    for (const r of report.rules) {
        lines.push(`### ${r.rule}`, `${r.count} times in ${r.sessions} sessions${r.relays ? `, relayed by orchestrators ${r.relays} times` : ""} (${r.id})`);
        for (const q of r.receipts.slice(0, perRule)) lines.push(`- "${q.quote}" (${where(q)})`);
        lines.push("");
    }
    lines.push("## Corrections no rule names", "");
    for (const q of report.other.slice(0, others)) lines.push(`- "${q.quote}" (${where(q)})`);
    if (report.other.length > others) lines.push(`- … ${report.other.length - others} more in the JSON output`);
    return lines.join("\n") + "\n";
}

/* ── actions ── */

function arg(argv, name, fallback) { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback; }

function newerThan(file, since) { try { return !since || statSync(file).mtime >= since; } catch { return false; } }

function cwdOf(workspaceYaml) {
    try { return (readFileSync(workspaceYaml, "utf8").match(/^cwd:\s*(.+)$/m) ?? [])[1]?.trim() ?? ""; } catch { return ""; }
}

export function readClaude(dir, since) {
    const turns = [];
    for (const project of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
        const projectDir = path.join(dir, project.name);
        for (const f of readdirSync(projectDir).filter((n) => n.endsWith(".jsonl"))) {
            const file = path.join(projectDir, f);
            if (newerThan(file, since)) turns.push(...claudeTurns(readFileSync(file, "utf8"), f.replace(/\.jsonl$/, "")));
        }
    }
    return turns;
}

export function readCopilot(dir, since) {
    const turns = [];
    for (const s of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith("."))) {
        const file = path.join(dir, s.name, "events.jsonl");
        if (newerThan(file, since)) turns.push(...copilotTurns(readFileSync(file, "utf8"), s.name, cwdOf(path.join(dir, s.name, "workspace.yaml"))));
    }
    return turns;
}

function main(argv) {
    const sinceText = arg(argv, "--since", null);
    const since = sinceText ? new Date(sinceText) : null;
    const repo = arg(argv, "--repo", null);
    const home = os.homedir();
    let turns = [
        ...readClaude(arg(argv, "--claude", path.join(home, ".claude", "projects")), since),
        ...readCopilot(arg(argv, "--copilot", path.join(home, ".copilot", "session-state")), since),
    ];
    if (since) turns = turns.filter((t) => !t.ts || new Date(t.ts) >= since);
    if (repo) turns = turns.filter((t) => t.cwd.includes(repo));
    const report = tally(turns);
    process.stdout.write(argv.includes("--json") ? JSON.stringify(report, null, 2) + "\n" : render(report, { since: sinceText }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
