# Blueprint: <short-name>

Created: <date>  |  Status: planning  |  Repo: <org/repo>

## User's original request (verbatim; do not edit or interpret)
> <paste the user's exact words here, unmodified>

## Goal
<2–4 sentences. What outcome, and why. Not how.>

## Acceptance criteria (EARS-style: each must be independently testable)

Patterns: each criterion collapses to one checkable claim:
- Ubiquitous:  The system shall <requirement>.
- Event:       When <trigger>, the system shall <response>.
- State:       While <state>, the system shall <response>.
- Conditional: If <condition>, then the system shall <response>.
- Optional:    Where <feature included>, the system shall <response>.

- [ ] <criterion 1> | VOI: <level> | Evidence: <tool, boundary, pass/fail>
- [ ] <criterion 2> | VOI: <level> | Evidence: <tool, boundary, pass/fail>
- [ ] <criterion 3> | VOI: <level> | Evidence: <tool, boundary, pass/fail>

### EARS quality check (quick self-check before planning)
- Each criterion has exactly one verifiable behavior.
- At least one criterion uses an explicit trigger (`When ... shall ...`) when behavior is event-driven.
- Edge/error behavior is captured with `If ... then ... shall ...` when relevant.
- Wording avoids implementation details (state outcomes, not code structure).
- **Every criterion has an evidence method** specifying tool, boundary layer, and pass/fail definition.
- **Evidence targets the user-facing or API boundary**, not internal implementation details.
- A test can be named for each criterion without adding extra interpretation.

## Out of scope
<Explicitly list what NOT to touch. Prevents scope drift.>

## Constraints / non-negotiables
<Perf budgets, libraries to use or avoid, patterns to follow. The agent
re-injects these mid-implementation, so be concrete.>

## Decisions made
| Unknown | VOI level | Resolution | Source |
|---------|-----------|------------|--------|
| | | | |

## Discovered during review
<!-- Criteria surfaced by review feedback that should have been in the original EARS.
     Each gets its own checkbox and VOI level. -->

## User feedback (verbatim; append, never edit or reinterpret)
<!-- Paste exact user feedback as received, with timestamps. This is raw signal. -->

---
**Principles**: preserve raw user words, derive actions separately, assess with evidence.
This file lives at `VIRTUCON_HQ/<org>/_<repo>/blueprints/<date>-<short-name>.blueprint.md` and
evolves through blueprint -> replicate -> inspect -> extract. Checkmarks track progress;
VOI levels track how each unknown was resolved.
