---
name: inspect
description: Independently verify a change against the text of its minime blueprint in a fresh context. Runs the project's tests, reads each criterion and boundary against the code that implements it, runs realistic inputs at the boundaries, and measures the diff against the narrow interfaces the blueprint allows. Reports only failing tests, failing properties and deviations from the blueprint text, never a verdict. Use after replicate, before calling a blueprint done, or when the user asks to check, verify or review work against its blueprint.
allowed-tools: Read Grep Glob Bash Write
---

# Inspect

You check someone else's work against what the blueprint says. Executed results and the blueprint's own words count; claims, summaries and earlier results don't. If you wrote this change in this context, stop and ask the caller for a fresh inspector, because a reviewer who shares the builder's context tends to share its blind spots.

Don't change source or tests. You write the findings file and nothing else that stays. Scratch scripts go outside the repository.

The blueprint tool is `node ../blueprint/scripts/blueprint.mjs` from this skill's base directory. The session nudge prints the absolute command.

## Scope

The caller gives the blueprint, the repo and the changed files, and optionally the criterion IDs to recheck. Without changed files, return `blocked` and ask for them. Open the repo wiki index from the session nudge; when it lists `process-inspect.md`, open it and apply a rule whose shape matches an input, a probe result or an evidence bracket at hand. Don't widen the review to the whole branch or repository. With criterion IDs, steps 1, 3 and 4 cover only those criteria; the other steps still cover every changed file. A Boundaries row whose Owner is a child blueprint file stands for that file's rows: take its symbols from the child's Boundaries, and leave its criteria to the child's inspection.

## Check

1. **Coverage.** Run `node <blueprint tool> coverage <blueprint> --repo <repo> --files <changed files, comma-separated>`. A criterion without a test file is a finding, unless no automated test can decide it; then decide it from the code and cite `path:line`.
2. **Run the tests.** Run the project's tests that cover the changed files, and the full suite when shared infrastructure, build config or dependencies changed. Find the command in the README, CI config, build files, package scripts or the repo's wiki pages. Record the command and its pass and fail counts. These results replace the builder's. A failing test is a finding, unless no criterion's test file lists it and it fails the same way on a copy of HEAD outside the repository (`git -C <repo> archive HEAD | tar -x -C <scratch dir>`): then it is baseline; list it as unverified.
3. **Text against code.** For each criterion, read its sentence, then the code and the test that implement it. The trigger, the owner, the response and every value the sentence states must be in the code as it states them, and the test must call the boundary the sentence names and assert those values, not a mock of it. Quote the words that differ and cite `path:line`. A local or mocked test doesn't prove host, browser or cloud behavior; list that as unverified.
4. **Realistic inputs.** Run each criterion's boundary with an input the tests don't use but the user's words or the interface contract allow: an edge case, a value just past a limit, a round trip, an input from the repo's fixtures. A throwaway script outside the repository is fine. Prefer inputs a caller would plausibly pass. A result that contradicts the criterion is a finding; an input that breaks an unstated precondition is not, and neither is an extreme input that only reaches a limitation of code the change didn't touch (list it as unverified).
5. **Values and unchanged rows.** Each value a criterion states appears in the code as written. Each Boundaries row marked `unchanged` still behaves as its Contract says.
6. **Interfaces and the diff ratchet.** Run `node <blueprint tool> diff --repo <repo>` for the lines added and removed, `testLinesRemoved` and the copied blocks. Then read the diff of the changed files (`git diff HEAD -- <files>` and the untracked ones):
   - Every exported symbol, public signature or parameter the change adds or alters appears in a Boundaries row. Any other interface change is a deviation.
   - Every function the change adds has at least two callers, or hides real complexity behind a smaller interface. Count callers with `git grep -w <name>`. A function that one place calls and that only moves lines around is a finding; so is a wrapper that passes its arguments through.
   - A block `diff` reports as copied is a finding, unless a criterion calls for it.
   - For each assertion the change removed, loosened or changed to expect another result in an existing test (`testLinesRemoved` above 0), name the criterion that asks for that behavior change. Without one it is a deviation. A `user:` bracket that confirms the removal authorizes it; when a `user:` or `default:` bracket keeps the tests and `testLinesRemoved` is still above 0, each removed line is a finding.
   The amount of code is not a finding by itself: deep owners with narrow interfaces may hold as much as they need.
7. **Missing requirements.** If the change reveals a requirement the criteria lack, propose it as an EARS criterion with its source. The caller decides.

## Findings

A finding is one of three things: a failing test (the command and its output), a failing input at a boundary (the input, the expected and the actual result), or a deviation from the blueprint text (the quoted words, `path:line`, what the code does instead). Opinions, style preferences and hardening for inputs no criterion mentions are not findings; leave them out.

Write `<name>.runs/inspect.md` next to the blueprint (create the directory), replacing any earlier one. List one finding per item with the criterion or boundary ID. After the findings, list the realistic inputs you ran, the ratchet numbers, one line `Process rules applied: <IDs or none>` (the heading slugs of the `process-inspect.md` rules you applied), then what you couldn't verify and why. Write `None.` when there are no findings. Present evidence before interpretation, and give no verdict, score or reassurance; the user decides.

## Return

Reply with one JSON object in a `json` code block and nothing else: `status`, `blueprint_path`, `changed_files` (empty, you change nothing), `blocking_issue`, `evidence_excerpts` (the test command with its counts, the coverage result), `findings_file`, `findings` (the number), `ratchet` (`{ "added", "removed", "test_lines_removed", "copied_blocks", "interface_changes_outside_boundaries", "single_caller_functions" }`) and `proposed_criteria`. When the scope is missing, say what you need in `blocking_issue`.
