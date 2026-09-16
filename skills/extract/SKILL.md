---
name: extract
description: Capture reusable lessons from completed work, or lint existing project knowledge. Ground durable claims in live code.
allowed-tools: Read Edit Write Grep Glob Bash(git log *) Bash(git diff *) Bash(git show *) Bash(git remote get-url *) Bash(git status)
---

# Extract

Read the [shared workflow](../../assets/ORCHESTRATION.md) on entry. It owns the terminal boundary, knowledge layout, layer boundaries, and handoff rules.

## 1. Harvest the task

Read the persisted blueprint's decisions, review discoveries, and verbatim feedback. Prioritize human corrections, then reusable design decisions, research findings, useful failed approaches, and stale guidance.

For an explicit knowledge-lint request, use the lint branch below.

## 2. Select lessons

Locate the relevant knowledge using the shared layout and context rules. Check compatibility inputs before declaring earlier guidance absent.

Retain a lesson only when it is actionable, reusable, cited, and adds information. Verify the cited code before promoting a claim.

Apply the shared knowledge and source-handling boundaries to retained material.

## 3. Update knowledge

Capture retained source material in the raw layer. Maintain the corresponding wiki topics and link them to that source.

Use the knowledge template for topic pages. Keep their summary, scope, citations, and verification date useful for later retrieval.

Prefer newer, better-supported guidance when sources conflict. Mark obsolete claims stale or superseded instead of leaving competing active rules.

## 4. Consolidate and return

Merge overlapping topics where one rule can carry the distinct information. Keep the catalog and activity log current.

Return the [shared result](../../assets/ORCHESTRATION.md#result-contract). Include candidates considered, pages changed, and stale claims handled.

## Knowledge lint

When asked to audit existing knowledge, check:

- Stale or broken citations and conflicting claims.
- Duplicate guidance and orphan scopes.
- Coverage gaps in recently changed areas.
- Blueprint findings that warrant promotion.

Report or repair only the requested scope, then return the shared result.
