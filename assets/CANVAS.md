# Canvas guidance

Use this guide when presenting, editing, or verifying work through a canvas. The [orchestration guide](ORCHESTRATION.md) owns workflow decisions and handoffs.

## Present the work

The task owner opens an editable view of the persisted blueprint when the runtime supports one. A direct phase caller acts as the owner; workers in an orchestrated run update the existing work rather than opening competing views.

Discover the available view and its current action schemas before use. If support is absent or an operation fails, keep the file workflow usable. Record the observed reason and the blueprint path in the evidence. Do not claim that a view opened when it did not.

Show the current phase, criterion, required decisions, and available proof. Take these from owner reports and native execution data. Show unavailable information as unknown. Follow the [progress rules](ORCHESTRATION.md#progress-tracking) for pending or blocked work.

Keep the document central. Make supporting detail collapsible and keyboard-accessible. Background updates must preserve the user's focus and unfinished edits.

## Edit safely

Use the [correction workflow](ORCHESTRATION.md#correction-queue-contract) for blueprint changes. Distinguish saved drafts, pending application, conflicts, and persisted results in the view.

Identify documents independently of their panels so reopening or reconnecting can recover the right work. Use persistence evidence for success labels.

## Browse shared knowledge

Keep the complete wiki reachable. A current-repository preset may narrow the initial view, but the user can remove it. Apply the [knowledge-layer boundaries](ORCHESTRATION.md#shared-knowledge-contract) to editing.

Resolve provider ambiguity before acting. Preserve existing personal providers and their data until the user authorizes migration or removal.

## Verify a changed view

Exercise the actual host for claims about navigation, keyboard behavior, focus, layout, or reconnection. Include a meaningful failure path.

For editing changes, prove persistence and conflict handling without losing either version. For status changes, verify that the view identifies the right work and distinguishes missing data from completion. When reviewing diagrams, use the [visual-design guidance](../skills/blueprint/visual-design.md).
