# Claude sessions, group C (minime, switch2jb, always-on-v2, small projects)

## 1. Numbers
- Sessions read: 169 (minime 8, switch2jb 138, always-on-v2 1, stop-slop 1, ahm-diagrammo 2, swift-vj 1, azure-ai-travel-agents 2, azure-monitor-lab 1, ps52jb 1, xbvr 1, Library scratch 13).
- Prompts: index says 911. Only ~146 were typed by the developer (~46 of them in one switch2jb hardware session). The rest: 137 scheduled-task runs, ~49+ subagent hand-backs injected as "Another Claude session sent a message", task-notifications, compaction summaries, 12 Stop-hook verdicts, 7 goal check-ins, skill expansions (skill-creator 480 lines, 9 times).
- Of the ~146 typed prompts (rough):
  - corrections: ~14
  - repeats of an earlier instruction: ~12
  - interrupts: 7 (minime 3, always-on 1, goal-session 2, xbvr 1)
  - verification asks ("verify", "real run", "all fixed?"): ~12
  - harness fights: ~22 (12 Stop-hook rejections, 2 app-quit, 2 cut-off responses, 1 safety-classifier stop, "unstuck yourself", blocked sleeps, zsh/node quirks, permission-denial loops)
  - status pings ("what did we learn", "how is it going"): 7
- minime has only ~40 real typed prompts across 4 weeks of work; the decisions live in AskUserQuestion answers and compaction summaries (quoted below via summaries).

## 2. Patterns

### P1. Agent stops early, user bolts on a /goal Stop hook with an unmeasurable condition (count ~16 events)
- "why did you stop?" (always-on-v2, 2026-10-24T18:38)
- Goal set 10 min later: "finish all leftovers and come with a coherent full ready new version. docuetation lean..." (always-on-v2, 2026-10-24T18:47). Evaluator rejected it 8 times until 2026-10-25T20:01 (~25 h), each time re-listing items the user had already deferred (Timeline refactor, Text.truncate), then user interrupted.
- "make 100% sure that claude will NEVER ever add any co-authored commit to ANYTHING" (Library scratch 987f61, 2026-10-24T19:53): 4 rejections ("100% can't be proven"), 2 user interrupts at 20:00 and 20:12.
- Different: definition of done as a checkable list ("tests green, branch merged, README lists X, list of deferred items in docs/NEXT_STEPS.md is accepted"), and deferrals recorded in a file the evaluator can see. Agent: do not end a turn with open "Still not tested" items without either doing them or writing them to a deferred list.

### P2. "Verify" must be a real run, said again and again (count ~9)
- "oh please! only do it with real Real Copilot rerun!" (minime/14ca8671, 2026-10-23T08:12)
- "ok, do real runs with copilto or give me the sintrcitions" (minime/14ca8671, 2026-10-23T09:21)
- "make sure all validation runs with copilot cli though" (minime/14de34aa, 2026-10-23T21:06)
- "use please real backend onad check it there, veriy and assess all my models" (always-on-v2, 2026-10-24T13:55)
- Different: the rule exists only in Claude memory (`real-copilot-only`). Copilot sessions never see it. Put it in the repo's AGENTS.md / assets/CLAUDE.md so both hosts read it, and in the first prompt as acceptance ("done = events.jsonl of a real run attached").

### P3. "Use sub-sessions to keep context small" restated in 6+ sessions (count 7)
- "make sure to use subsessions for not blow up the context" (minime/ea83451e, 2026-10-27T21:04)
- "use subsession to imprvoe the UX and how it overall looks" (always-on-v2, 2026-10-24T14:10)
- "If a session has close to a full context, check if you can tell it to maange work in multiple subsessions" (Library 277287, 2026-10-24T19:38)
- Different: global CLAUDE.md has "use subagents for search tasks" only. Add: "work longer than ~1 h or >3 phases: one subagent per phase, parent keeps only a ledger file; never inline the phase work".

### P4. "Lean / small / no prose" restated; artifacts keep growing (count ~8)
- "in the end I want minime the whole flow to be small and efficient again" (minime/14ca8671 ARGUMENTS, 2026-10-22T06:31)
- "the blueprint should have almost no prose. Clear factual statements, references and. values." (14ca8671, 2026-10-23T06:41)
- "ideally the overall minime flow should become faster and simpler. and more predictable" (14de34aa, 2026-10-23T12:24)
- "not with adding more and more, but adapting" (ea83451e, 2026-10-27T22:00); "keep minime light and fun. simple" (1e4491a2, 2026-11-03T10:52)
- Evidence of growth: blueprint reached ~21.6 KB (summary 10-22), 77-row LEDGER, tree/group/split machinery added in rounds 2 and 3, then removed on 10-29 because "process pages and trees changed no outcome".
- Different: size caps as mechanical checks (the blueprint 4 KB warn exists; extend to ORCHESTRATION, skills, board), and "every addition needs a measured gain or it is not merged" as a first-prompt constraint.

### P5. Constraint or scope arrives after the agent started (count ~7)
- "this is jsut a plan, now" (ea83451e, 2026-10-24T23:07), 77 s after the first ask. The tech constraint came next: "use a tehcnilogy that works in Claude and in the Github Copilot App, and also in claude cli and copilot cli" (via summary).
- "no, now I want you to use actual code and copilot or claude session from me Desktop/projects folder" (ea83451e, via summary, 10-29 ~01:00): rounds 1-2 used synthetic SWE-bench tasks.
- "I'm in a hotel" then, 12 days later, "I'm in my hpme wifi though" after an interrupt (xbvr, 10-08T17:48 / 10-20T20:54): agent carried a stale assumption.
- Different: first prompt states mode (plan vs build), host matrix (Claude Code, Copilot CLI, both apps), data source (real tasks) and project boundary.

### P6. Undefined stop rule for autoresearch; user must call the pin (count 3 rounds)
- "finish the work with a verified from a few common SWE benchmarks" (ea83451e, 2026-10-27T20:46): needed a grill-me round on "what to optimize for, hard criteria".
- Round 3 budget "You have 8 hours" (via summary); outcome v6 3/8, v7l 4/8, v7m 4/8, 6 of 11 tasks flipped between two runs of one arm.
- "how long will we get value out of the tests tou think? can we put a pin in soon, record the state and setup" (ea83451e, 2026-10-29T07:20)
- Different: pre-register noise floor, run count (3 per arm, decided only in round 4), and max budget before round 1.

### P7. Status pings during long autonomous runs (count 7)
- "so what did we improve so far?" (14de34aa, 10-24T06:56); "what did you learn so far?" (ea83451e, 10-28T20:13); "How is it going?" (10-28T22:10); "what the current status? what did we learn so far?" (10-29T06:36); "all fixed?" (always-on-v2, 10-24T22:53)
- Also agent output the user could not parse: "so what that it mean?" / "bad?" / "what would be a good signal?" (ea83451e, 10-28T09:24-09:26).
- Different: standing rule "long runs keep STATUS.md (done / running / next / numbers with units)"; ledger exists but the user still asked. Reports must end with one line: result in the user's terms, plus whether it is good or bad.

### P8. Branch rule conflicts with minime/own-repo practice (count ~6)
- "you can directly work on the main branch as well" (14ca8671, 10-22T07:07); "lets put it into main branch" (ahm-diagrammo, 10-23T21:33); "merge into main" (stop-slop, 10-23T22:50); "merge with main and we can be done, soon, right?" (always-on-v2, 10-25T15:54).
- Global CLAUDE.md says "Always work on branches"; always-on-v2 started with "work on the current branch" (main) and the agent produced `claude/health-models-tui-0-4-0` (a generated-style name), left 29 files uncommitted for hours.
- Different: per-repo CLAUDE.md line "branch policy: main OK / feature branch named X"; global rule gets "unless repo CLAUDE.md says otherwise".

### P9. Harness reminder beats the user's rule (co-author) (count 2 sessions, 4 rejections)
- Global CLAUDE.md already says "no Co-Authored-By"; always-on-v2 summary records "Latest system reminder: do NOT add attribution" yet user spent a session on it: "for all repos that are NOT github.com/abossard, we HAVE to try to amend the commit" (Library 987f61, 10-24T19:53).
- Different: a commit-msg / PreToolUse hook (the session built one, 13/13 tests, only covers Bash and mcp__). Keep it, and add it to a global settings file, not a session.

### P10. Single-caller functions and over-engineering restated across projects (count 3)
- "get rid of all functions that are only called from one place" (ahm-diagrammo, 10-23T19:29)
- "not e.g. lots of functiln just called from one place, right." (minime/14de34aa, 10-23T21:06)
- "be gentle with changes. Priority is ease of use und simple code and good ousterhout design" (always-on-v2, via summary)
- Different: global APOSD line is too abstract. Concrete rule: "after editing, list helpers with exactly one call site and inline them unless they hide a decision". minime's `blueprint.mjs diff` ratchet already flags it; wire it as a hook for all repos.

### P11. Scope creep / undoing things the user decided (count ~6)
- Agent removed ORCHESTRATION.md "against user's earlier strong preference", dropped dr-evil `memory/initialPrompt` accidentally, `git rm` staged deletions (14ca8671 summary errors).
- Reversal by user: "yes, inspector should probe!" (10-23T09:21) then "I don't want inspect to breaks lines or delete stuff" (14de34aa, 10-23T21:06).
- "not sure. meaybe that's a bad idea. I don't want the cache." (always-on-v2, 10-24T11:51); "no, bar height should be signal level, color should show severity" (10-24T14:30).
- Different: ask-before-delete for files that a previous decision created; run the "decisions so far" list (memory file) before removing anything.

### P12. Harness fights (count ~14)
- "The app was quit while you were working. Please continue from where you left off." (14de34aa, 10-23T17:02 and 19:18); two "[Request interrupted by user for tool use]" at 14:55 and 17:03 after an unattended 2.5 h run.
- "Your response above was cut off mid-stream. Resume directly" (14ca8671, 10-23T09:45, 10:16); "unstuck yourself" (10-23T06:38).
- Safety classifier stop on a PS5 repo clone request (ps52jb, 10-29T23:09); never retried, switch2jb clone request phrased neutrally worked the same week.
- Viewer opened on localhost; foreground sleeps blocked; `echo ====` failed in zsh; `node --test <dir>` breaks on Node 24; in-place rewrite of run.sh killed a running launch; 127 of 171 permission denials were one file (AGENTS.md outside readable dirs).

### P13. Hourly LLM sessions for a deterministic check (switch2jb, count 133 + 2 runs)
- Request: "can you check hourly for if there's a new switch 1 or 2 firmware and for the there's a new seedsow lua editor worth getting?" (switch2jb/e2ddb17c, 2026-10-28T14:03).
- Result: 133 sessions, byte-identical spec (only timestamp differs), 9/24/17/24/24/24/11 per day (10-28 to 11-03). Assistant turns per run: median 4, 17 runs with 1, 8 with 6-8, one outlier 11. No drift in the prompt; no user reply in any run. Cost is constant; value only on a firmware change, which is rare.
- Different: cron + curl/gh/jq with the existing state file; invoke the agent only when state changed or the fetch fails. Daily instead of hourly (firmware cadence is weeks).

### P14. Babysitter loops cover the user's absence (count 3)
- "if a session jsut stops, but not all work is done, tellit to do the reimaing work" (Library 277287, 2026-10-24T19:38): 30-min cron to 08:00 (~25 wakeups); "no we can use fable up 100%" (22:55) because the watcher restricted the model. "Try again" with no diagnosis appears twice (ahm-diagrammo 10-23T19:25, Library b5ca1b 10-03T20:29).
- Different: workers write ASK.md or notify; the answering policy lives in a rules file, not re-typed in each cron.

## 3. Standing-instruction candidates
- Real-run verification. Evidence: P2 quotes (4 sessions). Home: repo AGENTS.md of minime plus a hook that refuses "verified" without an events.jsonl path. Memory only is invisible to Copilot.
- Sub-sessions for long work. Evidence: P3 (7). Home: global CLAUDE.md.
- Lean by default, mechanical size caps. Evidence: P4 (8). Home: minime AGENTS.md plus lint checks for ORCHESTRATION and skills.
- Branch policy per repo. Evidence: P8 (6). Home: per-repo CLAUDE.md; amend global line.
- No AI attribution in commits. Evidence: global CLAUDE.md, Library 987f61. Home: commit-msg hook in global settings (the session-built one).
- Local servers on 127.0.0.1, `BROWSER=true`. Evidence: 14ca8671 10-22T07:20. Home: project CLAUDE.md (currently memory only).
- Single-caller helpers get inlined. Evidence: P10 (3 projects). Home: global rule with a concrete check.
- Goal/stop-hook template: condition must be a checkable list plus an explicit "deferred" file. Evidence: P1. Home: a snippet in global CLAUDE.md.
- Scheduled tasks run a script first; the LLM only on change. Evidence: P13. Home: scheduled-task authoring skill.
- Gotchas block for each repo: 127.0.0.1 + BROWSER=true, no foreground sleep, node --test glob, atomic edits to running scripts.
- Release checklist: "bumpt he version" (14de34aa 10-23T21:50), "bump version, commit and push please" (ea83451e 10-29T14:01); explicit ask overrides the no-commit memory.

## 4. Prompting-template candidates
Smooth sessions had:
- A named end state and a single entry point: ahm-diagrammo "combine both approaches... single usage point or point of entry for both" (10-23T11:19).
- A minimum viable scope plus a count limit: azure-ai-travel-agents "smallest required change... ONE health model please. not all 4" and "ready as possible to... make an official PR" (10-29T06:20), then "Push + draft PR".
- A source URL, scope and tone: azure-monitor-lab "learn from /healthmodel-plan... run the full implementation to azure... end to end. be friendly and cool" (11-02T11:35), then a review plan "multiple copilot CLI and strong models with max reasoning" and "Apply all".
- minime 10-22: "ask me what are the important cornerstones and values". This produced the confirmed cornerstones in one round with AskUserQuestion; best first prompt of the week.

Rough sessions lacked:
- Acceptance and boundaries: always-on-v2 "do a code-review, simplification and verify it" had no read-only vs write rule for live Azure (surfaced 4 h later: "test it against my subscription") and no cache/timeout stance.
- Mode: plan vs build (ea83451e 10-24).
- Hard criteria for research: "verified from a few common SWE benchmarks" (needed grill-me).


Suggested skeleton: Goal / Mode (plan|build) / Hosts / Allowed side effects / Done when (runnable check) / Stop rule (budget, noise) / Do-not list.

## 5. minime flow decisions made in chat this week
Quotes are user words; "(summary)" = recovered from compaction summary or memory file because the AskUserQuestion answers are not in the prompt logs.

Blueprint
- 10-22T06:31: "transform prompts and ideas into criteria, creaate a test and boundary design / decide unknowns with data and research and only ask theuser of something can't be decided / that's the blueprint / and then all work run against the blueprint and can be verified".
- 10-22 (summary): "this has nothing todo with healthmodels now. no, it should coome drom data/researh/user and research can also mean looking into the minime wiki". Confirmed blueprint holds: verbatim inputs, criteria, boundaries, decisions, constraints, out of scope.
- 10-23T06:41: "the blueprint should have almost no prose... forget the whole tests stuff in the blueprint... Tests are in code, that's it." (replaced Tests section.)
- 10-23T09:21: criteria must come from user prompts ("exactly the use rprompts shuold flow into meaningful criteria").
- 10-23T21:06 (numbered answers): "turn assumtopn into predicions"; "I'm fine with the evidence ladder"; "record as default"; "bug is with repoducition, feature with thinnest end to end slice"; size "not a hard limit... more like warning" (memory).
- 10-24T23:05: boundary check should be "highly visual... interactive sequence diagrams, and UML style diagrams", then web-server tech so it works in Claude, Copilot app and both CLIs (summary). Became `## Flows` and an editable board.
- 10-29 v8 (memory): blueprint is one build; groups, waves, children and splits go; size goal is a warning; modularity lives in Boundaries rows.

Replicate / inspect
- 10-23T09:21: "yes, inspector should probe! not sure it should make scratch copies though", reversed 10-23T21:06: "I don't want inspect to breaks lines or delete stuff. Inspect should verify the TEXT of the blueprint with what's implement"; "ratchet on the diff, is good"; "Frau or Rubberduck should [produce] failing tests, property failure or general deviation from the criteria".
- 10-23T21:06: "I don't want a harness as script, in the end, code is the code."
- 10-29 v8 (memory): authority order stays: repo instructions, existing tests and `unchanged` rows outrank the request; `testLinesRemoved` only on test source; a blocked inspect with no changed files is not a pass.

Conductor / board
- 10-23T21:06: wants the conductor visual ("would it be possible to make that also a bi visual to control? but the names should stay: blueprint, replicate, inspect and extract").
- 10-23T22:36: "make the canvas and the claude mjs thingy compatible? or based on the same code? ... have the ditor removed" (now `startBoard()` shared by CLI and canvas).
- 10-29 v8 (memory): "an open bracket with a medium or high recommendation is applied as a default"; conductor asks once, ends run as blocked when the same issue returns. "defaults instead of asks".

Dispatcher / orchestration
- 10-22: Dr. Evil pure dispatcher; ORCHESTRATION.md "small file for dr-evil only" (AskUserQuestion answer, summary); autopilot orchestration stays.
- 10-27T22:00: "should not be any real static process, but a good starting point and per project, the process adapts and reflects and learns from mistakes, but also keeps itself lean... in the same project, multiple flows establish depending on the task".
- 10-28T09:53: graph-based loop: "dr evil doing a blueprint, but then Frau Agent sees opporunites to split and nest the blueprint... then they replicate and after larger chunks... extract is looking for lessions". 10-29 evidence killed it: process pages parked, README per-project adaptation claim removed (memory).

Extract / wiki
- 10-23 (memory): wiki receipts only, one-rule deltas, learn from red pen, retire unused pages. 10-22: boundary approval is per project ("it;s also fine to go on and later refactor it"). Never point extract at real ~/.minime.
- 10-22T07:37: "about the extract and llm wiki, can you analize that for best practices as well?"

Evals
- 10-22: "do research and aubagents with a cheaper model than opus please"; real Copilot only (P2); worktree-based real task (qlcplus audio BPM) with hidden tests.
- 10-27: "finish the work with a verified from a few common SWE benchmarks"; grill-me answers (summary): resolve rate on hidden FAIL_TO_PASS and PASS_TO_PASS, two runs both pass, dev/holdout, apply to source, stop after three variants without gain.
- 10-29 round 3: "use actual code and copilot or claude session from me Desktop/projects folder, to recreate tasks"; round 4 (memory): three runs per arm, majority, 9 scored tasks, authority lane uncounted, rgbw dropped (its prompt ran `gh repo fork` on the real account); conductor denies GitHub writes.
- 10-29T07:20: "put a pin in soon, record the state and setup, maybe make a script harness to run it in copilot cli as well. and then update the code in main from minime, no stage or commit"; 10-29T10:52: "make sure the repo contains the current autoresearch state, what has been done and how to continue" (-> docs/autoresearch.md, one state page chosen over committing the kit).
- 10-29T14:01: "bump version, commit and push please" (explicit exception to no-commit).

Open at the end of the week (11-03)
- "research on latest agent harness and self improving skills... what could be added to the minime-flow. Important: we wan to keep minime light and fun. simple and made for strong agents." (1e4491a2, 10:52)
- "analyze past copilot and claude sessions from this week... give it to the other session in virtucon and coordinate how to implement and test the improvements" (this task, 10:53).
- "address the Dependabot" (ea83451e, 10:49): the working tree still has uncommitted package.json/lock changes.
