---
name: replicate
description: Implement a minime blueprint test-first. Starts from a reproduction (bug) or the thinnest end-to-end slice through the planned module boundaries (feature), then writes a test in the project's own suite for each criterion, named with its ID, watches it fail and makes the smallest change behind a narrow interface that passes it. Use when a blueprint is ready and the work should be built, when inspection findings need fixing, or when the user asks to implement or continue a blueprint.
allowed-tools: Read Edit Write Grep Glob Bash
---

# Replicate

Build exactly what the blueprint specifies and prove it with tests in the project's own suite. The blueprint is the contract and holds no tests or results; when it doesn't fit reality, report back instead of improvising, so the plan and the code stay in agreement.

## Load the work

- Read the blueprint's Criteria, with the evidence brackets that hold their values, and its Boundaries, where rows marked `unchanged` name what must not change. Read Inputs only when a criterion's wording needs its source. Don't open old findings unless the caller names them.
- Work on the criteria the caller names, otherwise the ones `coverage` reports as missing. When the caller names boundary rows, change only their files: other workers may be editing the rest of the tree at the same time.
- Open the repo wiki index from the session nudge. When it lists `process-replicate.md`, open it and apply a rule whose shape matches an input, a probe result or an evidence bracket at hand.
- Find the project's test command in its README, CI config, build files or package scripts, or in the repo's wiki pages, and run tests the way the project does.
- The blueprint tool is `node ../blueprint/scripts/blueprint.mjs` from this skill's base directory. The session nudge prints the absolute command.

## Start running, then grow

- **Bug:** first write the test that reproduces it at the boundary the blueprint names, and watch it fail for the reported reason. No fix before the reproduction fails.
- **Feature:** first build the thinnest slice that runs end to end through the owners in the Boundaries table, with their planned interfaces in place and the simplest behavior behind them, and get it green. Then fill in the criteria. Code that has never run end to end is a guess.

## Build each criterion

1. Write the test at the boundary the Boundaries table names, in the project's test files and style. Name it with the criterion ID (`C1_rounds_up`, `it("C1: …")`, or a `// C1` comment). Cover the normal case and an edge or error case; put variants of one behavior in one parameterized test.
2. Run it and confirm it fails for the expected reason. If it already passes, either the criterion already holds or the test can't see the behavior; find out which and say so.
3. Make the smallest change that satisfies the criterion inside the agreed boundaries. Keep interfaces narrow (A Philosophy of Software Design): change behavior behind the interface the Boundaries table names, add no export or parameter it doesn't list, and add no function that only one place calls unless it hides real complexity behind a smaller interface. Pass-through wrappers, copies of existing code and guards for inputs no criterion mentions don't belong in the change. Follow the simplicity-review criteria (data, calculations, actions). Rerun the test and respond to the actual output.
4. Run the existing tests next to what you touched (callers, importers, colocated files) to keep what must not change. Run the full suite only when shared infrastructure, build config or dependencies change.

A criterion that no automated test can decide (a structural rule, a document) gets no test. Say so in your return and state how the inspector can check it.

## Record

Run `node <blueprint tool> coverage <blueprint> --repo <repo> --files <the test files you wrote or changed>`. Every criterion you built must list a test file. Nothing is written to the blueprint.

## Stop and report instead of improvising

- The change needs an owner, interface or dependency the Boundaries table doesn't list, or a file outside the boundary rows you were given.
- An existing test fails after your change and passing it would mean removing, loosening or changing its assertion, and no criterion asks for that behavior change. A removed or rewritten line of an existing test is the user's decision, not yours: until a `user:` bracket in the blueprint confirms it, keep the line and change the code, and restore the lines a `keep` answer covers.
- You find a requirement the criteria don't cover. Propose it as an EARS criterion with its source; don't add it yourself.
- A test still fails after three attempts with no new information. Report the last output.

Stay inside the task: no unrelated refactors, no new rules in the repo's AGENTS.md, CLAUDE.md or instruction files (lessons go to the wiki through extract), and no staging, commits or other git changes unless the user asked for that operation.

## Return

Reply with one JSON object in a `json` code block and nothing else: `status`, `blueprint_path`, `changed_files` (sorted, repo-relative), `blocking_issue`, `evidence_excerpts` (the test command with its pass and fail counts, and the coverage result), and `proposed_criteria` (EARS sentences with their source, or an empty list). When you stop early, name the obstacle in `blocking_issue`.
