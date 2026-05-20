---
name: implement
description: Implement a planned task in a tight test-driven loop. Generate -> run -> observe REAL output -> fix. Re-injects task-brief constraints after context compaction or when switching focus. No human review gate.
when_to_use: After /minime:plan has handed off, or whenever the user wants the implementation loop with grounded test execution.
allowed-tools: Read Edit Write Grep Glob Bash
---

# Skill: implement

Trigger: `/minime:plan` has handed off, or the user invoked you directly with an existing plan. **No human review gate.** Quality here comes from a tight execution-grounded loop, not from human checkpoints.

## Living task brief

The persisted task brief (at `MINIME_HOME/<org>/_<repo>/tasks/<date>-<name>.task.md`) is the cross-phase task record. As you complete each criterion:
- Tick `[x]` on the criterion when its test goes green. **Do this immediately. Do not batch check-offs for later.**
- Add a reference to the test or the verbatim output or links to it with current date and time.
- If you resolve an unknown during implementation, add it to the Decisions table with its VOI level and source.
- If you discover a requirement not in the original EARS, note it but do NOT add it to the criteria. That's review's job.

## What counts as evidence

Evidence is real output from real execution: test results, command output, HTTP responses, screenshots, logs. Three tiers of evidence weight:
1. **Full weight**: actual execution output (test results, command output, logs)
2. **Full weight**: explicit user confirmation
3. **Some weight**: direct references to code (file, line, symbol)
4. **Zero weight**: AI statements about code behavior 

## The loop (this is the empirically strongest part of the flow)

Repeat per acceptance criterion:

1. **Write the test first** at the user-facing or API boundary. The test must exercise the behavior the way a user or consumer would: through public APIs, CLI commands, HTTP endpoints, or UI elements via accessibility/visual attributes. Do NOT test internal implementation details (private methods, internal state, wiring). Include at least one error/wrong-input case alongside the happy path. Executable tests had the strongest positive effect on correctness in multi-stage studies.
2. **Implement** the smallest change that could pass it.
3. **Run the test. Observe the REAL output.** Never assume a run passed. Paste/inspect actual output. "Ran tests, passed" with no output is the classic instruction-attenuation failure.
4. **Fix** based on real output. Re-run. Prefer executable feedback over purely conversational review loops.
5. Move to the next criterion only when this one is genuinely green.

**any executables require execution evidence.** Shell scripts, CLI tools, Dockerfiles, Makefiles, and any other new executable artifact must be run with real inputs before marking the criterion done. Applies to any runnable file. "I wrote a script" is not evidence. "I ran the script and here is the output" is.

## Constraint re-injection

After context compaction, long pauses, or when switching to a new criterion/file, re-read the "Constraints / non-negotiables" and "Out of scope" sections of the task brief. Rules decay across long loops unless refreshed.

## Scope discipline
- Touch only what the task brief and plan require. If you discover necessary work outside scope, note it for the evidence package. Do not silently expand.
- Keep the diff as small as the task brief allows. Small diffs are cheap to verify; large diffs force the reviewer to re-solve instead of check.
- **Evidence over interpretation.** Paste raw test output, command output, and observable data. Label any interpretation separately. Never summarize evidence without showing it first.

## Pre-handoff checkpoint (mandatory)

Before handing off to review, re-read the persisted task brief and verify:
1. Every criterion whose test is green has `[x]` in the file. If any are missing, edit the file now.
2. The `Status:` field reflects the current state (e.g., `implementing` -> `implemented`).
3. Any decisions made during implementation are recorded in the Decisions table.
**Do not skip this step.** The review phase relies on the task brief being accurate.

## Hand off to /minime:review with
- the diff
- every test and its real, pasted output
- assumptions made, and any out-of-scope work discovered
- the path to the persisted task brief (with checkmarks updated)

**Explicit next step: now invoke `skill("review")`** to get an evidence-based review.
