# Task brief: <one-line task name>

Repo: <repo URL — this keys the wiki>

## Goal
<2–4 sentences. What outcome, and why. Not how.>

## Acceptance criteria (EARS-style — each must be independently testable)
Use these patterns; each criterion collapses to one checkable claim:
- Ubiquitous:  The system shall <requirement>.
- Event:       When <trigger>, the system shall <response>.
- State:       While <state>, the system shall <response>.
- Conditional: If <condition>, then the system shall <response>.
- Optional:    Where <feature included>, the system shall <response>.

1.
2.
3.

### EARS quality check (quick self-check before running /minime:plan)
- Each criterion has exactly one verifiable behavior.
- At least one criterion uses an explicit trigger (`When ... shall ...`) when behavior is event-driven.
- Edge/error behavior is captured with `If ... then ... shall ...` when relevant.
- Wording avoids implementation details (state outcomes, not code structure).
- A test can be named for each criterion without adding extra interpretation.

## Out of scope
<Explicitly list what NOT to touch. Prevents scope drift.>

## Constraints / non-negotiables
<Perf budgets, libraries to use or avoid, patterns to follow. The agent
re-injects these mid-implementation, so be concrete.>

---
This is the only artifact you author. The agent's plan is not reviewed by you.
The value here is the thinking, not the ceremony — keep it short.
