# Visual design reference

Use this guide when boundaries change, placement is uncertain, or a visual is requested. The [shared workflow](../../assets/ORCHESTRATION.md#boundary-approval) owns approval and drift.

## Diagram selection

- Use a module flowchart by default.
- Use a sequence diagram when call ordering or lifecycle is the main risk.
- Use a state diagram when transition rules or recovery paths are the main risk.

## Boundary map

- Embed or link a visual in Plan summary with persisted editable source. Choose from user preferences and available tools, including Mermaid, draw.io, or a diagram canvas. Report unavailable preferences; use the shared decision rule for an unavailable required format.
- Draw the affected owners, cross-boundary contracts, and actual interactions, anchored to source paths. Keep unchanged boundaries small and marked unchanged.
- Show current and proposed boundaries. Distinguish dependency direction from data flow and mark added, changed, and removed relationships.
- Keep labels readable in dark mode. Text and tables supplement the visual.
- Use `<br/>` for line breaks in Mermaid labels.

## Untangling

1. Trace affected owners and callers in live code. Identify each owner's public responsibility and the implementation decisions it hides.
2. Compare plausible placements when ownership is uncertain. Prefer substantial behavior behind simple interfaces over pass-through seams or more tiny modules.
3. In existing projects, untangle and reduce complexity; additions should preserve it where feasible. Compare changed boundaries for caller knowledge, dependencies, representation leakage, state/effect coordination, and future change locality.
4. Record added obligations and alternatives in Decisions made for the same boundary approval. Moving coupling elsewhere or reducing file count alone does not show simplification. Keep changes task-scoped.
5. Complete when each changed boundary has an owner and contract, and material tradeoffs are recorded for the user.

## Handoff checks

- Check the rendered map and editable-source references, then compare code with approved decisions under the shared approval rule.
- Report unapproved differences as Boundary drift.
