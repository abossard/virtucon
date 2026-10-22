---
name: inspect
description: Independently verify a change against its minime blueprint in a fresh context. Re-runs every check, confirms the tests really prove their criteria at the named boundaries, and checks boundaries, constraints and scope. Returns evidence, never a verdict. Use after replicate, before calling a blueprint done, or when the user asks to check, verify or review work against its blueprint.
allowed-tools: Read Grep Glob Bash Write
---

# Inspect

You check someone else's work. Executed proof counts; claims, summaries and earlier results don't. If you wrote this change in this context, stop and ask the caller for a fresh inspector, because a reviewer who shares the builder's context tends to share its blind spots.

Treat source and tests as read-only. You write only the blueprint's Result cells, through the blueprint tool, and the findings file. Put scratch work outside the repository.

The blueprint tool is `node ../blueprint/scripts/blueprint.mjs` from this skill's base directory. The session nudge prints the absolute command.

## Scope

The caller gives the blueprint, the repo and the changed files, and optionally the test IDs to recheck. Without changed files, return `blocked` and ask for them. Don't widen the review to the whole branch or repository.

## Check

1. **Re-run.** Run `node <blueprint tool> verify <blueprint> --by inspect` (add `--only` when you were given test IDs). These results replace the builder's.
2. **Tests prove criteria.** For each criterion, read its tests and confirm that each one calls the boundary the blueprint names rather than a mock of it, covers the listed edge or error case, and would fail if the behavior broke. A local or mocked check doesn't prove host, browser or cloud behavior; list that as unverified.
3. **Review checks.** Decide each `review:` check from the code. Set its Result cell to `pass (inspect <YYYY-MM-DD>) <reason>` or `fail (inspect <YYYY-MM-DD>) <reason>`, citing `path:line`.
4. **Boundaries.** Compare the changed files with the Boundaries table. Contracts must still hold, with no new owners or dependencies, and unchanged boundaries untouched. For design concerns, use the ousterhout-review skill. For changed side effects, shared state or effect ordering, use the simplicity-review skill.
5. **Constraints and scope.** Confirm each constraint still holds and nothing out of scope changed.
6. **Missing requirements.** If the change reveals a requirement the criteria lack, propose it as an EARS criterion with its source. The caller decides.

## Findings

Write `<name>.runs/inspect.md` next to the blueprint, replacing any earlier one. List one finding per item: the criterion or test ID, the evidence (command output excerpt or `path:line`), and what is wrong. After the findings, list what you couldn't verify and why. Write `None.` when there are no findings. Present evidence before interpretation, and give no verdict, score or reassurance; the user decides.

## Return

Report the blueprint and findings file paths, the verify output, and the number of findings. When the scope is missing, say what you need.
