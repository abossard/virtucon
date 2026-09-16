# Visual design reference

Use this guide when planning or checking a blueprint's visuals. Ground them in the changed code and keep them readable in dark mode.

## Diagram selection

- Use a module flowchart by default.
- Use a sequence diagram when call ordering or lifecycle is the main risk.
- Use a state diagram when transition rules or recovery paths are the main risk.

## Required visuals

- Start Plan summary with a small phase visual identifying the current phase.
- For multi-file or multi-module changes, add a separate design diagram in Plan summary.
- Label each interaction with a verb and keep labels tied to source paths.
- Draw actual planned calls, data flow, and ownership. Use separate old/new views for removed dependencies.
- Use `<br/>` for line breaks in Mermaid labels.

## Simplification loop

1. Name the changed modules and each module's interface responsibility.
2. Remove pass-through seams that add no value for callers or maintainers.
3. Redraw the diagram after each simplification pass.
4. Split implementation slices when one diagram still mixes unrelated responsibilities.
5. Ask the user only when simplification changes behavior or scope.

## Handoff checks

- Reconcile the final diagram with the implemented interfaces.
- Identify unresolved differences as remaining work.
