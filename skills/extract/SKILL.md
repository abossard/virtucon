---
name: extract
description: Extract lessons from a just-merged task or current session into the per-repo corrections wiki. Human corrections are the highest-value signal. Every entry must cite live code and be a generalised rule, not a task log.
when_to_use: Right after a task is merged or staged, after a significant session with learnings worth preserving, or when the user explicitly asks to extract lessons from recent work.
allowed-tools: Read Edit Write Grep Glob Bash(git log *) Bash(git diff *) Bash(git show *) Bash(git remote get-url *) Bash(git status)
---

# Skill: extract

Trigger: a task is merged OR a session produced lessons worth capturing (even without a merge). It turns raw outcomes, especially human corrections, into durable, cited wiki entries for future tasks.

Human corrections are the highest-value signal in the system: they passed through a human and survived. Capture them first.

Session-based harvest: when invoked without a recent merge, harvest should look at the current session's conversation for:
- Corrections the user made to the agent's approach or output.
- Design decisions with rationale that future tasks should follow.
- Patterns discovered during implementation that are reusable.
These still require code citations to be persisted. If a lesson references code, cite it; if it's purely process knowledge, note it as a candidate for the director's project memory instead.

## Learn from the task brief's evolution

Read the persisted task brief at `VIRTUCON_HQ/<org>/_<repo>/tasks/<date>-<name>.task.md`. It contains:
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
   - Keep entry wording short and specific to improve top-k selection quality in `/minime:blueprint`.

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
Derive `<org>` and `<repo>` from `git remote get-url origin`. Use VIRTUCON_HQ from the session nudge. Open `VIRTUCON_HQ/<org>/_<repo>/wiki.md`. Also check `VIRTUCON_HQ/<org>/wiki.md` for cross-repo rules to avoid duplication.

## Step 2: What to capture

1. **Corrections (priority).** Anything the human changed, rejected, or sent back during review. Each becomes one entry. The before/after IS the lesson.
2. **Research candidates from plan.** Read the task brief's `## Research resolved` section. Each entry is a wiki candidate produced when plan resolved a "needs-research" VOI item. Evaluate each using the write-filtering policy: actionability, reusability, evidence quality, novelty. Persist worthy ones as new wiki entries. Reject the rest and include the count in the run summary.
3. **Stale entries** flagged by `/minime:blueprint` during its citation check. Fix or delete them.
4. **Episodic notes**: an approach that failed and why ("tried X, broke Y").
5. Skip anything already covered. No duplicates.

## Step 3: How to write an entry

Append to `VIRTUCON_HQ/<org>/_<repo>/wiki.md` using the `VIRTUCON_HQ/_TEMPLATE.md` block. Every entry MUST:

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
- **Platform-native memory bridge:** when the host platform supports `store_memory` (e.g. GitHub Copilot, Claude Code), also store high-value entries (ValueScore >= 6, Confidence: high) into platform-native memory so non-minime sessions benefit from accumulated knowledge. The wiki remains the authoritative source; platform memory is a read-optimized replica.

## Auto-harvest triggers

Invoke `skill("extract")` at these moments (not silently):
1. **After LOW-risk review + green tests** (primary trigger).
2. **After human corrections** during any phase.
3. **At session end** with uncaptured design decisions or failed approaches.
4. **After merge/ship.**

## Step 5: Wiki lint

When invoked with a lint request, perform a health check on `VIRTUCON_HQ/<org>/_<repo>/wiki.md`:

1. **Stale citations.** Open cited code locations. If gone or mismatched, mark `Status: stale`.
2. **Contradictions.** Flag pairs of active entries with conflicting rules.
3. **Orphan entries.** Scope globs matching zero files, or cited files that no longer exist. Check `git log --name-status --diff-filter=R` for renames before marking stale.
4. **Duplicates.** Overlapping triggers and similar rules. Candidates for merge.
5. **Coverage gaps.** Directories touched in recent commits with no scoped wiki entries.
6. **Research candidates.** Evaluate task brief's `## Research resolved` entries using write-filtering policy.

Produce a lint report with counts per category and actions taken. Split actions:
- **Auto-fix:** mark stale, update LastVerified, flag orphan scopes.
- **Report-only:** merge duplicates, delete entries, supersede contradictions, create from research candidates.
