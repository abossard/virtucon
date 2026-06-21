# Orchestration

minime runs four phases in order: blueprint -> replicate -> inspect -> extract.
No extra human review gate belongs between those phases.

## Shared knowledge contract

This file is the canonical contract for repo and org knowledge roots under `VIRTUCON_HQ`.
Mirror only phase-local wording in skills and README.

### Layout

`VIRTUCON_HQ` now has one shared knowledge root plus per-repo blueprint folders:

```text
VIRTUCON_HQ/
  raw/
    <org>/<repo>/
  wiki/
    index.md
    log.md
    orgs/<org>/<repo>/
    patterns/
  schema.md
  templates/
  _TEMPLATE.md
  <org>/_<repo>/blueprints/
```

The shared root keeps the same three-layer contract:

- `raw/`
  - Immutable source documents stored under `raw/<org>/<repo>/`.
  - The agent may read them freely.
  - The agent should treat captured raw docs as append-only artifacts rather than living summaries.
  - Allowed examples: curated findings, distilled results, user messages, general knowledge discovered during work, hard-won discoveries, and compact notes about failed approaches.
  - Forbidden examples: logs, large command outputs, bulky traces, or anything that should stay in ephemeral execution evidence instead of durable memory.
- `wiki/`
  - LLM-maintained markdown pages derived from the raw layer.
  - `index.md` is the catalog of current topic pages.
  - `log.md` is the chronological ingest/query/lint record.
  - Repo topic pages live under `wiki/orgs/<org>/<repo>/`.
  - Cross-repo guidance lives under `wiki/patterns/`.
  - Topic pages are linked markdown documents created from `_TEMPLATE.md` and updated over time.
- `schema.md`
  - Co-evolved guidance that explains how the wiki is structured, named, and linked.
  - When schema guidance and live code disagree, live code wins.

Repo roots only keep `blueprints/` for the living blueprint handoff files.

### Operations

- **Ingest**: new raw source arrives, then the relevant wiki pages, `index.md`, and `log.md` are updated.
- **Query**: planning reads a small ranked set of wiki pages, not the whole knowledge base.
- **Lint**: health checks look for stale claims, contradictions, orphan scopes, and missing citations.

## Evidence value chain

Evidence weight tiers:
- 1. full value (execution output, user confirmation)
- 2. some value (direct code references)
- 3. zero value (AI statements without execution or code reference)

## VOI taxonomy

For each open unknown, classify and resolve by level:
- **decided-by-data**: resolvable from code, docs, tests, or specs. Resolve directly with evidence.
- **needs-research**: resolvable but needs evidence gathering first. Dispatch subagents with strict return contracts: raw proof first, interpretation second.
- **undecidable-now**: true value tradeoff or policy decision. Use `ask_user` per the ask_user contract below.

## Phase isolation

Each phase (except inspect) runs in a fresh `general-purpose` subagent via the `task` tool. This prevents tool-output accumulation in the orchestrator's context. The blueprint on disk is the sole cross-phase state bus; no phase depends on chat context from a previous phase.

## Progress tracking

Surface live phase progress through the harness native todo or task tool, not a bespoke status file.

- Seed one todo per phase at the start of a run: blueprint, replicate, inspect, extract.
- Mark the active phase `in_progress` on entry and `done` at handoff. Keep exactly one phase `in_progress` at a time.
- Sub-step todos inside a phase are optional (for example a per-criterion item in replicate). Complete them before handoff.
- The todo list is a read-only visibility aid for the user. It never replaces the blueprint, which stays the durable cross-phase state bus, and it never becomes an approval gate.
- If the harness has no todo tool, skip this silently.

## Ask_user rule

Use `ask_user` only for true `undecidable-now` tradeoffs or when the task source is missing.
Do not add plan approval checkpoints.

Every `ask_user` call must include:
- `evidence`: raw proof that shows why input is needed
- `suggestions`: options with confidence and reasoning
- `free_text`: a way for the user to override the listed options

After the response, resume the flow. Do not idle.

**Anti-patterns (each of these is a violation):**
- "Should I start?" / "Should I proceed?" / "Want me to continue?" in plain text
- "Is this plan good?" / "Does this look correct?" in plain text
- Presenting Option A / Option B as prose instead of an `ask_user` form
- Ending a response with a question directed at the user without calling `ask_user`
- Asking ANY question and then waiting for a conversational reply

## Topic ownership

| Topic | Canonical definition | Phase-local mirrors | Notes |
|-------|---------------------|---------------------|-------|
| Evidence-first / No-verdict | inspect/SKILL.md | (none needed, frau reads inspect) | |
| Evidence weight tiers | ORCHESTRATION.md | replicate, inspect (reference only) | |
| VOI triage (3-level) | ORCHESTRATION.md | blueprint (full), dr-evil (reference) | |
| ask_user contract | ORCHESTRATION.md | dr-evil (reference), blueprint, inspect | |
| Knowledge layout | ORCHESTRATION.md | blueprint (reads), extract (reads+writes), lab (bash) | |
| Risk tiers (HIGH/LOW) | inspect/SKILL.md | dr-evil (routes), README (summary) | |
| Inspect review gate wording | inspect/SKILL.md | (none needed) | Routes HIGH-risk items to `ask_user`. |
| Phase isolation | ORCHESTRATION.md | dr-evil (reference) | |
| Progress tracking | ORCHESTRATION.md | dr-evil (seeds list), all skills (mark phase) | Harness native todo tool, visibility only |
| EARS criteria | blueprint/SKILL.md | replicate (tests), inspect (verifies) | |
| Scoped wiki entries | ORCHESTRATION.md | all skills (phase-specific) | |
| Constraint re-injection | replicate/SKILL.md | (none needed) | |
| Test-at-boundary | replicate/SKILL.md | inspect (verifies) | |
| No human gate | ORCHESTRATION.md | skill frontmatter only | |
| Preserve raw wording | ORCHESTRATION.md | blueprint, inspect | |
| Human corrections signal | extract/SKILL.md | inspect (flags for extract) | |

## Context engineering

- Preserve raw user wording verbatim in blueprints and raw knowledge docs.
- Read only the wiki pages needed for the current task.
- Rank wiki pages by `Scope` match, task-term match, active status, better citations, and recency.
- Research returns must lead with raw proof such as URLs, exact quotes, and code paths before any interpretation.
- Treat uncited or stale wiki claims as leads only. Re-verify them against live code before trusting them.
- When entering a directory for the first time in a task, look for active wiki pages whose `Scope` covers that directory and apply them as local guidance.
- Keep evidence in the blueprint so the next phase can continue in a fresh context.
