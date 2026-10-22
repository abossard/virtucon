---
name: blueprint
description: Turn a coding request, idea or correction into a verifiable blueprint. It records the user's inputs verbatim, derives EARS criteria from them, designs the boundaries and the tests that prove each criterion, and records every decision with a source from code, the minime wiki, research or the user. Use before implementing any non-trivial change, when the user corrects or extends a task in progress, or when asked to plan, spec or scope work, even if they don't say "blueprint".
allowed-tools: Read Grep Glob Write Edit Bash(node *) Bash(git remote get-url *) Bash(git log *) Bash(ls *) Bash(mkdir *)
---

# Blueprint

The blueprint is the contract the rest of the work runs against. The builder implements its tests, the inspector re-runs them, and anyone can trace each requirement back to what the user said. Every later phase reads it, so keep it short and factual. Facts and references only, no narration.

## Where it lives

- Blueprints directory from the minime session nudge, file `<YYYY-MM-DD>-<short-name>.md`. Without a nudge: `${VIRTUCON_HQ:-~/.minime}/<org>/_<repo>/blueprints/`.
- Start from [template.md](template.md). If a blueprint for this task exists, update it instead of starting another.
- Raw output never goes into the blueprint. The verify tool writes logs to `<name>.runs/` and links them.
- The blueprint tool is `node scripts/blueprint.mjs` in this skill's base directory. The session nudge prints the absolute command.

## Steps

1. **Inputs.** Copy each user message that shapes the task verbatim as I1, I2, … with its time. Append corrections as new inputs and never edit earlier ones. Redact secrets and note the redaction.
2. **Criteria.** Write one observable behavior per criterion in EARS form, "When <trigger>, <owner> shall <response>", naming the inputs it comes from. Split vague wishes into behaviors someone can check. A wish that stays vague is a question for step 3. "Keep X working" is a constraint, not a criterion. Criteria come only from inputs: a rule from code, wiki or research that the request doesn't need becomes a constraint when the change touches it, otherwise an open scope question.
3. **Decisions.** List every unknown the criteria depend on and resolve each one with a source:
   - `data:` code, tests, config or docs in the repo, cited as `path:line`.
   - `research:` the minime wiki or external docs and specs, cited as page or URL. In the wiki, read the repo wiki index first and open only the pages whose "Read when" matches; then scan the wiki index for matching patterns. Open the code a page cites before trusting it.
   - `user:` an input ID.

   When reading isn't conclusive, run the code: reproduce the bug, probe the library. Don't fill a gap with your own default. Ask the user about outcomes they care about (behavior, limits, scope); settle implementation choices inside a boundary by data or research. When no source settles a real tradeoff, write the answer as `open: a) … b) … (recommend a, because …)` with source `user: pending`, then plan everything that doesn't depend on it.
4. **Boundaries.** Name each owner the change touches (module, function, endpoint, file) and its contract: inputs → outputs, guarantees, and error behavior, including existing behavior the change alters. Keep clock, randomness and I/O at the edges and pass their values into calculations. Mark each owner new, changed or unchanged. Whether a new owner or a changed public contract needs the user's approval is project policy: ask only when the repo's docs or wiki say so, otherwise proceed, since it can be refactored later. Add a Mermaid flowchart below the table only when ownership or dependencies change; use `<br/>` for line breaks and colors that stay readable on dark backgrounds. For a design question beyond this task, use the ousterhout-review skill.
5. **Tests.** Derive at least one test per criterion, exercised at the boundary its caller uses. Cases name the normal case plus an edge or error case; variants of one behavior are parameters of one test. Build one harness: a single test file or script with one assertion per criterion, each named with its criterion ID, run by one command from the repo root. Every row repeats that command in Check, and `verify` runs each distinct command once. The command fails before the change, while any assertion is missing, and passes once every criterion holds; some runners pass a name filter that matches nothing, so don't rely on one. Give every guarantee in a Boundaries contract a test case; one that can't be tested goes under Constraints as untested, with the reason. Rows that no harness can decide use a one-off command such as an `rg` for a structural rule, or `review: <what to inspect>`. If the repo has nothing to run the harness with (no test runner, no way to start the app), plan building it and record why in Decisions (`data:`). Write `|` inside a check as `\|`; the tool unescapes it. Result starts as `pending`.
6. **Constraints and out of scope.** Behavior that must not change and explicit non-goals, each with its source.
7. **Check.** Run `node scripts/blueprint.mjs check <file>` and fix every error it reports. It enforces the traceability: every input lands somewhere, every criterion has a test, every test names a boundary and a check, and every decision has a source.
8. **Prose.** Use the writing-for-agents skill before drafting and the stop-slop skill after it, when available. The blueprint has to be short, factual and unambiguous.

## Corrections

When called with new user feedback, append it as the next input, then change only the criteria, tests, boundaries and decisions it affects, set the Result of every test it affects back to `pending`, and run the check again. When an input withdraws a criterion, move it to Out of scope with that input's ID. A criterion proposed by replicate or inspect arrives with its evidence: record it as a decision (add it, or put it under Out of scope) with the finding as the `data:` source, and ask the user only when their request doesn't settle it.

## Example

User: "the export sometimes drops rows with quotes, fix it"

```markdown
- **I1** (2026-10-22 09:14):
  > the export sometimes drops rows with quotes, fix it
- **C1** (I1): When a field contains a double quote, the exporter shall write the row with the quote escaped as two double quotes.

| B1 | `src/export.py` write_rows | rows → CSV text, RFC 4180 quoting | changed | C1 |
| T1 | C1 | B1 | `a"b`; field that is only `"`; empty field | `pytest tests/test_export.py` | pending |
| D1 | Which CSV dialect? | RFC 4180 via `csv.QUOTE_MINIMAL` | data: src/export.py:12 |
```

## Return

Report the blueprint path, the check output, and each open decision (ID, options, recommendation) exactly as written in the blueprint.
