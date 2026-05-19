---
name: implement
description: Implement a planned task in a tight test-driven loop. Generate → run → observe REAL output → fix. Re-injects task-brief constraints every ~5 iterations to fight instruction attenuation. No human review gate.
when_to_use: After /minime:plan has handed off, or whenever the user wants the implementation loop with grounded test execution.
allowed-tools: Read Edit Write Grep Glob Bash
---

# Skill: implement

Trigger: `/minime:plan` has handed off, or the user invoked you directly with an existing plan. **No human review gate.** Quality here comes from a tight execution-grounded loop, not from human checkpoints.

## The loop (this is the empirically strongest part of the flow)

Repeat per acceptance criterion:

1. **Write the test first** for this criterion. Tests front-loaded had the single largest positive effect on correctness in multi-stage studies.
2. **Implement** the smallest change that could pass it.
3. **Run the test. Observe the REAL output.** Never assume a run passed — paste/inspect actual output. "Ran tests, passed" with no output is the classic instruction-attenuation failure.
4. **Fix** based on real output. Re-run. A grounded generate→run→observe→fix loop outperforms agentic role-play choreography.
5. Move to the next criterion only when this one is genuinely green.

## Constraint re-injection ("Forget-Me-Not")

Every ~5 iterations, OR after any context compaction, re-read the "Constraints / non-negotiables" and "Out of scope" sections of the task brief and restate them to yourself in one line. Rules decay across long loops — they get applied in form but lose substance unless refreshed.

## Scope discipline
- Touch only what the task brief and plan require. If you discover necessary work outside scope, note it for the evidence package — do not silently expand.
- Keep the diff as small as the task brief allows. Small diffs are cheap to verify; large diffs force the reviewer to re-solve instead of check.

## Hand off to /minime:review with
- the diff
- every test and its real, pasted output
- assumptions made, and any out-of-scope work discovered

**Explicit next step: now invoke `skill("review")`** to get an evidence-based review.
