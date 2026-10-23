---
name: replicate
description: Implement a minime blueprint test-first. Writes a test in the project's own suite for each criterion, named with its ID, watches it fail, then makes the smallest change that passes it. Use when a blueprint is ready and the work should be built, when inspection findings need fixing, or when the user asks to implement or continue a blueprint.
allowed-tools: Read Edit Write Grep Glob Bash
---

# Replicate

Build exactly what the blueprint specifies and prove it with tests in the project's own suite. The blueprint is the contract and holds no tests or results; when it doesn't fit reality, report back instead of improvising, so the plan and the code stay in agreement.

## Load the work

- Read the blueprint's Criteria, Boundaries, Decisions, Constraints and Out of scope. Read Inputs only when a criterion's wording needs its source. Don't open old findings unless the caller names them.
- Work on the criteria the caller names, otherwise the ones `coverage` reports as missing.
- Find the project's test command in its README, CI config, build files or package scripts, or in the repo's wiki pages, and run tests the way the project does.
- The blueprint tool is `node ../blueprint/scripts/blueprint.mjs` from this skill's base directory. The session nudge prints the absolute command.

## Build each criterion

1. Write the test at the boundary the Boundaries table names, in the project's test files and style. Name it with the criterion ID (`C1_rounds_up`, `it("C1: …")`, or a `// C1` comment). Cover the normal case and an edge or error case; put variants of one behavior in one parameterized test.
2. Run it and confirm it fails for the expected reason. If it already passes, either the criterion already holds or the test can't see the behavior; find out which and say so.
3. Make the smallest change that satisfies the criterion inside the agreed boundaries, following the simplicity-review criteria (data, calculations, actions). Rerun the test and respond to the actual output.
4. Run the existing tests next to what you touched (callers, importers, colocated files) to keep the constraints. Run the full suite only when shared infrastructure, build config or dependencies change.

A criterion that no automated test can decide (a structural rule, a document) gets no test. Say so in your return and state how the inspector can check it.

## Record

Run `node <blueprint tool> coverage <blueprint> --repo <repo> --files <the test files you wrote or changed>`. Every criterion you built must list a test file. Nothing is written to the blueprint.

## Stop and report instead of improvising

- The change needs an owner, contract or dependency the Boundaries table doesn't list.
- You find a requirement the criteria don't cover. Propose it as an EARS criterion with its source; don't add it yourself.
- A test still fails after three attempts with no new information. Report the last output.

Stay inside the task: no unrelated refactors, and no staging, commits or other git changes unless the user asked for that operation.

## Return

Report the blueprint path, the changed files (sorted, repo-relative), the test command with its pass and fail counts, the coverage output, and any proposed criteria or boundary changes. When you stop early, name the obstacle.
