---
name: replicate
description: Replicate a planned task in a tight test-driven loop. Generate -> run -> observe REAL output -> fix. Re-injects blueprint constraints after context compaction or when switching focus. No human review gate.
when_to_use: After /minime:blueprint has handed off, or whenever the user wants the implementation loop with grounded test execution.
allowed-tools: Read Edit Write Grep Glob Bash
---

# Skill: replicate

Trigger: `/minime:blueprint` has handed off, or the user invoked you directly with an existing plan. **No human review gate.** Quality here comes from a tight execution-grounded loop, not from human checkpoints.

## Progress

Mark this phase in the harness native todo tool: `in_progress` on entry, `done` at handoff. Visibility aid for the user, never a gate. Skip silently if no todo tool is available. See `assets/ORCHESTRATION.md` § Progress tracking.

## Living blueprint

Locate the persisted blueprint at `VIRTUCON_HQ/<org>/_<repo>/blueprints/<date>-<name>.blueprint.md` (VIRTUCON_HQ is in the session nudge). **Read the file at the start of this phase to confirm it exists.** If it does not exist, the blueprint phase failed to persist it; create it now before proceeding.

As you complete each criterion:
- Tick `[x]` on the criterion when its test goes green. **Do this immediately. Do not batch check-offs for later.**
- Paste raw shortened evidence (command output, test result, key lines) directly under the criterion line. Every `[x]` must have its proof inline — a checkmark without evidence is not a checkmark.
- If you resolve an unknown during implementation, add it to the Decisions table with its VOI level and source.
- If you discover a requirement not in the original EARS, note it but do NOT add it to the criteria. That's review's job.

Follow context-engineering guidance in `assets/ORCHESTRATION.md` § Context engineering.

## What counts as evidence

Evidence is real output from real execution: test results, command output, HTTP responses, screenshots, logs. See `assets/ORCHESTRATION.md` § Evidence value chain for the weight tiers.

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

Re-read the "Constraints / non-negotiables" and "Out of scope" sections of the blueprint:
- **(a)** after every context compaction event,
- **(b)** when switching to a new acceptance criterion,
- **(c)** when entering a directory for the first time.
If in doubt, re-read. Rules decay across long loops unless refreshed.

## Scope discipline
- Touch only what the blueprint and plan require. If you discover necessary work outside scope, note it for the evidence package. Do not silently expand.
- Keep the diff as small as the blueprint allows. Small diffs are cheap to verify; large diffs force the reviewer to re-solve instead of check.
- **Evidence over interpretation.** Paste raw test output, command output, and observable data. Label any interpretation separately. Never summarize evidence without showing it first.

## Pre-handoff checkpoint (mandatory)

Before handing off to review, re-read the persisted blueprint and verify:
1. Every criterion whose test is green has `[x]` in the file. If any are missing, edit the file now.
2. The `Status:` field reflects the current state (e.g., `implementing` -> `implemented`).
3. Any decisions made during implementation are recorded in the Decisions table.
4. Write a `## Evidence collected` section to the blueprint referencing: all test commands run (with raw shortened output — not summaries), files changed, and assumptions made. This collects evidence in one place ON TOP of the inline proof under each criterion. This ensures inspect can evaluate from disk without needing chat context from this phase.
**Do not skip this step.** The review phase relies on the blueprint being accurate.

## Hand off to /minime:inspect with
- the path to the persisted blueprint (with checkmarks and evidence updated)
- the diff
- assumptions made, and any out-of-scope work discovered

**Explicit next step: now invoke `skill("inspect")`** to get an evidence-based review.
