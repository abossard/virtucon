# minime

**Evidence-based agent orchestration for Claude Code and GitHub Copilot.**
A four-phase workflow — `plan → implement → review → harvest` — that collapses
the usual `brainstorm → plan-review → code → code-review` pipeline into **one
tiered human review gate**, kept cheap by handing the reviewer an evidence
package instead of a verdict.

Every design choice traces to empirical work (DeepMind 2025, Springer 2026,
ClassEval, ReasoningBank). See [`assets/.agent/research/REFERENCES.md`](assets/.agent/research/REFERENCES.md).

---

## What you get

Five skills + two agents, distributed as a plugin:

| Skill | Phase | Auto-invoked? |
|---|---|---|
| `/minime:plan` | Read wiki, nudge EARS quality if needed, plan silently, self-challenge | yes |
| `/minime:implement` | Test-driven generate→run→observe→fix loop | yes |
| `/minime:review` | Compute risk tier; auto-merge LOW, escalate HIGH with evidence package | yes |
| `/minime:harvest` | Capture corrections into the per-repo wiki as cited rules | yes |
| `/minime:init-orchestration` | One-time bootstrap of user-home minime state (no repo writes) | manual only |

| Agent | Role |
|---|---|
| `minime:director` | Runs the flow end-to-end. Designed for `claude --agent minime:director` (autopilot mode for a single task). Re-injects discipline at phase boundaries, decides when online research is required before planning, orchestrates strong fresh-context subagents for evidence gathering, and asks the user for sources/proceed mode when needed. |
| `minime:reviewer` | Read-only reviewer. No Edit/Write tools — structurally cannot "fix" things, can only surface. The `review` skill forks into this agent automatically so the review runs in a fresh context window with no implementation bias. Can also be invoked directly with `@agent-minime:reviewer`. |

Runtime state lives in user home (not in your working repository):
`$HOME/.minime/templates/task.template.md`, `$HOME/.minime/wiki/repos/<org>__<repo>.md`,
`$HOME/.minime/wiki/orgs/<org>.md`.

### High-level subagent policy

- Use **strong reasoning models only** for subagent work (no fast/mini tiers for reasoning-heavy phases).
- Give subagents **enough tools for the task** (implementation/investigation needs full engineering tool access).
- Keep review as the explicit exception: `minime:reviewer` stays read-only in a fresh context.

### Formal VOI policy (decision hygiene)

- Treat unknowns as **decidable-by-data** first; only escalate true **undecidable-now** tradeoffs to user decisions.
- Apply a Value-of-Information gate: run additional research only if it is likely to materially change the choice.
- When a decision is still needed, present a compact decision packet (options, tradeoffs, risks, default recommendation).

---

## Install — Claude Code

In Claude Code, add this repo as a marketplace and install the plugin:

```text
/plugin marketplace add abossard/minime
/plugin install minime@minime
```

Run the bootstrap once (from anywhere):

```text
/minime:init-orchestration
```

This initializes `$HOME/.minime/*` only and does not create or stage files in your repo.

After that, the orchestration is live: describe your task inline or write a `task.md`, invoke
`/minime:plan`, and follow the flow. No `task.md` file is required — plan accepts inline context.

### SessionStart hook (auto-nudge)

The plugin ships a `hooks/hooks.json` that injects a nudge into every new session, reminding the
agent that minime skills are available and should be used for non-trivial tasks. This works
automatically — no repo-level custom instructions needed.

---

## Install — GitHub Copilot CLI

Copilot CLI uses the same Agent Skills standard, so the same skill files work.

### Recommended (team/shared): install from marketplace

```bash
copilot plugin marketplace add abossard/minime
copilot plugin install minime@minime
```

Verify and inspect what loaded:

```bash
copilot plugin list
copilot plugin marketplace list
```

In an interactive session:

```text
/agent
/skills list
```

Update to latest published version:

```bash
copilot plugin update minime
```

### Direct-from-repo install (best for development/testing)

Install straight from GitHub:

```bash
copilot plugin install abossard/minime
```

Or install from a local checkout:

```bash
git clone https://github.com/abossard/minime ~/.minime
copilot plugin install ~/.minime
```

When you edit plugin files locally, reinstall to refresh the cache:

```bash
copilot plugin install ~/.minime
```

### Initialize user-home state

After plugin install:

```text
/minime:init-orchestration
```

The init skill creates user-home state only:
- `$HOME/.minime/templates/task.template.md`
- `$HOME/.minime/wiki/repos/<org>__<repo>.md`
- `$HOME/.minime/wiki/orgs/<org>.md`

---

## Use

Two modes — pick the one that fits the task.

### Manual mode (explicit, step-by-step)

1. **Per task**: describe your task inline to the agent, or copy
   `$HOME/.minime/templates/task.template.md` → `task.md` and fill in EARS-style
   acceptance criteria. **No file required** — plan accepts conversation context directly.
2. **Start the flow**: `skill("plan")`. Reads your task brief (inline or file) and the
   per-repo wiki, discovers other installed skills, nudges EARS quality when needed,
   then plans silently and tells you to invoke `skill("implement")`.
3. **Implement**: `skill("implement")`. Test-first loop, real output observed.
   Hands off with explicit instruction to invoke `skill("review")`.
4. **Review**: `skill("review")`. Automatically forks into `minime:reviewer`
   (fresh context, read-only tools) to remove implementation bias. Checks staged,
   unstaged, and untracked files — not just branch diffs. Auto-merges if LOW risk
   and tests green; otherwise surfaces an evidence package for you.
5. **Harvest**: `skill("harvest")` after merge or at session end. Captures lessons
   from any corrections you made into the wiki, with code citations. Works even
   without a merge — session lessons are harvestable too.

### Autopilot mode (director agent runs the flow)

Start a session as the director:

```bash
claude --agent minime:director
```

The director reads `task.md` or accepts an inline task description, runs all four phases,
and stops only when it needs you — either because the review came back HIGH-risk (you see the
evidence package) or because something destructive needs your authorization.

The director uses your `project` agent memory to accumulate META-learnings
about how the flow goes in this repo over time (separate from the per-repo
corrections wiki, which captures engineering rules).

The full one-page overview is in this repository’s `assets/ORCHESTRATION.md`.

---

## Why this design

| Decision | Source |
|---|---|
| One human gate, not three | Over-structured multi-agent pipelines did not improve correctness in the ClassEval Waterfall ablation; requirements/design stages had minimal measured effect. |
| Tier review by agent-reported risk | Confidence-based hybridization beat AI-alone and human-alone on DeepMind's Human-AI Complementarity benchmark. |
| Reviewer surfaces evidence, never a verdict | Showing AI judgments / confidence caused over-reliance and made reviewers measurably *worse* when the AI was wrong; raw evidence "helps when correct, does not hurt when wrong". |
| Per-repo corrections wiki with cited entries | Mirrors GitHub Copilot's agentic memory design: repo-scoped, citation-verified, adversarial-memory tested. |
| Score-then-inject, consolidate periodically | ExpeL/ERL and ReasoningBank — concatenating all insights scales poorly; memories should mature. |

Full citations and findings in [`assets/.agent/research/REFERENCES.md`](assets/.agent/research/REFERENCES.md).

---

## Repo layout

```
.claude-plugin/
  marketplace.json          this repo is also its own Claude Code marketplace
  plugin.json               plugin manifest
hooks/
  hooks.json                SessionStart hook config (auto-nudge on session start)
  session-start.js          injects skill awareness into every session
skills/
  plan/SKILL.md
  implement/SKILL.md
  review/SKILL.md           forks into minime:reviewer
  harvest/SKILL.md
  init-orchestration/SKILL.md
agents/
  director.md               minime:director — runs the flow end-to-end
  reviewer.md               minime:reviewer — read-only evidence reviewer
assets/                     reference assets and templates used by the plugin
  ORCHESTRATION.md
  task.template.md
  CLAUDE.md
  .github/copilot-instructions.md
  .agent/wiki/_TEMPLATE.md
  .agent/research/REFERENCES.md
```

## License

MIT — see `LICENSE`.
