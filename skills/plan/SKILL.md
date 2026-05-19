---
description: Plan a coding task from a spec.md. Reads the per-repo corrections wiki (score-and-verify, never dump-all), thinks silently, self-challenges, hands off to implement. No human review gate — the plan is consumed by implement, never signed off.
when_to_use: When a spec.md (or equivalent acceptance-criteria doc) exists for a new task and the user wants the orchestration flow to start.
allowed-tools: Read Grep Glob Bash(git remote get-url *) Bash(git log *) Bash(git status)
---

# Skill: plan

Runs first in the four-phase flow. **No human review gate** — your plan is an input the next skill consumes, not a document anyone signs off.

## Steps

1. **Locate the per-repo wiki.** Run `git remote get-url origin`, derive `<org>__<repo>.md`, open `.agent/wiki/<org>__<repo>.md`. If absent, the user has not run `/minime:init-orchestration` yet — stop and tell them to run it once.

2. **Score wiki entries for relevance — do not dump them all in.**
   Select only entries plausibly relevant to this spec. Concatenating the whole wiki scales badly and buries the useful entry. Aim for the top ~5.

3. **Verify before trusting (citation check).** Each selected entry cites a code location. Open that location. If the code no longer matches the entry, the entry is stale — ignore it and flag it for `/minime:harvest` to fix. Never plan on an unverified memory.

4. **Plan silently.** Produce an internal implementation plan: files to touch, order of work, which acceptance criteria each step satisfies, and the tests that will prove each one. Working state, not a deliverable.

5. **Self-challenge (write this down, keep it short).** Answer:
   - What is the riskiest assumption in this plan?
   - Under what condition would this approach be wrong?
   - What in the spec is ambiguous? If genuinely blocking, ask the user ONE question. Otherwise state the assumption and proceed.

6. **Hand off.** Tell the user the plan is ready and that `/minime:implement` is next.

## Rules
- Do not produce a plan document for human approval. No plan-review gate.
- Prefer the smallest plan that satisfies the spec. Extra structure measurably lowers correctness.
- If wiki and live code disagree, the live code wins.
