---
description: Capture lessons from a just-merged task into the per-repo corrections wiki. Human corrections are the highest-value signal. Every entry must cite live code and be a generalised rule, not a task log. Consolidate when the wiki grows past ~20 entries.
when_to_use: Right after a task is merged (auto-merge by /minime:review or human-merged), or when the user explicitly asks to harvest lessons from recent work.
allowed-tools: Read Edit Write Grep Glob Bash(git log *) Bash(git diff *) Bash(git show *) Bash(git remote get-url *)
---

# Skill: harvest

Trigger: a task is merged. Turns raw outcomes — especially human corrections — into durable, cited wiki entries for future tasks.

Human corrections are the highest-value signal in the system: they passed through a human and survived. Capture them first.

## Step 1 — Locate the wiki
Run `git remote get-url origin`, derive `<org>__<repo>.md`, open `.agent/wiki/<org>__<repo>.md`.

## Step 2 — What to capture

1. **Corrections (priority).** Anything the human changed, rejected, or sent back during review. Each becomes one entry. The before/after IS the lesson.
2. **Stale entries** flagged by `/minime:plan` during its citation check — fix or delete them.
3. **Episodic notes** — an approach that failed and why ("tried X, broke Y").
4. Skip anything already covered. No duplicates.

## Step 3 — How to write an entry

Append to `.agent/wiki/<org>__<repo>.md` using the `_TEMPLATE.md` block. Every entry MUST:

- **Carry a code citation** — `path:line` or a stable symbol name. An entry with no citation is unsafe and must not be written: future agents re-verify entries against live code before trusting them, and an uncited entry cannot be verified.
- **Be a generalised rule, not a task log.** Not "fixed the bug in PR 12" but "Money values use integer minor units; never use floats — see billing.py:44."
- **State the trigger** — when this applies — so it can be relevance-scored.
- **Be dated**, so consolidation can prune the old.

## Step 4 — Consolidation (every ~20 entries, or when the file feels noisy)

Do not let the wiki grow unbounded — a bloated wiki buries the useful entry and slows every future task.
- Merge several specific entries into one general rule where a pattern is visible (simple notes should mature into preventative rules over time).
- Delete entries whose cited code no longer exists.
- Keep the file scannable. Quality and recall beat volume.

## Boundaries
- Wiki is per-repo, keyed by repo URL. Never mix repos.
- Never store secrets, tokens, credentials, or customer data.
- The wiki holds engineering knowledge, not a changelog.
