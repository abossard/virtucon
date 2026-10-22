---
name: replicate
description: Implement a minime blueprint test-first. Writes each blueprint test at its boundary, watches it fail, makes the smallest change that passes it, and records the results with the blueprint tool. Use when a blueprint is planned and the work should be built, when inspection findings need fixing, or when the user asks to implement or continue a blueprint.
allowed-tools: Read Edit Write Grep Glob Bash
---

# Replicate

Build exactly what the blueprint specifies and prove it by running its checks. The blueprint is the contract; when it doesn't fit reality, report back instead of improvising, so the plan and the code stay in agreement.

## Load the work

- Read the blueprint's Criteria, Boundaries, Tests, Decisions, Constraints and Out of scope. Read Inputs only when a criterion's wording needs its source. Don't open old run logs.
- Work on the tests the caller names, otherwise every test that isn't `pass`.
- The blueprint tool is `node ../blueprint/scripts/blueprint.mjs` from this skill's base directory. The session nudge prints the absolute command.

## Build each test

1. Write the test at the boundary the blueprint names, covering its listed cases. Put variants of one behavior in one parameterized test, following the project's existing test style.
2. Run its check and confirm it fails for the expected reason. If it already passes, either the criterion already holds or the test can't see the behavior; find out which and say so.
3. Make the smallest change that satisfies the criterion inside the agreed boundaries, following the simplicity-review criteria (data, calculations, actions). Rerun the check and respond to the actual output.
4. Run the existing tests next to what you touched (callers, importers, colocated files) to keep the constraints. Run the full suite only when shared infrastructure, build config or dependencies change.

## Record

Run `node <blueprint tool> verify <blueprint> --by replicate --only <test IDs>`. It executes the checks, writes logs to `<name>.runs/`, and updates the Result cells. Don't edit Result cells by hand; `review:` checks stay `pending` for the inspector.

## Stop and report instead of improvising

- The change needs an owner, contract or dependency the Boundaries table doesn't list.
- You find a requirement the criteria don't cover. Propose it as an EARS criterion with its source; don't add it yourself.
- A check still fails after three attempts with no new information. Report the last output.

Stay inside the task: no unrelated refactors, and no staging, commits or other git changes unless the user asked for that operation.

## Return

Report the blueprint path, the changed files (sorted, repo-relative), the verify output, and any proposed criteria or boundary changes. When you stop early, name the obstacle.
