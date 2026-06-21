---
name: extract
description: Extract lessons from a just-merged task or current session into the global raw/wiki knowledge root. Human corrections are the highest-value signal. Every durable claim must cite live code.
when_to_use: Right after a task is merged or staged, after a significant session with learnings worth preserving, or when the user explicitly asks to extract lessons from recent work.
allowed-tools: Read Edit Write Grep Glob Bash(git log *) Bash(git diff *) Bash(git show *) Bash(git remote get-url *) Bash(git status)
---

# Skill: extract

Trigger: a task is merged or a session produced lessons worth preserving. It turns raw outcomes into durable knowledge under `raw/`, `wiki/`, and `schema.md`.

Human corrections are the highest-value signal. Capture them first.

## Progress

Mark this phase in the harness native todo tool: `in_progress` on entry, `done` at handoff. Visibility aid for the user, never a gate. Skip silently if no todo tool is available. See `assets/ORCHESTRATION.md` § Progress tracking.

## Learn from the blueprint

Read the persisted blueprint at `VIRTUCON_HQ/<org>/_<repo>/blueprints/<date>-<name>.blueprint.md`.
Harvest from the Decisions table, review discoveries, and verbatim user feedback.

## Research-grounded memory policies

1. **Write filtering**
   - Store only lessons that are actionable, reusable, cited, and novel.
2. **Conflict handling**
   - Prefer the newer, better-cited guidance.
   - Mark old guidance stale or superseded instead of keeping two active contradictions.
3. **Retrieval quality**
   - Keep page summaries, scopes, and citations crisp so blueprint can rank them.
4. **Decay**
   - Re-verify recently touched guidance.
   - Mark stale guidance when citations no longer match live code.
5. **Quality loop**
   - Record candidates considered, pages updated, and stale items handled in the final response.

## Step 1: Locate the knowledge roots

Derive `<org>` and `<repo>` from `git remote get-url origin`.
Open these shared-root paths when present:
- `VIRTUCON_HQ/schema.md`
- `VIRTUCON_HQ/wiki/index.md`
- `VIRTUCON_HQ/wiki/log.md`
- repo topic pages under `VIRTUCON_HQ/wiki/orgs/<org>/<repo>/`
- cross-repo topic pages under `VIRTUCON_HQ/wiki/patterns/`
- related raw documents under `VIRTUCON_HQ/raw/<org>/<repo>/`
Also check for legacy `VIRTUCON_HQ/<org>/_<repo>/wiki/` or `wiki.md` inputs before declaring older guidance absent.

## Step 2: What to capture

1. Corrections the human made to the agent's work.
2. Reusable design decisions with rationale.
3. Worthy research answers recorded in the blueprint.
4. Failed approaches that future tasks should avoid.
5. Stale or conflicting guidance that needs repair.

## Step 3: How to write durable knowledge

### Raw layer

Write compact curated source documents into `raw/<org>/<repo>/`.
Good raw documents include findings, distilled results, user messages, general knowledge, and hard-won discoveries.
Do not store logs or large command outputs in `raw/`.
Name raw documents for the source, for example `raw/<org>/<repo>/review-feedback-2026-05-30.md` or `raw/<org>/<repo>/legacy-wiki.md`.

### Wiki layer

Maintain the wiki as linked markdown pages under `wiki/`.

- `index.md` catalogs topic pages and points at key raw sources.
- `log.md` records dated ingest, query, and lint updates.
- Repo-specific topic pages live under `wiki/orgs/<org>/<repo>/`.
- Cross-repo topic pages live under `wiki/patterns/`.
- Topic pages hold durable guidance. Create or update them with `VIRTUCON_HQ/_TEMPLATE.md`.

Every topic page should keep these elements when they help retrieval:
- a concise summary near the top
- `Scope` for directory-specific guidance
- links to raw source documents
- code citations that can be re-verified
- `LastVerified`

## Step 4: Consolidation

- Merge overlapping pages when a stronger general rule is visible.
- Remove or mark stale pages whose citations no longer match code.
- Keep `index.md` scannable and current.
- Keep `log.md` chronological and compact.

## Boundaries

- Repo-specific guidance stays in `wiki/orgs/<org>/<repo>/`.
- Cross-repo guidance stays in `wiki/patterns/`.
- Never store secrets, tokens, credentials, or customer data.
- The durable knowledge base is not a changelog.
- The wiki remains authoritative even if you also mirror high-value lessons to platform-native memory.

## Lint mode

When asked to lint, check the repo wiki pages for:
1. stale citations
2. contradictions
3. orphan scopes
4. duplicate guidance
5. coverage gaps in recently touched directories
6. research candidates from the blueprint that deserve promotion

Follow `assets/ORCHESTRATION.md` for the shared raw/wiki/schema contract.
