This repo uses the **minime** agent orchestration flow.
See `ORCHESTRATION.md` at the repo root for the four phases (plan / implement / review / harvest).
See `.agent/research/REFERENCES.md` for the empirical basis.

When a task starts, follow the flow: read the per-repo corrections wiki at
`.agent/wiki/<org>/_<repo>/wiki.md`, plan silently, implement with a test-driven
generate->run->observe->fix loop, and on review surface an evidence package
(scoped diff, real test output, assumptions, least-sure points) rather than
a verdict.
