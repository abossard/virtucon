---
description: Plan a coding task from a task.md brief or inline context. Reads the per-repo corrections wiki (score-and-verify, never dump-all), thinks silently, self-challenges, hands off to implement. No human review gate — the plan is consumed by implement, never signed off.
when_to_use: When the user has a task to plan — either as a task.md file, inline conversation context, or a verbal description. This skill starts the orchestration flow.
allowed-tools: Read Grep Glob Bash(git remote get-url *) Bash(git log *) Bash(git status) Bash(ls *)
---

# Skill: plan

Runs first in the four-phase flow. **No human review gate** — your plan is an input the next skill consumes, not a document anyone signs off.

## Steps

1. **Accept the task brief from wherever it lives.**
   - If `task.md` exists in the working directory, use it.
   - If no `task.md` exists but the user gave inline context (conversation text, a pasted description, a table of requirements), use that directly — do NOT block on a missing file.
   - If neither exists, ask the user to describe the task or point to a file.
   Then nudge for EARS completeness: if acceptance criteria are vague or non-EARS, ask for a concise refinement using EARS patterns. Nudge, don't block on perfection: ask for the minimum edits needed to make criteria independently testable.

2. **Locate wiki sources (user-home only).** Run `git remote get-url origin`, derive `<org>__<repo>.md`, and open `$HOME/.minime/wiki/repos/<org>__<repo>.md` directly. Also load `$HOME/.minime/wiki/orgs/<org>.md` when present. If the repo wiki file is absent, tell the user to run `/minime:init-orchestration` once (it initializes `$HOME/.minime/*` only).

3. **Discover domain-specific skills and agents.** Scan for other installed skills and agents that could be relevant to this task:
   - Check the current repo for `.agents/`, `.skills/`, `agents/`, `skills/` directories.
   - Check other installed plugins visible in the environment.
   - If a discovered skill or agent is relevant to the task (e.g., a testing framework skill, a deployment agent), mention it in the plan so the implement phase can use it.
   This bridges generic orchestration to domain-specific tooling.

4. **Run a VOI/decidability triage before full planning.**
   For each open unknown in the task brief:
   - If it is **decidable-by-data** (can be resolved via code/docs/tests/vendor guidance), resolve it with evidence first.
   - If it is **undecidable-now** (value tradeoff/policy preference/irreducible uncertainty), prepare one explicit user decision with options and tradeoffs.
   Use a Value-of-Information check: do extra research only when it is likely to materially change the implementation choice.

5. **Score wiki entries for relevance — do not dump them all in.**
   Rank candidates with this priority order:
   - Trigger match strength to the current task brief
   - `Status: active` over stale/superseded
   - Higher `Confidence` and `ValueScore`
   - More recent `LastVerified`
   - `Origin: human-correction` over weaker signals when tied
   Select only the top ~5 after ranking.

6. **Verify before trusting (citation check).** Each selected entry cites a code location. Open that location. If the code no longer matches the entry, the entry is stale — ignore it and flag it for `/minime:harvest` to fix. Never plan on an unverified memory.

7. **Plan silently.** Produce an internal implementation plan: files to touch, order of work, which acceptance criteria each step satisfies, and the tests that will prove each one. Working state, not a deliverable.

8. **Self-challenge (write this down, keep it short).** Answer:
   - What is the riskiest assumption in this plan?
   - Under what condition would this approach be wrong?
   - What in the task brief is ambiguous? If genuinely blocking, ask the user ONE question. Otherwise state the assumption and proceed.

9. **Hand off.** Tell the user the plan is ready, then instruct: **now invoke `skill("implement")`** to start the test-driven implementation loop.

## Rules
- Do not produce a plan document for human approval. No plan-review gate.
- Prefer the smallest plan that satisfies the task brief. Extra structure measurably lowers correctness.
- If wiki and live code disagree, the live code wins.
