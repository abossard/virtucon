---
name: blueprint
description: Plan coding tasks with checkable criteria, boundary decisions, and evidence methods.
allowed-tools: Read Edit Grep Glob Bash(git remote get-url *) Bash(git log *) Bash(git status) Bash(ls *) Bash(mkdir *) Write
---

# Blueprint

Read the [shared workflow](../../assets/ORCHESTRATION.md) on entry. It defines phase ownership, progress, decisions, knowledge layout, and handoffs.

## 1. Persist the task

Resolve the task source and owning repository. Create or update the living blueprint in the shared knowledge layout, starting from the user's HQ template.

The [bundled template](../../assets/blueprint.template.md) owns the required document shape. Normalize an older or reordered HQ template in the living document only; leave the user's template untouched. Preserve earlier completion records and recheck only affected requirements.

Preserve the original request once in its section. Append later user corrections under User feedback and reference them from the active correction.

Read the new file back before continuing. For presentation or unavailable canvas support, follow [Canvas guidance](../../assets/CANVAS.md).

## 2. Make criteria checkable

Write one observable requirement per criterion using EARS form: identify the trigger or condition and the required response.

For each criterion, name the proving tool or interface, the boundary exercised, and the pass/fail result. Include a meaningful edge or error case. For preservation requirements, identify the existing behavior that must remain.

Prove structural criteria through imports, callers, contracts, or state/effect ownership; passing behavioral tests alone is insufficient.

Use the shared decision rule when the task lacks a value choice that evidence cannot resolve.

## 3. Gather relevant guidance

Use the shared knowledge layout to locate the schema, navigation pages, scoped topics, and related raw sources. Apply the [context rules](../../assets/ORCHESTRATION.md#context-engineering) when selecting and verifying claims.

Put guidance that affects the task in Constraints / non-negotiables or Decisions made, with its source. Continue without repository wiki context when no topic pages exist.

Resolve remaining unknowns through the shared VOI process. Use bounded general-purpose workers for research that warrants delegation.

## 4. Select supporting skills

Discover skills that fit the task. For module design, prefer `codebase-design` when available.

Before drafting, invoke available writing guidance such as `writing-for-agents`. Use an available prose-review skill such as `stop-slop` after the draft.

If no writing skill is available, apply the readability rules below. Supporting skills are optional dependencies, not installation prerequisites.

## 5. Write the plan

Match the requested level of detail.

- For interface or boundary principles, describe responsibilities, inputs, outputs, and observable guarantees. Leave private implementation choices to the implementer.
- For an implementation plan, identify affected files, work order, approach, tests, and verified constraints.

Draw a Boundary map when boundaries change, placement is uncertain, or the user requests one, using the [visual-design guidance](visual-design.md). Otherwise state that boundaries are unchanged. Record design decisions under the [shared approval rule](../../assets/ORCHESTRATION.md#boundary-approval).

## 6. Review the document

Check for missing outputs, material initialization or error behavior, conflicting guarantees, and claims a reader cannot verify.

Challenge each criterion's proof, including its meaningful edge case. Record material assumptions or verification gaps in Plan summary.

Apply the selected prose review. Its metrics guide edits; they do not establish correctness.

## 7. Complete the handoff

Read the persisted file. Confirm the criteria, proof methods, constraints, decisions, and any required boundary visual are present.

Remove authoring comments, placeholders, and teaching scaffolding. Use `None.` for empty sections. Set the document status to `planned` when it is ready.

Update native progress and return the [shared result](../../assets/ORCHESTRATION.md#result-contract). Include the persisted path and relevant availability evidence.

## Readability rules

- State each requirement once and reference it elsewhere.
- Name the owner, public inputs and outputs, and material edge behavior.
- Use consistent terms and short factual sentences.
- Keep source references beside the claims they support.
- Preserve user wording verbatim; write surrounding prose without em dashes, process narration, or self-praise.
