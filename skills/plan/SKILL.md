---
description: Plan a coding task from a task.md brief. Reads the per-repo corrections wiki (score-and-verify, never dump-all), thinks silently, self-challenges, hands off to implement. No human review gate — the plan is consumed by implement, never signed off.
when_to_use: When a task.md (or equivalent acceptance-criteria brief) exists for a new task and the user wants the orchestration flow to start.
allowed-tools: Read Grep Glob Bash(git remote get-url *) Bash(git log *) Bash(git status)
---

# Skill: plan

Runs first in the four-phase flow. **No human review gate** — your plan is an input the next skill consumes, not a document anyone signs off.

## Steps

1. **Check task brief quality and nudge for EARS completeness.** If `task.md` is missing, tell the user to create it from `$HOME/.minime/templates/task.template.md` (or author it manually). If `task.md` exists but acceptance criteria are vague or non-EARS, ask for a concise refinement using EARS patterns before planning. Nudge, don't block on perfection: ask for the minimum edits needed to make criteria independently testable.

2. **Locate wiki sources (user-home only).** Run `git remote get-url origin`, derive `<org>__<repo>.md`, and open `$HOME/.minime/wiki/repos/<org>__<repo>.md` directly. Also load `$HOME/.minime/wiki/orgs/<org>.md` when present. If the repo wiki file is absent, tell the user to run `/minime:init-orchestration` once (it initializes `$HOME/.minime/*` only).

3. **Score wiki entries for relevance — do not dump them all in.**
   Rank candidates with this priority order:
   - Trigger match strength to the current task brief
   - `Status: active` over stale/superseded
   - Higher `Confidence` and `ValueScore`
   - More recent `LastVerified`
   - `Origin: human-correction` over weaker signals when tied
   Select only the top ~5 after ranking.

4. **Verify before trusting (citation check).** Each selected entry cites a code location. Open that location. If the code no longer matches the entry, the entry is stale — ignore it and flag it for `/minime:harvest` to fix. Never plan on an unverified memory.

5. **Plan silently.** Produce an internal implementation plan: files to touch, order of work, which acceptance criteria each step satisfies, and the tests that will prove each one. Working state, not a deliverable.

6. **Self-challenge (write this down, keep it short).** Answer:
   - What is the riskiest assumption in this plan?
   - Under what condition would this approach be wrong?
   - What in the task brief is ambiguous? If genuinely blocking, ask the user ONE question. Otherwise state the assumption and proceed.

7. **Hand off.** Tell the user the plan is ready and that `/minime:implement` is next.

## Rules
- Do not produce a plan document for human approval. No plan-review gate.
- Prefer the smallest plan that satisfies the task brief. Extra structure measurably lowers correctness.
- If wiki and live code disagree, the live code wins.
