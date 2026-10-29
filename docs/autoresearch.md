# Autoresearch: measuring the minime flow

The record of the benchmark that drives minime's flow changes: what was run, what it showed, what is decided and how to continue. The experiment itself lives in `minime-workspace/swe/` on the author's machine, excluded from git through `.git/info/exclude`, because it holds 21 GB of repository clones, worker homes and run logs. This page is the versioned state; paths below are relative to that workspace unless they start with `docs/`, `conductor/` or `skills/`.

State on 2026-10-29: three rounds done, round 3 pinned at 08:22, no sequence running. The source carries the round-3 winner (v7l, the lean blueprint) uncommitted, plus three conductor fixes made the same day (a sign-off line after a bare JSON reply, object-valued proposed criteria, GitHub write commands denied). Suites: blueprint 201, conductor 152, extract 58. The `conductor/` directory is untracked.

## Method

- An arm is a full copy of the plugin under `variants/<arm>`. The kit (`kit/`, documented in `kit/README.md`) runs every pool task through the conductor with real Copilot CLI workers on a copy-on-write clone of the base repository, then grades by hidden tests the workers never see: a task resolves when the gold commit's tests pass and the project's own suite stays green. Workers may read only the repository, the sequence's bare wiki and the plugin.
- A sequence is one arm over the pool in a fixed order with one shared wiki, so lessons could carry over. Two runs per arm so far; a task counted when both runs resolved it. The winner by the pre-registered rule is applied to the source uncommitted with `kit/apply.sh <arm>`.
- Pools: rounds 1 and 2 used SWE-bench Verified (django as the dev sequence, sympy as the holdout, caddy). Round 3 used 13 changes the author made in 2026 in eight of their own public projects, each as the original Copilot or Claude prompt (or the commit message) with the tests the change added as hidden tests, graded by command; one appended `Interface:` line where the tests use names the prompt lacks (`ROUND3.md`).
- Records: `RESULTS.md` (tables and verdicts per round), `LEDGER.md` (one row per sub-session, 77 so far), `v5-SPEC.md` to `v8-SPEC.md` (builder briefs per variant).

## Rounds

| Round | Date | Arms | Outcome | Applied |
|---|---|---|---|---|
| 1 | 2026-10-27 to 28 | v0 to v4 | dev 4/4 in both runs (v0 2/4), holdout 4/5 (v0 3/5). The gains came from bounded loops (v1) and existing tests as a contract with a mechanical removed-line count (v4). | v4 |
| 2 | 2026-10-28 | v4s, v5 (blueprint tree, text review), v6 (test-removal ask, shape-named process rules) | dev 10/10 in both runs (v4s 9/10), holdout 6/10 (same as v4s). One task moved, through the test-removal ask. The tree split once in 40 runs; process rules were written and cited but changed no outcome. | v6 |
| 3 | 2026-10-29 | v6 control, v7l lean (three sections, inline evidence brackets, no review, JSON-only replies), v7m modular (one child blueprint per module) | On the 8 tasks every arm ran twice: v6 3/8, v7l 4/8, v7m 4/8. Single runs v6 14/22, v7l 12/19, v7m 12/19. Plans 4645 / 2729 / 4857 bytes without inputs, 14.9 / 18.3 / 21.5 requests per run. Accuracy did not separate the arms; v7l applied for the minimal-plan goal at the lower cost. | v7l |

## What round 3 showed

- Run-to-run variance exceeds any arm difference: 6 of 11 tasks flip between the two runs of one arm. Two runs cannot separate arms that differ by one or two tasks.
- Every unresolved run is an authority failure, never a code failure: a group not allowed to touch the file it needs, a helper owned by another group that does not exist yet, the repository's own instructions ranked above the request, a denied `git restore` or file read. No run removed a test line.
- Three tasks fail in every arm and run for one reason each: python-quart-vite-react suggest-schema (the repository's copilot-instructions forbid touching endpoints and tests), healthmodels-plus monitor-namespace (the existing-tests rule keeps assertions the request renames, and the test question's recommended `keep` seals it), wled-simulator ddp-late-packet-window (an `unchanged` caller row keeps a pointer signature the request pins by value). The author's own sessions made all three changes.
- Groups and children build consumers before the helper they depend on (ahm-for-k8s in run 2 of every arm). The wave rule exists as text; nothing checks it.
- The flow's own status is a poor predictor: 13 runs resolved while the flow ended failed or stopped, 8 ended done while the hidden tests fail, one done had an empty diff.
- 320 asks were answered with the recommendation by the harness; the lean format asks most because every open bracket blocks; one run asked 60 times for an Azure target it could not have.
- Process pages changed nothing measurable: 8 to 11 generic rules per sequence, no decision cited one.
- The harness decided outcomes too: the recommendation policy settled three tasks, a shared venv broke one grade (regraded), the custom-instructions file was unreadable to workers, stopped runs were graded mid-edit, the learn pass resumed failed trees, and the rgbw-support prompt's `gh repo fork` reached the author's real GitHub (nothing changed; the conductor now denies GitHub writes).
- The lean format met its output goal mechanically: 151 of 152 final replies were one JSON block, no inspect before the first build; every root still exceeds the 2 KB goal.

The full list with numbers: `RESULTS.md`, Round 3.

## Decisions (2026-10-29)

Grilled and confirmed by the author; written as `v8-SPEC.md`, not built.

v8, the next variant:

- One build per blueprint. Groups, waves, children and splits leave the skill, the orchestration text and the conductor; the size goal stays a warning; modularity lives in the Boundaries rows.
- An open bracket with a recommendation of medium or high confidence is applied as a default and listed in the reply's open decisions without blocking; the worker blocks only without a recommendation or at low confidence. The conductor asks once on a blocked pass and ends the run as blocked when the same blocking issue returns.
- Process pages parked: extract's Process section, blueprint's citation rule, `processCited`, the wiki-lint checks and the README's per-project adaptation claim go; `learn` stays and writes topic pages only.
- Defect fixes: `testLinesRemoved` counts test source only (regenerated snapshot files under `tests/` are not assertions); a blocked inspect with no changed files is not a pass; the learn pass extracts and stops.

Kept as is, by decision:

- The authority order: repository instructions, existing tests and `unchanged` rows keep outranking the request. The three tasks above stay unresolvable by design and become a behaviour check (below).

Round 4 harness:

- Three runs per arm; a task counts when 2 of 3 runs resolve it. Control: the source as applied today, snapshot `variants/v7lf`.
- Pool: the round-3 main pool minus suggest-schema and monitor-namespace, 9 scored tasks (`kit/pools/round3.main`). Authority lane, uncounted: suggest-schema, monitor-namespace, ddp-late-packet-window; the check is that each ends as blocked within three blueprint passes. rgbw-support dropped (outward action).
- An ask without a recommendation ends the run as blocked and counts unresolved. A stopped run is graded after its conductor exits.
- Decision rule: v8 wins when its majority count on the 9 tasks is at least the control's and no task the control resolves by majority fails under v8 by majority; the winner is applied uncommitted.

Rejected: the request outranking repository instructions and the existing-tests rule; dependency-ordered groups and children; mining replacement tasks before round 4; a benchmark kit committed to this repository (it stays local).

## How to continue

1. Kit, about 30 lines, none done yet: `kit/round.sh` takes the run count (r1 to r3); `kit/round3_table.py` counts a majority and takes an uncounted list; `kit/watch.py` stops a run on an ask without a recommendation instead of answering it, and grades after the conductor has exited; `kit/pools/round4.main` (9 tasks) and `round4.authority` (3). The venv clone and the HQ-hosted instructions in `run.sh` are tested in isolation only: run one task first.
2. Build v8 from `v8-SPEC.md` in `variants/v8`, starting from a copy of the source as applied (not from `variants/v7l`, which lacks the three conductor fixes); snapshot the same source as `variants/v7lf` for the control. Suites green. A reviewer sub-session checks the variant against the spec, as ledger rows 43 and 60 did for v6 and v7l.
3. Smoke one task per arm through the kit, remove `seq/STOP`, then `nohup ./kit/round.sh round4 v7lf v8 > seq/round4.log 2>&1 &`. Expect 5 to 8 hours for 12 tasks, two arms, three runs on a loaded host. Pin with `date > seq/STOP`.
4. Table: `python3 kit/round3_table.py --arms v7lf,v8 --runs r1,r2,r3`. Apply the winner with `./kit/apply.sh <arm>`; record in `RESULTS.md`, `LEDGER.md` and this page.

Rules that keep the measurement honest, from `kit/README.md`: workers never see `hidden/`; the wiki is bare, never the author's real one; project checkouts are cloned, never used; every run has its own venv; nothing stages or commits; never kill a conductor you did not start; pool tasks that ask for an outward action stay out.
