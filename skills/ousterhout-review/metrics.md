# Metric interpretation

Use measurements to locate relationships worth reviewing and to compare a design change. Conformance checks establish a declared rule; diagnostic metrics need interpretation against the boundary's purpose.

## Select evidence

State the node unit, edge meaning, analyzed scope, and omitted or unresolved relationships. Keep type-only references, runtime imports, possible calls, observed traces, and co-change distinct.

Package-manager graphs can describe workspace components or external packages; they do not automatically reveal internal code boundaries.

For before/after comparison, keep the same scope, grouping, and filters. Explain correspondence when boundaries themselves change.

## Read the signals

| Signal | Investigate | Limit |
|--------|-------------|-------|
| Dependency rules | A forbidden or required relationship | The rule must come from the intended architecture |
| Cycles / strongly connected components | Mutual dependencies between intended owners | Function recursion and workflow loops are different questions |
| Fan-in / fan-out | Direct consumers and dependencies | A useful shared module can legitimately have high fan-in |
| Reverse reachability | Consumers potentially affected by a supplier change | Reachability is exposure, not a count of required edits |
| Public interface surface | Concepts, preconditions, ordering, and errors callers must know | Export or parameter count alone does not measure depth |
| Cohesion / representation leakage | Unrelated responsibilities or details crossing a boundary | Class-specific metrics need an appropriate class/state model |
| Churn / co-change | Maintenance hotspots and implicit coordination | Bulk commits, generated code, and expected test/schema changes confound it |
| Function complexity | Branching that makes local behavior harder to reason about | It does not assess module placement or public contracts |

With edges directed from consumer to supplier, follow incoming edges for supplier-change impact. A static graph describes possible relationships under its extraction assumptions, not every runtime execution.

When tools report CBO, LCOM, instability, or abstractness, inspect their definitions and counting units. Treat undefined cases explicitly. Apply class-based measurements only where that model fits.

Smaller scores, fewer files, or an extra wrapper alone do not establish improvement. Use thresholds only for justified project rules; report tradeoffs instead of inventing an overall design score.
