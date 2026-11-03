// The guard hook's decisions as calculations: no file or process access here.
// Three rules, in both hosts (Claude Code and Copilot CLI read the same hooks.json):
//   a PAUSED file stops every tool and prompt; git history and GitHub writes are denied unless the user allowed them for this session;
//   a prompt whose last replies were identical three times trips a breaker, so a scheduled run stops repeating itself.

import { createHash } from "node:crypto";

// Same list as the conductor's worker denials: nothing that changes history or leaves the machine.
export const DENIED = ["git push", "git commit", "git add", "git stash", "git reset", "git checkout", "git restore", "git rebase",
    "gh repo fork", "gh repo create", "gh repo delete", "gh pr create", "gh pr merge", "gh release create", "gh issue create", "gh api -X", "gh api --method"];

export const BREAKER_LIMIT = 3;

export function isShell(toolName) { return /^(bash|shell|powershell|run_in_terminal|terminal|execute)/i.test(toolName ?? ""); }

export function commandOf(input) {
    const args = input.tool_input ?? input.toolArgs ?? input.tool_args ?? {};
    if (typeof args === "string") return args;
    return String(args.command ?? args.cmd ?? args.script ?? "");
}

// The first denied command in a chain. Segments split on the shell's own separators; a leading sudo/env/command wrapper is skipped.
export function deniedCommand(command) {
    for (const seg of String(command).split(/\s*(?:&&|\|\||;|\n|\|)\s*/)) {
        const s = seg.replace(/^(sudo|env|command)\s+/, "").trim();
        const hit = DENIED.find((d) => s === d || s.startsWith(d + " "));
        if (hit) return hit;
    }
    return null;
}

export function attributed(command) { return /co-?authored-by:\s*claude|generated with \[?claude/i.test(String(command)); }

// One decision for every event. `allow` means the hook stays silent.
export function decide({ event, toolName, command, paused, allowGit, tripped }) {
    if (paused) return { decision: "deny", reason: `minime: PAUSED file at ${paused}; remove it to continue` };
    if (tripped) return { decision: "deny", reason: `minime: circuit breaker tripped, the last ${BREAKER_LIMIT} replies to this prompt were identical; delete ${tripped} to re-arm` };
    if (event !== "PreToolUse" || !isShell(toolName)) return { decision: "allow" };
    if (attributed(command)) return { decision: "deny", reason: "minime: no AI attribution in commits or PRs; drop the Co-Authored-By / Generated with line" };
    const hit = deniedCommand(command);
    if (hit && !allowGit) return { decision: "deny", reason: `minime: '${hit}' changes history or leaves the machine; the user commits, or allows it for this session with MINIME_ALLOW_GIT=1 or an allow-git file in VIRTUCON_HQ` };
    return { decision: "allow" };
}

// Hook output both hosts read: Copilot takes the top-level keys, Claude Code the hookSpecificOutput block (PreToolUse) or decision/reason (prompts).
export function output(event, verdict) {
    if (verdict.decision === "allow") return {};
    if (event === "PreToolUse") {
        return { permissionDecision: "deny", permissionDecisionReason: verdict.reason,
            hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: verdict.reason } };
    }
    return { decision: "block", reason: verdict.reason };
}

/* ── the breaker ── */

export function normalize(text) { return String(text).toLowerCase().replace(/[\d\s\p{P}]+/gu, ""); }

export function key(text) { return createHash("sha1").update(normalize(text)).digest("hex").slice(0, 12); }

// Streak of identical replies; tripped once it reaches the limit.
export function breakerState(prev, reply, limit = BREAKER_LIMIT) {
    const last = normalize(reply);
    if (!last) return { streak: 0, last: "", tripped: false };
    const streak = prev && prev.last === last ? prev.streak + 1 : 1;
    return { streak, last, tripped: streak >= limit };
}

function lines(transcript) {
    const out = [];
    for (const line of String(transcript).split("\n")) {
        if (!line.startsWith("{")) continue;
        try { out.push(JSON.parse(line)); } catch { /* a cut line */ }
    }
    return out;
}

const textOf = (content) => typeof content === "string" ? content : Array.isArray(content) ? content.filter((b) => b?.type === "text").map((b) => b.text).join("\n") : "";

// The main agent's last reply, from a Claude Code transcript or a Copilot events file.
export function lastAssistant(transcript) {
    let last = "";
    for (const e of lines(transcript)) {
        if (e.type === "assistant" && !e.isSidechain) { const t = textOf(e.message?.content).trim(); if (t) last = t; }
        if (e.type === "assistant.message" && !e.agentId && e.data?.content?.trim()) last = e.data.content.trim();
    }
    return last;
}

// The prompt that started the session: the breaker's key, so a scheduled prompt is one thing across its runs.
export function firstPrompt(transcript) {
    for (const e of lines(transcript)) {
        if (e.type === "user" && !e.isSidechain) { const t = textOf(e.message?.content).trim(); if (t && !t.startsWith("<")) return t; }
        if (e.type === "user.message" && e.data?.content?.trim() && !e.data.parentAgentTaskId) return e.data.content.trim();
    }
    return "";
}
