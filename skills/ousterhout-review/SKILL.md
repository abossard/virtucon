---
name: ousterhout-review
description: Apply Ousterhout's deep modules and information hiding to architecture reviews and improvement surveys in any language.
---

# Ousterhout review

Accept a question, design proposal, subsystem, or diff. Treat implementation and tests as read-only; save only requested design or review artifacts.

## Compose available skills

Use `codebase-design` for shared architecture vocabulary when available.

Invoke `improve-codebase-architecture` when available, passing the original request and the Ousterhout lens below. Include the requested scope, output format, stopping point, and mutation limits. For a scoped review, request findings only rather than a wider survey or interview.

If the improvement skill is unavailable, assess the supplied scope directly with this lens. Return source-backed findings, useful alternatives, and unresolved evidence gaps.

## Ousterhout lens

- Prefer substantial behavior behind simple interfaces. Judge complexity by what callers must know, including invariants, ordering, errors, and configuration.
- Hide implementation decisions likely to change. Trace whether a representation or policy change stays local instead of spreading across callers.
- Favor untangling and deeper modules over extra pass-through seams. Explain which caller obligations disappear and which the proposal adds.
- In existing projects, reduce complexity or preserve it for additions where feasible. Keep agreed behavior and decisions visible; report real tradeoffs rather than speculative cleanup.

## Evidence and visuals

Read [metric interpretation](metrics.md) when measurements or graph/history signals inform the review. Leave unavailable values unmeasured.

Use [visual guidance](visual-design.md) for requested maps or proposed boundary changes. Finish when the requested assessment has concrete evidence and explicit uncertainty.
