---
name: inspect
description: Verify task-scoped changes in a fresh context against active criteria and invalidated proofs. Return evidence and a correctness-uncertainty risk tier.
context: fork
agent: minime:frau
---

# Inspect

Read the [shared workflow](../../assets/ORCHESTRATION.md) on entry. Follow its phase-isolation and inspection-scope rules. If this is the implementing context, request a fresh inspector instead of reviewing.

## Mutation boundary

Treat implementation source and tests as read-only. Gather evidence and run scoped checks; keep temporary investigation artifacts outside the repository and clean them up.

Return proposed fixes, conflict resolutions, and permission needs to the owner. Do not modify, restore, revert, or stash the working tree, or perform Git mutations. The owner manages run-level progress.

## 1. Validate the handoff

Read the blueprint and supplied task boundary. Check that passing criteria have proof, status matches the work, and decisions and implementation evidence are present.

Identify archived proofs invalidated by changed artifacts or proof definitions. Record missing or contradictory handoff information as process gaps.

If the task boundary is absent or ambiguous, return `blocked` with the scope the owner must supply. Do not expand it into a branch-wide or repository-wide review.

## 2. Verify the criteria

Treat candidate findings as leads. Verify each against the real code, its callers, and relevant dependency documentation. Keep findings concrete and within the task boundary.

For each active criterion and invalidated proof, record:

| Criterion | Evidence method | Boundary exercised | Edge/error case | Raw result | Remaining uncertainty |
|-----------|-----------------|--------------------|-----------------|------------|-----------------------|

Exercise behavior through the interface its caller uses. Distinguish internal checks from proof at the required boundary. A behavioral criterion needs a meaningful edge or failure case.

Check applicable scoped knowledge against live code. When the change includes or requires a design artifact, follow the [visual-design guidance](../blueprint/visual-design.md) and verify that the diagram agrees with the changed interfaces.

When reviewing a canvas change, use the verification section in [Canvas guidance](../../assets/CANVAS.md#verify-a-changed-view). Discover current interface details from runtime schemas and source rather than treating copied inventories as requirements.

Complete one bounded pass and return its findings. The owner decides whether to request fixes or another pass.

## 3. Report missing requirements

If review reveals a requirement that belonged in the original task, return a proposed EARS criterion with its VOI category and source. Preserve human feedback verbatim. The owner decides whether to open a correction.

## 4. Assess uncertainty

Risk measures correctness uncertainty in the artifact and its declared contract.

For instruction changes, verify the text, applicable deployed copy, referenced paths and commands, contradictions, and existing checks. Inability to predict future model compliance is not a risk driver by itself.

For each present driver, collect the corresponding mitigation:

| Driver | Required mitigation |
|--------|---------------------|
| Changed behavior lacks tests | Inspector-executed boundary tests covering the behavior and an error case |
| Untested conditional paths | Execution covering each reachable changed branch, or code proving an omitted branch unreachable |
| Weak type safety | Type-check output and executed boundary tests for untyped paths |
| Compatibility surface | Executed contract checks against prior supported inputs and outputs |
| Unverified assumptions | Execution evidence or an exact code reference for each assumption |
| External state | Executed integration checks with representative state and a failure path |
| Unfamiliar patterns | An established analogous code path plus executed boundary checks |
| New executable lacks execution proof | Independent execution with representative valid and wrong inputs |
| Missing or stale design artifact | An updated diagram and verified agreement with the changed code |

Assign HIGH when a present driver lacks mitigation, a concrete contradiction or runtime reference is unresolved, or confidence is below high. Assign LOW only when each present driver has its mitigation and confidence is high. Explain the remaining uncertainty.

## 5. Return evidence

Prepare one package containing:

1. Criterion traceability and the scoped diff.
2. Raw output for criterion-proving and failing runs. A bulk passing suite that proves no active criterion may use a one-line summary.
3. Assumptions and two or three specific least-sure points.
4. Process gaps and out-of-scope discoveries.
5. Inconsistencies between sources, or an explicit `None.` when they agree.

Present raw proof before interpretation, following the shared evidence rules. Report concrete uncertainty without personal assurance. Do not include an approval verdict, score, or persuasion; the caller decides what to accept.

Return the [shared result](../../assets/ORCHESTRATION.md#result-contract), with accepted criterion IDs, invalidated-proof outcomes, the risk tier, and package references in its excerpts. The owner handles archival and subsequent work.
