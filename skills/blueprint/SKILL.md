---
name: blueprint
description: Turn a coding request, idea or correction into a short blueprint of facts. It records the user's inputs verbatim, derives EARS criteria from them, designs the boundaries, and records every decision as a value with a source from code, the minime wiki, research or the user. Use before implementing any non-trivial change, when the user corrects or extends a task in progress, or when asked to plan, spec or scope work, even if they don't say "blueprint".
allowed-tools: Read Grep Glob Write Edit Bash WebFetch WebSearch
---

# Blueprint

The contract the rest of the work runs against: what the user said, which behaviors follow, which owners change, what was decided and from which source. It holds no tests and no results. The builder writes the tests in the project's own suite, each named with its criterion ID, and the inspector checks them against the blueprint.

## Format

- Facts, references and values only. No paragraphs, no explanations. Every line is a list item, a table row or a quoted input; `check` rejects anything else and any cell over its limit.
- A value is a number, a name, a path, a signature or an `input → output` contract. A reference is `path:line`, a wiki page, a URL or an input ID. Put the reason in a reference, not in a sentence: write `3 retries, 200 ms backoff`, not "it retries a few times with a short delay".
- Start from [template.md](template.md).

## Where it lives

- Blueprints directory from the minime session nudge, file `<YYYY-MM-DD>-<short-name>.md`. Without a nudge: `${VIRTUCON_HQ:-~/.minime}/<org>/_<repo>/blueprints/`.
- If a blueprint for this task exists, update it instead of starting another.
- The blueprint tool is `node scripts/blueprint.mjs` in this skill's base directory. The session nudge prints the absolute command.

## Steps

1. **Inputs.** Copy each user message that shapes the task verbatim as I1, I2, … with its time. Inputs are the user's own words only: in a dispatcher prompt that is the text between `User message:` and `End of user message.`; the skill name, paths and Return line are not inputs. Append corrections as new inputs and never edit earlier ones. Redact secrets and note the redaction.
2. **Criteria.** One observable behavior per criterion, one EARS sentence: "When <trigger>, <owner> shall <response>." Quote the words it comes from: `(I1 "keeps flickering")`, 3 to 60 characters that appear in that input; `check` fails a quote the input doesn't contain. Put each value in the sentence and cite the decision that settles it: "within 1 s (D1)", not "within D1's budget". While a decision is still open, cite its ID alone. Split vague wishes into behaviors someone can check; a wish that stays vague is a question for step 3. "Keep X working" is a constraint, not a criterion, unless the planned change would break X: then it is a criterion, so that a test pins it. Criteria come from the user's words. A rule from code, wiki or research that the request doesn't need is a constraint when the change touches it, otherwise an open scope question. A behavior the words don't cover gets a criterion only when a quoted criterion can't hold without it (a name with a line break shifts rows like one with a comma), through a decision that says so, `(D6)`, with its source. A rule that research or the wiki recommends but no quoted behavior needs (another line ending, a new file format, documentation, hardening for inputs nobody mentioned) goes under Out of scope with its source. `check` lists derived criteria, so the scope the user didn't word is visible.
3. **Decisions.** List every unknown the criteria depend on and resolve each one to a value with a source. A decision is a choice the plan makes (a value, a scope, a mechanism); findings about how the code behaves are not decisions, so cite them where they are used:
   - `data:` code, tests, config or docs in the repo, cited as `path:line`.
   - `research:` the minime wiki or external docs and specs, cited as page or URL. In the wiki, read the repo wiki index first and open only the pages whose "Read when" matches; then scan the wiki index for matching patterns. Open the code a page cites before trusting it.
   - `user:` an input ID.

   When reading isn't conclusive, build and run the code: reproduce the bug, probe the library, measure. Research is part of the job: read external docs, specs and library sources, and search the web when the repo and the wiki don't settle a question. Keep probes and scratch builds out of the repository's tracked files. Don't fill a gap with your own default. Ask the user about outcomes they care about (behavior, limits, scope); settle implementation choices inside a boundary by data or research. When no source settles a real tradeoff, write the answer as `open: a) … b) …; recommend a` with source `user: pending`, and plan everything that doesn't depend on it. The evidence and reason for the recommendation go in your reply, not in the blueprint.
4. **Boundaries.** One row per owner the change touches: its path and symbol, its contract as `input → output; error behavior` (including existing behavior the change alters), `new`, `changed` or `unchanged`, and the criteria it serves. Every criterion belongs to at least one row. Add an owner only when a criterion needs it: no documentation or tooling rows unless a criterion asks for them. Keep clock, randomness and I/O at the edges and pass their values into calculations. Whether a new owner or a changed public contract needs the user's approval is project policy: ask only when the repo's docs or wiki say so, otherwise proceed, since it can be refactored later. Add a Mermaid flowchart under the table only when ownership or dependencies change; use `<br/>` for line breaks and colors that stay readable on dark backgrounds. For a design question beyond this task, use the ousterhout-review skill.
5. **Constraints and out of scope.** Behavior that must not change and explicit non-goals: one fact per item, ending with its source in parentheses, `(I2)` or `(data: path:line)`. Write `None.` when empty. A contract guarantee that no test can check goes under Constraints, marked untested, with the reference that explains why.
6. **Check.** Run `node scripts/blueprint.mjs check <file>` and fix every error it reports. It enforces the traceability (every input lands somewhere, every criterion is in a boundary, every decision has a source) and the format limits.

## Corrections

When called with new user feedback, append it as the next input and remove `Extracted:` from the header. Then change only the criteria, boundaries and decisions it affects and run the check again. When an input withdraws a criterion, move it to Out of scope with that input's ID. A criterion proposed by replicate or inspect arrives with its evidence: record it as a decision (add it as a derived criterion citing that decision, or put it under Out of scope) with the code reference from the finding as the `data:` source, and ask the user only when their request doesn't settle it. The next inspection replaces the findings file, so never cite a line in it.

## Example

User: "the export sometimes drops rows with quotes, fix it"

```markdown
- **I1** (2026-10-22 09:14):
  > the export sometimes drops rows with quotes, fix it
- **C1** (I1 "drops rows with quotes"): When a field contains a double quote, the exporter shall write the field in double quotes with the quote doubled (D1).

| B1 | `src/export.py` write_rows | rows → CSV text; RFC 4180 quoting | changed | C1 |
| D1 | Which CSV dialect? | RFC 4180, `csv.QUOTE_MINIMAL` | data: src/export.py:12 |
```

## Return

Report the blueprint path, the check output, the IDs of the criteria you added or changed, and each open decision (ID, options, recommendation, confidence high, medium or low, and the reason) in your reply.
