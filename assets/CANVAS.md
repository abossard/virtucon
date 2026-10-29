# Canvas guidance

Use this guide when presenting or steering work through a canvas. The [orchestration guide](ORCHESTRATION.md) owns workflow decisions and handoffs.

## Run work on the board

The `minime-flow` canvas is the minime board: the same page and conductor as `node conductor/minime.mjs`, one run per open canvas for the session's repository. Open it with `task` to start a run, or start one later with the `start` action. Closing the canvas stops its workers.

Steer the run with the canvas actions, in the user's words:

- `state` reads the status, the phase, open questions, jobs and scores.
- `start` begins a new task; `feedback` sends a correction or follow-up, which applies after the running worker.
- `answer` answers open questions by decision ID (`{ "C2": { "choice": "…" } }`), or with `text` when there are none. An unchanged recommendation is recorded as `default:`.
- `pause`, `resume` and `stop` control the workers.

Report what the board shows. Don't claim a phase finished, a question was answered or the canvas opened when the state doesn't say so. If the canvas is unavailable, run the conductor from the command line or follow the flow in chat, and say which one you used.

## Change a blueprint

Criteria, their evidence and inputs change through the flow, not by hand: send the correction as `feedback`, and the next blueprint pass records it as an input and rewrites the plan. Recorded inputs stay verbatim.

Boundaries can be edited on the board's Boundaries panel while no worker runs (the run is asking, done, stopped or failed). Saving rewrites that table, refuses an edit that adds a `check` error, keeps the old blueprint in raw and clears `Extracted:`. Ask for a new round to rebuild against the edit.

## Browse shared knowledge

Keep the complete wiki reachable. A current-repository preset may narrow the initial view, but the user can remove it. Keep raw sources read-only and apply the [wiki schema](.agent/wiki/schema.md) to edits.

Resolve provider ambiguity before acting. Preserve existing personal providers and their data until the user authorizes migration or removal.

## Verify a changed view

Exercise the actual host for claims about navigation, keyboard behavior, focus, layout, or reconnection. Include a meaningful failure path. For status changes, verify that the view identifies the right work and distinguishes missing data from completion. When reviewing diagrams, use the [visual-design guidance](../skills/ousterhout-review/visual-design.md).
