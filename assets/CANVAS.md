# Canvas guidance

Use this guide when presenting, editing, or verifying work through a canvas. The [orchestration guide](ORCHESTRATION.md) owns workflow decisions and handoffs.

## Present the work

The task owner opens an editable view of the persisted blueprint when the runtime supports one. A direct phase caller acts as the owner; workers in an orchestrated run update the existing work rather than opening competing views.

Discover the available view and its current action schemas before use. If support is absent or an operation fails, keep the file workflow usable. Record the observed reason and the blueprint path in the evidence. Do not claim that a view opened when it did not.

Show the current phase, criterion, required decisions, and available proof. Take them from owner reports, native execution data, and the blueprint itself: the decisions still open. Show unavailable information as unknown.

Keep the document central. Make supporting detail collapsible and keyboard-accessible. Background updates must preserve the user's focus and unfinished edits.

## Edit safely

Route blueprint changes through a saved draft and a queued apply request that the task owner commits at a worker boundary. Recorded inputs stay verbatim: a draft may add inputs but not change them. Distinguish saved drafts, pending application, conflicts, and persisted results in the view.

Identify documents independently of their panels so reopening or reconnecting can recover the right work. Use persistence evidence for success labels.

## Browse shared knowledge

Keep the complete wiki reachable. A current-repository preset may narrow the initial view, but the user can remove it. Keep raw sources read-only and apply the [wiki schema](.agent/wiki/schema.md) to edits.

Resolve provider ambiguity before acting. Preserve existing personal providers and their data until the user authorizes migration or removal.

## Verify a changed view

Exercise the actual host for claims about navigation, keyboard behavior, focus, layout, or reconnection. Include a meaningful failure path.

For editing changes, prove persistence and conflict handling without losing either version. For status changes, verify that the view identifies the right work and distinguishes missing data from completion. When reviewing diagrams, use the [visual-design guidance](../skills/ousterhout-review/visual-design.md).
