---
name: replicate
description: Replicate a planned task in a tight test-driven loop. Generate -> run -> observe REAL output -> fix. Re-injects task-brief constraints after context compaction or when switching focus. No human review gate.
when_to_use: After /minime:blueprint has handed off, or whenever the user wants the implementation loop with grounded test execution.
allowed-tools: Read Edit Write Grep Glob Bash
---

# Skill: replicate

Trigger: `/minime:blueprint` has handed off, or the user invoked you directly with an existing plan. **No human review gate.** Quality here comes from a tight execution-grounded loop, not from human checkpoints.

## Living task brief

Locate the persisted task brief at `VIRTUCON_HQ/<org>/_<repo>/tasks/<date>-<name>.task.md` (VIRTUCON_HQ is in the session nudge). **Read the file at the start of this phase to confirm it exists.** If it does not exist, the plan phase failed to persist it; create it now before proceeding.

As you complete each criterion:
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

### Test-scope classification (before running tests)

Before running tests for a criterion, classify the touched surface and choose the narrowest proof:

1. **Identify what changed**: list the files/directories the current implementation step touches.
2. **Choose the narrowest test scope that proves the criterion**:
   - If only one file changed: run that file's colocated or directly related tests.
   - If a module/package changed: run that module's test suite.
   - If a cross-cutting contract changed (API, schema, shared types): broaden to integration/contract tests.
3. **Broaden only when the touched contract demands it.** Do not reflexively run the whole suite. A full suite run is justified only when: the change touches shared infrastructure, build configuration, or dependency versions.
4. **Record what was tested and why** that scope was sufficient. If you chose narrow scope, state why broader was unnecessary.

Adapted from openclaw's "prove touched surface" principle: narrow tests first, broaden only when the contract demands it.

### Scoped wiki entries

When entering a directory for the first time in a task, check the repo wiki for entries whose `Scope` field matches that directory. These entries carry directory-specific guidance (the equivalent of in-repo AGENTS.md files). Apply any matching active entries as constraints for work in that directory. If no scoped entries exist, proceed normally.

Repeat per acceptance criterion:

1. **Write the test first** at the user-facing or API boundary. The test must exercise the behavior the way a user or consumer would: through public APIs, CLI commands, HTTP endpoints, or UI elements via accessibility/visual attributes. Do NOT test internal implementation details (private methods, internal state, wiring). Include at least one error/wrong-input case alongside the happy path. Executable tests had the strongest positive effect on correctness in multi-stage studies.
2. **Implement** the smallest change that could pass it.
3. **Run the test. Observe the REAL output.** Never assume a run passed. Paste/inspect actual output. "Ran tests, passed" with no output is the classic instruction-attenuation failure.
4. **Fix** based on real output. Re-run. Prefer executable feedback over purely conversational review loops.
5. Move to the next criterion only when this one is genuinely green.

**any executables require execution evidence.** Shell scripts, CLI tools, Dockerfiles, Makefiles, and any other new executable artifact must be run with real inputs before marking the criterion done. Applies to any runnable file. "I wrote a script" is not evidence. "I ran the script and here is the output" is.

## Constraint re-injection

Re-read the "Constraints / non-negotiables" and "Out of scope" sections of the task brief:
- **(a)** after every context compaction event,
- **(b)** when switching to a new acceptance criterion,
- **(c)** when entering a directory for the first time.
If in doubt, re-read. Rules decay across long loops unless refreshed.

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

## Hand off to /minime:inspect with
- the diff
- every test and its real, pasted output
- assumptions made, and any out-of-scope work discovered
- the path to the persisted task brief (with checkmarks updated)

**Explicit next step: now invoke `skill("inspect")`** to get an evidence-based review.
