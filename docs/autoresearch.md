# Autoresearch: measuring the minime flow

The record of the benchmark that drives minime's flow changes: what was run, what it showed, what is decided and how to continue. The experiment itself lives in `minime-workspace/swe/` on the author's machine, excluded from git through `.git/info/exclude`, because it holds 21 GB of repository clones, worker homes and run logs. This page is the versioned state; paths below are relative to that workspace unless they start with `docs/`, `conductor/` or `skills/`.

State on 2026-11-05: rounds 4, 6, 7 and 8 done (round 5, the public pool, is built and not run). The source is committed and pushed as 0.7.0b (`12c4fa0`: read side, decision-ID repeat cap, one build per blueprint) and carries, uncommitted, round 8's winner: the guard allows `git restore -- <paths>` of files under a test directory that a test run rewrote, and denies every other restore. Suites: conductor 161, blueprint 192, extract 106, hooks 68. A public pool of 26 SWE-bench Pro V2 and Multi-SWE-bench flash tasks is built and its images pulled (`ROUND5.md`), not yet checked or run.

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
| 8 | 2026-11-05 | v7li control (the source as committed, 6de79a7), v7lj (the guard allows `git restore -- <paths>` of files under a test directory, worktree and HEAD only; one sentence each in the replicate preflight, the inspect test run and the README) | 7 of 9 against 5 of 9 by majority, no control task lost, 6.1 requests per run in both arms, 22 against 15 single runs. No candidate run blocked on the trap, four control runs did; 33 candidate restores, every path under a tests directory, none denied. Four predictions held, one missed (sdk-wire cost 4.0 against 3.0). The control fell two tasks from round 7 (pool noise). Applied to the source. |
| 7 | 2026-11-04 | v7lh control (the source after round 6), v7li (one build per blueprint: groups, waves and child blueprints removed, the size goal a warning) | 7 of 9 against 6 of 9 by majority, no control task lost, 6.2 against 9.1 requests per run, no run at the limit against three, no group blocks against 24. alt-text-directive, lost 0 of 3 in round 6, is 3 of 3 with every verdict proven. Blueprints grow to 4.2 KB from 2.7 KB without inputs. All five predictions held. | v7li |
| 6 | 2026-11-04 | v7lg2 control (round-4 candidate plus the repeat cap keyed on open-decision IDs), v7lh (plus the read side: the conductor pastes the repository's wiki index and its run receipts into every blueprint dispatch; every run ends with a receipt line) | 6 of 9 by majority for both arms; v7lh gained one task and lost one to group fights on a first task with nothing pasted, so not won by the rule; 10.5 against 9.1 requests per run. The read side works as built: every later task of a repository cites the pages the earlier task's extract wrote (the control cites none), the receipts hand the test command forward, and the first run ever to resolve lane-labels-toggle was a citing candidate run. The decision-ID cap ended the ask loops at 2 to 3 requests in both arms (round 4: 58 to 77). | user's call |
| 4 | 2026-11-03 to 04 | v7lf control (the source after round 3), v7lg (fuel gauge: request, minute and repeat caps and a PAUSED file; verdict computed from the proof board, tree hash and ratchet; replicate preflight on untouched HEAD; guard hook) | 9 of the author's tasks, three runs per arm, majority: 7 of 9 for both arms. 11.9 against 14.1 requests per run, so the control wins by the rule; the gap is one task's ask loop (one decision asked 58 to 77 times per run in both arms) that the repeat cap never caught because it compared issue text. Verdict proven on three done runs the hidden tests failed; HEAD fails its own suite in three runs; no blueprint cites a topic page and later tasks of a repo cost more than the first. | none (the additions stay as instrumentation; the cap is fixed to key on decision IDs) |
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

## What round 4 showed

- Both arms resolve 7 of 9 of the author's tasks by majority; round 3 had 3 and 4 of 8 on the comparable set. The gain is the harness (readable instructions, a venv per run) and a stand-in user that stops a run on an ask without a recommendation, not a flow change. The two unresolved tasks fail for task reasons in every run of every arm (source paths that exist nowhere; hidden tests that pin a colour the request never names). Nine tasks separate nothing any more.
- The flow's status predicts nothing in either direction: 11 runs resolved while the flow said failed or stopped, 6 said done while the hidden tests fail. The computed verdict was unproven on 4 done runs the grade resolved and proven on 3 it failed: it measures the proof's shape, not the code.
- The ask loop is the cost sink: 80 and 181 asks answered per arm, 76 on one decision in one run. A cap keyed on the decision ID ends such a run after the second pass; an exact-text cap never fires on a model that rewords.
- Preflight finds HEAD failing its own suite in a third of the repositories touched.
- Extract writes, blueprint does not read: 18 to 20 pages per sequence with evidence, 33 blueprints cite the one process page the skill names, none a topic page, and the second and third task of one repository cost more than the first in both arms. Round 6 closes that loop: the conductor pastes the repository's wiki index and its run receipts (one line per run: verdict, jobs per phase, cost, test command, stop cause) into every blueprint dispatch.
- Minutes are a host metric (load 100 to 400 through the night); only requests compare between arms run at the same time.

## What round 8 showed

- The trap was the guard, not the worker: given one allowed form, every candidate worker that met rewritten snapshots restored them by path (33 restores, none outside a tests directory, none denied) and no run blocked on it; four control runs did.
- The allowance did not cost accuracy or requests: 7 of 9 against 5 of 9 at 6.1 requests per run in both arms, with every resolved always_on_v2 run keeping its source edits.
- The pool's noise is about two tasks: the control, 7 of 9 in round 7 with the same arm, scored 5 of 9 here (circuithack to a worker-written end-to-end test that fails in the grader; rebase-own-edits to the trap and to a 19-job run). A one-task difference between arms says nothing.
- The verdict's next gap is the same files: a suite that rewrites tracked files after the last inspection leaves the verdict unproven ("the tree changed after the last inspection"), seen in the smoke; false success 11 against 9.

## What round 7 showed

- Groups were the authority failure: with one replicate job per blueprint the candidate had no block naming another group's file (the control had 24), resolved every alt-text run and spent a third fewer requests per run. The blueprint tool, the skill, the orchestration guide and the board lost about 230 lines for it.
- The read side carries over: every later task of a repository cites the wiki in both arms, and under one build the second always_on_v2 task cost 5.3 requests against 12.3.
- One file per blueprint costs size: mean 4.2 KB without inputs against 2.7 KB, one at 7.4 KB. The check warns; nothing measured suffers yet.
- The preflight trap is the next failure cause: a suite that regenerates tracked snapshot files, which the guard forbids the worker to restore, so the run blocks on an ask after one job (one candidate run, three control runs). The fix is mechanical: let the worker restore, by path under the test directories, the tracked files its own test run rewrote, or have the conductor do it.
- Two tasks stay task-level: pele-legend-once (hidden tests pin values the request never names; every run of every arm ends done and proven) and lane-labels-toggle (resolved only when the wiki has a page about the repository, 2 of 12 runs over two rounds).

## What round 6 showed

- The read side closes the loop mechanically: paste the repository's wiki index and run receipts into the blueprint prompt and the worker reads and cites them (a path in a nudge was never opened in three rounds). Citations do not make later tasks cheaper on their own: the cost of a repository's second and third task is set by ask loops, limit stops and group fights, not by what the blueprint knows.
- Groups are the remaining authority failure: all three candidate losses on alt-text-directive were replicate groups blocked on a test file owned by an unassigned boundary row; the control lost the same way once. One build per blueprint, decided on 2026-10-29 and still unbuilt, is the next change.
- A cap keyed on the decision ID works where a text cap did not: four stops, each after 2 or 3 requests, on the question earlier rounds asked 60 to 76 times.
- The verdict stays a proof-shape measure: done-and-proven runs that fail the hidden tests exist in both arms (pele-legend-once), and runs stopped on an ask or at the limit resolve the hidden tests anyway (6 and 7 per arm).

## Additions (2026-11-03)

From the harness and self-improvement survey in `research/harness-trends-2026-11-03/README.md`, applied to the method:

- Cost is a score. The round table carries premium requests and worker minutes per arm beside the resolve count; at an equal majority count the cheaper arm wins. Nine tasks cannot separate accuracy by a few points (the interval at 80 tasks is about ±9); they can separate cost.
- Every variant predicts. Before its round, a variant's spec names the pool tasks it expects to flip and why; the table marks each prediction held or missed. A variant whose misses outnumber its hits is not applied, whatever its total.
- The conductor now computes a verdict from the proof board (`verdict` in the run file: proven, or the gaps) and stops on a budget (`--requests`, `--minutes`, `--repeats`). The kit grades by hidden tests as before; the verdict is a second column to compare against them, since the flow's own status predicted nothing in round 3.

## How to continue

1. Round 5, the public pool (`ROUND5.md`): commit the round 8 winner first so both arms start from it, `./kit/public_check.sh` once, then `nohup ./kit/round.sh public <control> <candidate> > seq/round5.log 2>&1 &`; expect 10 to 15 hours and about 1500 premium requests under amd64 emulation. The candidate for it: the verdict's proof-shape gap (a tree that changes after the last inspection because a suite rewrote tracked files; the conductor could compare the hash with those paths excluded when the receipt names them, or inspect restores them before it reports).
2. The uncounted quart task ends on an ask without a recommendation in every candidate run: read the asks before the next round on `round4` and decide whether the blueprint skill should recommend by default.
3. Every round: predictions first, one mechanical change, the majority table, the decision by the rule in `kit/README.md`, the record here. `minime-workspace/swe/RALPH.md` holds the loop's rules, backlog and state.

Rules that keep the measurement honest, from `kit/README.md`: workers never see `hidden/`; the wiki is bare, never the author's real one; project checkouts are cloned, never used; every run has its own venv or container; nothing stages or commits; never kill a conductor you did not start; pool tasks that ask for an outward action stay out.
