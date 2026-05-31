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

## Ask_user rule

Use `ask_user` only for true `undecidable-now` tradeoffs or when the task source is missing.
Do not add plan approval checkpoints.

## Context engineering

- Preserve raw user wording verbatim in blueprints and raw knowledge docs.
- Read only the wiki pages needed for the current task.
- Rank wiki pages by `Scope` match, task-term match, active status, better citations, and recency.
- Research returns must lead with raw proof such as URLs, exact quotes, and code paths before any interpretation.
- Treat uncited or stale wiki claims as leads only. Re-verify them against live code before trusting them.
- When entering a directory for the first time in a task, look for active wiki pages whose `Scope` covers that directory and apply them as local guidance.
- Keep evidence in the blueprint so the next phase can continue in a fresh context.
