# Visual design reference

Use this guide to render a boundary map.

## Diagram selection

- Use a module flowchart by default.
- Use a sequence diagram when call ordering or lifecycle is the main risk.
- Use a state diagram when transition rules or recovery paths are the main risk.

## Boundary map

- Persist editable source with the requested visual.
- Choose from user preferences and available tools, including Mermaid, draw.io, or a diagram canvas. Report an unavailable required format explicitly.
- Draw the affected owners, cross-boundary contracts, and actual interactions, anchored to source paths. Keep unchanged boundaries small and marked unchanged.
- For a proposal, add proposed boundaries and mark added, changed, and removed relationships. Distinguish dependency direction from data flow.
- Keep labels readable in dark mode. Text and tables supplement the visual.
- Use `<br/>` for line breaks in Mermaid labels.

## Check the visual

Check readable labels, edge meanings, and agreement with the source relationships. Complete when the rendered map and editable source show the same boundaries.
