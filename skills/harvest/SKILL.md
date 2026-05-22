---
name: harvest
description: Capture lessons from a just-merged task or current session into the per-repo corrections wiki. Human corrections are the highest-value signal. Every entry must cite live code and be a generalised rule, not a task log.
when_to_use: Right after a task is merged or staged, after a significant session with learnings worth preserving, or when the user explicitly asks to harvest lessons from recent work.
allowed-tools: Read Edit Write Grep Glob Bash(git log *) Bash(git diff *) Bash(git show *) Bash(git remote get-url *) Bash(git status)
---

# Skill: harvest

Trigger: a task is merged OR a session produced lessons worth capturing (even without a merge). It turns raw outcomes, especially human corrections, into durable, cited wiki entries for future tasks.

Human corrections are the highest-value signal in the system: they passed through a human and survived. Capture them first.

Session-based harvest: when invoked without a recent merge, harvest should look at the current session's conversation for:
- Corrections the user made to the agent's approach or output.
- Design decisions with rationale that future tasks should follow.
- Patterns discovered during implementation that are reusable.
These still require code citations to be persisted. If a lesson references code, cite it; if it's purely process knowledge, note it as a candidate for the director's project memory instead.

## Learn from the task brief's evolution

Read the persisted task brief at `MINIME_HOME/<org>/_<repo>/tasks/<date>-<name>.task.md`. It contains:
- **Decisions table**: how unknowns were resolved and at what VOI level.
- **Discovered during review**: criteria that were missing from the original EARS.
- **User feedback**: verbatim user corrections and steering.

Use this to harvest process-level lessons:
- If "Discovered during review" has entries, that's a signal the EARS was incomplete. Write a wiki entry about what category of criteria this repo's tasks tend to miss (e.g., "error handling", "auth edge cases").
- If the Decisions table shows many "undecidable-now" items, note which domains need early user input.
- User feedback sections are raw signal. Never reinterpret them. Extract generalizable rules but cite the user's exact words as the source.

## Research-grounded memory policies (apply all 5)

1. **Write filtering policy** (heuristic; tune based on results)
   - Do not store everything. Evaluate each candidate entry for:
     - Actionability for future tasks
     - Reusability across files/tasks
     - Evidence quality (clear code citation)
     - Novelty (not duplicate of existing active rule)
   - Persist only entries that score well on most of these dimensions.

2. **Conflict handling policy**
   - If a new rule conflicts with an existing one, do not keep both as active.
   - Keep the newer, better-cited rule as `Status: active`.
   - Mark old rule `Status: superseded`, set `SupersededBy: <new rule name>`, and update `LastVerified`.

3. **Retrieval prioritization policy**
   - Ensure each entry has a concrete `Trigger` and `Confidence`.
   - Prefer entries that are: trigger-matched, active, recently verified, and high-confidence.
   - Keep entry wording short and specific to improve top-k selection quality in `/minime:plan`.

4. **Decay / forgetting policy**
   - Every harvest pass: re-verify citations for recently touched areas.
   - If evidence no longer matches code, mark entry `Status: stale`.
   - Remove stale entries when superseded or unhelpful; keep only if still useful as historical cautionary context.

5. **Quality loop policy**
   - Record a quick run summary in the commit or response:
     - candidates considered
     - entries written
     - entries superseded
     - entries marked stale/removed
   - If many candidates are rejected for low value or stale evidence, tighten future write filtering.

## Step 1: Locate the wikis
Run `git remote get-url origin`, derive `<org>` and `<repo>`, open `MINIME_HOME/<org>/_<repo>/wiki.md`. Also check `MINIME_HOME/<org>/wiki.md` for cross-repo rules to avoid duplication.

## Step 2: What to capture

1. **Corrections (priority).** Anything the human changed, rejected, or sent back during review. Each becomes one entry. The before/after IS the lesson.
2. **Research candidates from plan.** Read the task brief's `## Research resolved` section. Each entry is a wiki candidate produced when plan resolved a "needs-research" VOI item. Evaluate each using the write-filtering policy: actionability, reusability, evidence quality, novelty. Persist worthy ones as new wiki entries. Reject the rest and include the count in the run summary.
3. **Stale entries** flagged by `/minime:plan` during its citation check. Fix or delete them.
4. **Episodic notes**: an approach that failed and why ("tried X, broke Y").
5. Skip anything already covered. No duplicates.

## Step 3: How to write an entry

Append to `MINIME_HOME/<org>/_<repo>/wiki.md` using the `MINIME_HOME/_TEMPLATE.md` block. Every entry MUST:

- **Carry a code citation**: `path:line` or a stable symbol name. An entry with no citation is unsafe and must not be written: future agents re-verify entries against live code before trusting them, and an uncited entry cannot be verified.
- **Be a generalised rule, not a task log.** Not "fixed the bug in PR 12" but "Money values use integer minor units; never use floats (see billing.py:44)."
- **State the trigger**: when this applies, so it can be relevance-scored.
- **Set `Scope` when the rule is directory-specific.** Use directory globs (e.g. `src/billing/**`, `extensions/*`). This is the substitute for in-repo AGENTS.md files: scoped guidance lives in the wiki, keyed to directories. Omit `Scope` for repo-wide rules. A single entry may list multiple globs separated by commas.
- **Set ValueScore, Confidence, Status, and LastVerified** for ranking and decay policies.
- **Be dated**, so consolidation can prune the old.

## Step 4: Consolidation (when retrieval starts surfacing duplicates or stale entries)

Do not let the wiki grow unbounded. A bloated wiki buries the useful entry and slows every future task.
- Merge several specific entries into one general rule where a pattern is visible (simple notes should mature into preventative rules over time).
- Delete entries whose cited code no longer exists.
- Keep the file scannable. Quality and recall beat volume.

## Boundaries
- Keep repo-specific rules in the repo wiki and cross-repo conventions in the org wiki.
- Never store secrets, tokens, credentials, or customer data.
- The wiki holds engineering knowledge, not a changelog.

## Auto-harvest triggers

Harvest should be invoked (not silently — the director or user triggers it) at these moments:

1. **After review completes (LOW risk + green):** the review skill hands off to harvest. This is the primary trigger.
2. **After human corrections:** when the user rejects, corrects, or steers the agent's approach during any phase, the correction is the highest-value signal. The directing agent should invoke harvest before the session ends.
3. **At session end with uncaptured lessons:** if the session produced design decisions, failed approaches, or discovered patterns that are not yet in the wiki, harvest should run. The director checks: "did this session produce corrections or learnings not yet harvested?"
4. **After a merge or ship:** when `git push` or a PR merge completes a task, harvest captures what the full cycle taught.

These are documented triggers, not automatic silent execution. The directing agent or user invokes `skill("harvest")` at these points. Harvest never runs without being called.

## Step 5: Wiki lint (Karpathy compound-knowledge health check)

When invoked with a lint request (user says "lint the wiki", "wiki health check", or harvest is run periodically), perform a structured health check on `MINIME_HOME/<org>/_<repo>/wiki.md`. This is the wiki equivalent of `pnpm check:changed` — prove the wiki is healthy, don't just assume it.

### Lint checklist

Run each check and record findings:

1. **Stale citations.** For every active entry, open the cited code location. If the file/line/symbol no longer exists or the code no longer matches the rule, mark the entry `Status: stale` with today's date.
2. **Contradictions.** Scan for pairs of active entries whose rules conflict (e.g., one says "use floats", another says "use integers for money"). Flag contradictions with both entry names and the conflicting statements.
3. **Orphan entries.** Two kinds: (a) *Scope orphans*: entries whose `Scope` glob matches zero current files or directories. (b) *Evidence orphans*: entries whose cited file or symbol no longer exists, even if the scope still matches. For renamed/moved files, check `git log --name-status --diff-filter=R` to suggest the likely new path before marking stale.
4. **Duplicate / near-duplicate entries.** Entries with overlapping triggers and similar rules. Candidates for consolidation.
5. **Missing coverage gaps.** Directories with significant code that have no scoped wiki entries. Not every directory needs one, but flag directories that have been touched in recent tasks (check `git log --name-only` for last 10 commits) and have no wiki guidance.
6. **Research candidates.** Check the task brief's `## Research resolved` section (written by plan). Evaluate each candidate using the write-filtering policy. Persist worthy ones as new wiki entries.

### Lint report

After running all checks, produce a lint report:

```
Wiki lint: <repo> (<date>)
- Entries scanned: <N>
- Stale: <N> (list names)
- Contradictions: <N> (list pairs)
- Orphans: <N> (list names)
- Duplicates: <N> (list candidates for merge)
- Coverage gaps: <N> (list directories)
- Research candidates filed: <N> (list)
- Actions taken: <list of status changes, merges, new entries>
```

Act on findings using the existing write-filtering, conflict, decay, and consolidation policies. Lint is an enforcement mode, not a parallel policy. Split actions by safety:

**Auto-fix (safe, objective):**
- Mark entries `Status: stale` when cited file/symbol no longer exists
- Update `LastVerified` when citation still matches
- Flag orphan scopes

**Report-only (requires judgment or human input):**
- Merge duplicate entries (may lose unique trigger context)
- Delete entries (irreversible)
- Supersede contradictions (unless newer better-cited rule is obvious)
- Create new entries from research candidates (must pass write-filtering policy)
