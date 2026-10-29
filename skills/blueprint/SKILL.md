---
name: blueprint
description: Turn a coding request, idea or correction into a short blueprint of inputs, EARS criteria with inline evidence, and narrow boundaries. Use before a non-trivial change, when the user corrects or extends a task in progress, or to plan, spec or scope work.
allowed-tools: Read Grep Glob Write Edit Bash WebFetch WebSearch
---

# Blueprint

## Format

Three sections only ([template.md](template.md)): `## Inputs`, `## Criteria`, `## Boundaries`. Facts, references and values only: list items and table rows. A fact that fits no section goes into the criterion or boundary row that needs it.

- A criterion is one line that ends with a bracket per value or choice it states, `[<source>: <reference>]`, strongest first: `ran: <command> → <observed>` (add `; surprise: expected <value>` when it contradicted your prediction; a bug's first `ran:` reproduces it), `data: path:line`, `research: <page or URL>`, `user: I2` (stated in input I2), `default: I2` (a recommendation the user accepted unchanged, marked `(default)`), or `open: a) <option> b) <option>; recommend a` when no source settles a tradeoff the user cares about.
- A behavior that must not change is an `unchanged` Boundaries row whose Contract names it and whose Criteria are the ones that rely on it.
- Aim for 2 KB or less without the Inputs (`check` warns above); split rather than drop a needed fact.
- File: `<YYYY-MM-DD>-<short-name>.md` in the blueprints directory from the session nudge; update the task's blueprint if one exists.

## Steps

Before step 1, open the repo wiki index from the nudge, and `process-blueprint.md` if it lists one. A rule whose shape matches an input, a probe result or a value at hand is cited in that criterion's bracket, `[research: process-blueprint.md#<anchor>]` (the rule's heading slug), bare or as a markdown link.

1. **Inputs.** Copy each user message that shapes the task verbatim as I1, I2, … with its time (in a dispatcher prompt, only the text between `User message:` and `End of user message.`). Append corrections, never edit earlier inputs, redact secrets and say so.
2. **Criteria.** One observable behavior each, one EARS sentence: "When <trigger>, <owner> shall <response>." Quote its words, `(I1 "keeps flickering")`, 3 to 60 characters from that input. Before you write a value, predict it and how to find out, then find out by running code where you can. Memory is not a source; check a wiki page against the code it cites. Keep probes out of tracked files.

   A behavior an existing test asserts must not change: when an option fails such a test or needs its assertion removed, loosened or changed, the option that keeps it wins unless the user's words name that behavior as wrong (words about tests or fixes don't). When two options both satisfy the criteria, run the existing tests that cover the files each changes (except tests a criterion changes) on a scratch copy with that option applied, and record both, `[ran: <suite> with a → 73/6, with b → 79/0]`; the only green option wins.
3. **Boundaries.** One row per owner the change touches: path and symbol, `input → output; error behavior`, `new`, `changed` or `unchanged`, the criteria it serves; every criterion is in a row. Keep interfaces narrow: change behavior behind an unchanged interface rather than add a parameter, add an owner only when it hides real complexity, never one that only passes calls through. Every exported symbol the change adds or alters is in a row; any other interface change is a deviation.
4. **Check.** Run `node scripts/blueprint.mjs check <file>` (absolute command in the nudge) on every file you wrote and fix every error.

## Splits

When a blueprint grows past the size goal, split it into a root and children `<parent name>.<short-name>.md`, each naming its parent in the header: `Repo: <org>/<repo> | Created: <YYYY-MM-DD> | Parent: <parent file name>`. A child stands alone: the parent's Inputs verbatim with their IDs, the delegated criteria with their IDs, text and brackets, and the Boundaries rows that serve them. The parent replaces those rows with one: Owner the child file name in backticks and nothing else, Contract the child's purpose as `input → output`, Change `new` or `changed`, Criteria the delegated IDs. The parent keeps every criterion; edit the child's copy and copy the change into the parent verbatim. A criterion added in a child takes an ID unused in the parent and its siblings.

## Corrections

On user feedback, copy the blueprint first to `${VIRTUCON_HQ}/raw/<org>/<repo>/blueprints/<blueprint name>/<YYYY-MM-DD-HHMM>.md`. Then append each message as the next input (every child too), remove `Extracted:` and rewrite only what it affects, in place. An answer (`Q: … A: …`) replaces the `open` bracket it settles with `[user: I3]`, or `[default: I3]` when marked `(default)`. A criterion proposed by replicate or inspect arrives with evidence: add it with the finding's code reference as a `data:` bracket, and ask the user only when their request doesn't settle it. Don't cite findings-file lines; the next inspection replaces them.

## Return

Reply with one JSON object in a `json` code block and nothing else:

- `status`, `blueprint_path`, `changed_files`, `blocking_issue`, `evidence_excerpts`.
- `criteria` (IDs added or changed) and `children` (child paths, if any).
- `size`: `small` when this round added no `new` owner and no dependency, otherwise `full`; a new blueprint is always `full`.
- `open_decisions` (status `blocked`): per `open` bracket, `{ "id" (its criterion's), "question", "options", "recommend", "confidence" (high, medium or low), "reason" }`.
- `groups`, only when this round added or changed more than three boundary rows: `{ "id": "G1", "wave": 1, "parallel": true, "boundaries": ["B1"], "criteria": ["C1"] }`. A group that calls another's new or changed interface goes in a later wave; `parallel` only for groups on different files that can build and test at the same time.
