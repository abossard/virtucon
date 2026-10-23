---
name: inspect
description: Independently verify a change against its minime blueprint in a fresh context. Runs the project's tests, probes each criterion's tests to see that they can fail, and checks boundaries, constraints and scope. Returns evidence, never a verdict. Use after replicate, before calling a blueprint done, or when the user asks to check, verify or review work against its blueprint.
allowed-tools: Read Grep Glob Bash Write Edit
---

# Inspect

You check someone else's work. Executed proof counts; claims, summaries and earlier results don't. If you wrote this change in this context, stop and ask the caller for a fresh inspector, because a reviewer who shares the builder's context tends to share its blind spots.

Treat source and tests as read-only, except for the one temporary probe in step 4. You write the findings file and nothing else that stays. Put scratch work outside the repository.

The blueprint tool is `node ../blueprint/scripts/blueprint.mjs` from this skill's base directory. The session nudge prints the absolute command.

## Scope

The caller gives the blueprint, the repo and the changed files, and optionally the criterion IDs to recheck. Without changed files, return `blocked` and ask for them. Don't widen the review to the whole branch or repository.

## Check

1. **Coverage.** Run `node <blueprint tool> coverage <blueprint> --repo <repo> --files <changed files>`. A criterion without a test file is a finding, unless no automated test can decide it; then decide it from the code and cite `path:line`.
2. **Re-run.** Run the project's tests that cover the changed files, and the full suite when shared infrastructure, build config or dependencies changed. Find the command in the README, CI config, build files, package scripts or the repo's wiki pages. Record the command and its pass and fail counts. These results replace the builder's.
3. **Tests prove criteria.** Read each criterion's tests (the files `coverage` lists). Each should call the boundary the blueprint names rather than a mock of it and cover an edge or error case. A local or mocked test doesn't prove host, browser or cloud behavior; list that as unverified.
4. **Probe.** A test proves a criterion only if it can fail, so try to make each one fail. First run `node <blueprint tool> fingerprint --repo <repo>` and keep the output. Then, for each criterion, use the cheapest probes that apply:
   - Run the boundary with an input the tests don't use, such as an edge or error case from the contract or a value just past a limit, and compare the result with the Boundaries contract. A throwaway script outside the repository is fine.
   - Break the behavior and rerun only that criterion's tests. Copy the file to a temporary path outside the repository, change one line (flip a comparison, drop a guard, return a constant), run, then copy the saved file back with a plain `cp` so build tools see it as changed, and rebuild the affected target. Never use `git checkout`, `git stash` or `git restore`: the changes in the tree are the builder's uncommitted work.

   Keep to a few probes per criterion and prefer ones that need no rebuild. A break that no test catches is a finding. When you finish, run `fingerprint` again. It must equal the first output; if it doesn't, restore from your copies and compare again before anything else.
5. **Boundaries.** Compare the changed files with the Boundaries table. Contracts must still hold, with no new owners or dependencies, and unchanged boundaries untouched. For design concerns, use the ousterhout-review skill. For changed side effects, shared state or effect ordering, use the simplicity-review skill.
6. **Constraints and scope.** Confirm each constraint still holds and nothing out of scope changed.
7. **Missing requirements.** If the change reveals a requirement the criteria lack, propose it as an EARS criterion with its source. The caller decides.

## Findings

Write `<name>.runs/inspect.md` next to the blueprint (create the directory), replacing any earlier one. List one finding per item: the criterion ID, the evidence (command output excerpt or `path:line`), and what is wrong. After the findings, list the probes (criterion, what you changed or ran, whether a test failed) and the two fingerprints, then what you couldn't verify and why. Write `None.` when there are no findings. Present evidence before interpretation, and give no verdict, score or reassurance; the user decides.

## Return

Report the blueprint and findings file paths, the test command with its counts, the coverage result, the number of probes and findings, and whether the fingerprints match. When the scope is missing, say what you need.
