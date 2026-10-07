---
name: replicate
description: Implement a persisted blueprint through a test-first execution loop. Return the changed surface and observed evidence.
allowed-tools: Read Edit Write Grep Glob Bash
---

# Replicate

Read the [shared workflow](../../assets/ORCHESTRATION.md) on entry. It owns phase handoffs, progress, correction handling, and permission boundaries.

## 1. Load the work

Read the persisted blueprint before changing anything. Work on its active correction and any accepted requirements affected by the change.

Read Constraints / non-negotiables and Out of scope again after compaction, when switching criteria, and when entering a new work area. Check applicable scoped knowledge using the shared context rules.

Read Decisions made under the [shared approval rule](../../assets/ORCHESTRATION.md#boundary-approval). Read a Boundary map when required or present.

Use [Canvas guidance](../../assets/CANVAS.md) when presenting or updating the task view.

## 2. Run a test-first loop

1. Identify the files and interfaces the criterion affects.
2. Choose a public-boundary test with a meaningful edge case for behavior, or caller/import/ownership checks for structure.
3. Run the proof and observe the unmet requirement before implementing the change.
4. Make the smallest complete change, rerun the proof, and respond to the actual output.

Select tests through callers, imports, coverage, or an existing impact map. If none exists, use module and directory colocation.

Broaden validation when a shared interface, schema, or contract changes. Reserve the full suite for changes to shared infrastructure, build configuration, or dependencies. Record the chosen scope and why it covers the criterion.

Follow the shared Boundary drift rule when agreed boundaries must change.

Apply the [simplicity-review criteria](../simplicity-review/SKILL.md#review-criteria) to changed implementation. Use the skill for review when decisions, shared values, or action coordination need assessment.

## 3. Record evidence as work completes

Tick a criterion as soon as its proof passes. Put shortened raw output immediately below it; a checkmark alone is insufficient.

Record newly resolved decisions with their sources. Report requirements discovered outside the active correction without adding them to its criteria; the owner decides how to handle them.

When a correction arrives, finish the current worker boundary and return current evidence. The shared workflow governs reconciliation and successor dispatch.

## 4. Complete the handoff

Read the blueprint and confirm:

- Passing criteria have checkmarks and inline proof.
- The document status reflects the implementation state.
- Work matches approved boundary decisions, or remaining Boundary drift is explicit.
- Evidence collected names the commands, results, changed files, and remaining assumptions.

Return the [shared result](../../assets/ORCHESTRATION.md#result-contract). Keep the scope and any unfinished work explicit.
