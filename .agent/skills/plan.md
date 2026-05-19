# Skill: plan

Trigger: a `spec.md` exists for a task. Runs first. **No human review gate** —
the plan is consumed directly by `implement`, never signed off.

## Steps

1. **Load repo wiki.** From the spec's repo URL, open
   `.agent/wiki/<org>__<repo>.md`. If absent, create it from `_TEMPLATE.md`.

2. **Score wiki entries for relevance — do not dump them all in.**
   Select only the entries plausibly relevant to this spec. Concatenating the
   whole wiki scales badly and buries the useful entry. Aim for the top ~5.

3. **Verify before trusting (citation check).** Each selected entry cites a
   code location. Open that location. If the code no longer matches the entry,
   the entry is stale — ignore it and flag it for `harvest` to fix. Never plan
   on an unverified memory.

4. **Plan silently.** Produce an internal implementation plan: files to touch,
   order of work, which acceptance criteria each step satisfies, and the tests
   that will prove each one. This is working state, not a deliverable.

5. **Self-challenge (write this down, keep it short).** Answer:
   - What is the riskiest assumption in this plan?
   - Under what condition would this approach be wrong?
   - What in the spec is ambiguous? (If genuinely blocking, ask the human ONE
     question. Otherwise state the assumption and proceed.)

6. **Hand off** the plan + self-challenge to `implement` directly.

## Rules
- Do not produce a plan document for human approval. No plan-review gate.
- Prefer the smallest plan that satisfies the spec. Extra structure measurably
  lowers correctness.
- If wiki and live code disagree, the live code wins.
