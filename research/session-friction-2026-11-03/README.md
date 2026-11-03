# Session friction evidence, 2026-10-27 to 2026-11-03

What this week's Claude Code and Copilot CLI sessions show about where work slowed down, what the developer had to say more than once, and which of those are mechanical. Read against the proposal in `research/harness-trends-2026-11-03/README.md`. This folder holds evidence and a coordination plan, not an implementation.

## Method

- Claude Code: every `~/.claude/projects/*/*.jsonl` main transcript modified since 2026-10-27 (270 files, 468 subagent transcripts beside them). Extracted: every user turn that is text (not a tool result), timestamps, `system` events (stop-hook verdicts, api errors, compaction boundaries), per-turn token usage, tool-result strings that mark a permission denial.
- Copilot CLI: every `~/.copilot/session-state/*/events.jsonl` modified since 2026-10-27 and larger than 200 KB (328 sessions). Extracted: `user.message` with its `source` (typed, autopilot, system, or another agent steering), `session.error`, `session.compaction_start`, `session.usage_record`.
- Reading: five Sonnet subagents read the prompt dumps in groups and wrote the four per-group reports in this folder. Assistant text was not in the dumps; corrections are inferred from user text and compaction summaries. Quotes keep the original typos.
- Native tools run: `copilot instruction list`, `copilot skill list`, `copilot -p "/chronicle improve"` (output below). Not run: Claude Code `/skill-doctor` and `claude plugin eval` (no `claude` binary on PATH outside the desktop app), `/fewer-permission-prompts` (it writes settings; the denial count below covers its input).

## Numbers

| Measure | Claude Code | Copilot CLI |
|---|---|---|
| Sessions touched this week | 270 main transcripts | 328 sessions |
| Assistant turns / model calls | 53,459 turns | 37,562 usage records (27,455 agent-initiated, 6,282 user, 3,825 sub-agent) |
| Tokens | 17.5 G cache read, 291 M cache write, 68 M output | top models gpt-6.1-terra 16.8 k calls, gpt-6.1-sol 16.4 k, claude-sonnet-5 1.4 k |
| User turns in logs | 4,408 lines, of which roughly 700 typed by the developer; the rest are task notifications, subagent hand-backs, stop-hook verdicts, scheduled runs | 10,015 lines, of which about 60 typed at top level; 1,104 + 880 + 571 + 472 + 454 are one agent steering another in foundry-aio alone |
| Stop-hook verdicts (`/goal`) | 3,262 (659 in one healthmodels-plus session, 250 and 182 in two portal-test sessions, 142 in one mcp session) | n/a |
| Compactions | 42 boundaries | 28 in one foundry-aio session, 24 and 10 in two others |
| API errors | 238 | 29 in the Session monitor routine |
| Permission denials in tool results | 125 (127 of 171 denials in one session were one file outside the readable dirs) | 10 repeated `ask_user` on an already granted scope; 6 of 15 asks in one session for read-only or mocked runs |
| Agent-to-agent steering | 110 cross-session messages in cxe repos | 6,747 in foundry-aio (1,533 from the coordinator, 734 content-free "finished processing"), 933 elsewhere |
| Scheduled LLM runs | 133 hourly switch2jb firmware checks, byte-identical prompt, no change found | Session monitor: 1,075 turns, 6,508 tool calls over 20-minute wakeups |

Heaviest Claude projects by weighted tokens (in 1x, cache read 0.1x, cache write 2x, output 5x): qlcplus 841 M, cxe/mcp 426 M, portal tests 342 M, minime 246 M, healthmodels-plus 121 M.

## Findings that cut across projects and hosts

Each finding names the per-group report (A = healthmodels-plus and qlcplus, B = cxe work repos, C = minime and the rest, D = Copilot foundry-aio, E = Copilot other) and the proposal item in `harness-trends` it bears on.

### 1. "Done" was reported, not computed, and the goal hook spun on it

- One `/goal` ("fully committed and pushed, well documented, releases, fully checked commands") fired 632 times in two hours after the permission classifier denied the merge twice; the user merged by hand (A P1).
- A goal with "continuously find more improvements" produced 23 identical verdicts in 7 hours; the user asked "So….its not better?" (B P11).
- "finish all leftovers and come with a coherent full ready new version" was rejected 8 times over 25 hours, each time re-listing items the user had already deferred (C P1).
- "make 100% sure that claude will NEVER ever add any co-authored commit": 4 rejections because "100% can't be proven" (C P1).
- 22 verification asks in A ("so is everything commiteed?", "did you update the screenshots as well?"), 25 in B ("work and fix it please" + pasted log, "run it against a REAL model."), 12 in C ("only do it with real Real Copilot rerun!").
- Bears on proposal 2 (done is computed from the proof board) and 3 (baseline run first). Session-level corollary: a goal must be a checkable list plus a deferred file the evaluator can read, with a fire cap.

### 2. Rules restated across sessions because they live in one host's memory or in chat

Counted restatements this week, with the home they lack:

| Rule | Times | Where it was said | Where it should live |
|---|---|---|---|
| No stage, commit, push unless asked | ~16 | A P9, B P1 ("no commits, never"), C ("bump version, commit and push please" as the explicit exception) | PreToolUse hook denying `git add/commit/push`, per-repo override line |
| Verification = a real run, never a summary | ~13 | C P2 (4 sessions), B P8, A P3 | repo AGENTS.md read by both hosts; today only Claude memory `real-copilot-only` |
| Use sub-sessions to protect context | ~16 | A P7 (9), C P3 (7) | global CLAUDE.md rule with a trigger (work over 1 h or 3 phases) |
| No sleeps or polling; Playwright auto-wait | ~6 | B P2 ("never sleep!!!! make it an eslint policy") | eslint rule + AGENTS.md in the test package |
| Tests act like a user (no URL blade open, no `focus()`, no viewport) | ~6 | B P3 | AGENTS.md "test philosophy" at session 1 |
| No slop comments, no semicolon chains | ~7 | B P4 | CLAUDE.md code-comment section |
| Inline single-caller helpers | ~6 | A P7, C P10 (3 projects) | concrete check; minime's `blueprint.mjs diff` already flags it |
| Lean, small, no prose | ~8 | C P4 | mechanical size caps on ORCHESTRATION, skills, board |
| Playwright MCP on Edge, not the built-in browser | ~4 | A P12, B P13 | repo CLAUDE.md |
| Upstream compatibility, MANUAL_REVIEW.md | ~8 | A P7 | qlcplus CLAUDE.md |
| Branch policy (main OK here, feature branch there) | ~6 | C P8, A P9 | per-repo line; global "always branches" gets "unless repo says otherwise" |
| No AI attribution | 4 rejections + commits that carried it anyway | A P9, C P9 | commit-msg hook in global settings (a session built one, 13 tests, not installed) |

Bears on proposal 4 (reading verifies) and on the "red pen" source for extract: user corrections are the highest-value signal and they are sitting in the logs. `/chronicle improve` is the Copilot-side list; nothing equivalent reads Claude logs.

### 3. Constraints arrived after the agent had started

- "this is jsut a plan, now" 77 seconds after the first ask; "no, now I want you to use actual code ... from my Desktop/projects folder" after two rounds on synthetic SWE-bench (C P5).
- AOT-compatibility and "only this BRANCH" came after a rewrite and a repo-wide edit (B P5, B §4).
- Deliverables in slices: README screenshots, badges, report location over 5 follow-ups (A P8); test report asked for in three steps (A P8).
- Domain concept iterated 9 rounds in 2 days instead of one worked example in the spec (B P12).
- Bears on the blueprint's Inputs and Criteria: the smooth first prompts of the week (B §4 PORTAL 10-23, C §4 minime 10-22 "ask me what are the important cornerstones") carried goal, mode, deliverables, exclusions, done-check and process. A prompt skeleton is the cheapest intake form for the blueprint.

### 4. Wrong beliefs formed early and held

- "I dont really believe you, to be honest. I suspect it might be something else" (B P7, the first root-cause theory was wrong; the user supplied `trace.zip`).
- "you are so inaccurate and full of assumptions" and "what other weird assumptions did you add?" (A P6); a README troubleshooting note disproved by the real environment.
- "I'm in a hotel" carried as a stale assumption 12 days later (C P5).
- Bears on proposal 3 (baseline run first) and on labelling `ran:` vs `inferred` in the blueprint, which the lean format already does with evidence brackets.

### 5. Long autonomous runs degraded and the user noticed first

- "since this session context if overfull, dump the open tasks into a graph based plan" (A P11); 17 compaction continuations; "Scratchpad wiped at session restart".
- Status pings: 9 in B ("whats the status?" x4), 7 in C ("what did you learn so far?"), 7 in A.
- Agent ended turns waiting on timers or siblings; 2.5 h unattended run ended by two interrupts and an app quit (C P12).
- Bears on proposal 1 (fuel gauge) and on a STATUS line rule: long runs keep done / running / next / numbers with units in a file.

### 6. Parallel sessions collided and the user coordinated by hand

- The same prompt pasted into three qlcplus sessions, three reviews of the same series (A P10); shared Edge profile and test-results between siblings (B P10); "can you stop all tests, so I can run them?"; version-bump collision avoided only by a peer message.
- Bears on the conductor owning the plan and a branch-ownership table; sessions that write go one at a time per file set.

### 7. Deterministic checks ran through an LLM on a timer

- 133 hourly firmware checks with a byte-identical prompt, median 4 assistant turns each, no change found all week (C P13); Session monitor 1,075 turns and 29 errors (E).
- Different: cron + script with a state file; the agent only when state changed or the fetch failed.

### 8. Harness fights that a preflight would catch

- Permission classifier denied `git restore` of test-churned SVGs, cmake, a Copilot review ("Create Unsafe Agents"); 127 denials on one unreadable AGENTS.md (A P2, C P12).
- App quits and cut-offs: "The app was quit while you were working" x2, "Your response above was cut off mid-stream" x5, "Try again" x11 with no diagnosis (A P5, B P13, C P12).
- Sideload server down three times; one Playwright worker vs many; `node --test <dir>` on Node 24; foreground sleeps blocked; a running script rewritten in place.
- Different: per-repo gotchas block and a preflight step in replicate (server up, single runner, tool availability) before any belief forms.

## Copilot-side findings

From `copilot-foundry-aio.md` (D: 57 sessions, 7,312 messages, 36 typed, 108 compactions) and `copilot-other.md` (E: 271 sessions, about 175 human-typed messages, 33 compactions).

- **The goal was blocked by the agents' own gates for four days.** foundry-aio: "why is the deployment blocked?" (10-31); the coordinator's answer: "We blocked deployment ourselves in azure.yaml; this is not a confirmed Azure outage." About 676 "blocked" mentions, 700 "freeze" mentions, 57 script files and 14.5 k lines in `scripts/`, one commit all week. On 11-03 the reset preflight was still refused by the checked-in hooks (D P1, P3, P4).
- **Mock evidence where real was asked.** "no syntehtic tests, real end to end tests please" came after 6 hours of replay and fixture work; 919 "synthetic" mentions (D P2). Same shape in E: "ok add such a test to the existing test, lets see if its really red" (E P8).
- **Stop was not authoritative.** "stop for a momeny" then "stop all sub sessions"; autopilot kept sending continuation prompts for 12 minutes until the mode was switched in the app; autopilot had run 29 hours (D P6).
- **Approval already granted, re-asked ten times.** "I give you all approvals to create health models on azure and to test and deploy" was followed by 10 `ask_user` prompts on the same model set over 3 hours, then 9 hours idle until the user typed "APPROVE" (E P1). The opposite failure too: "May I run the focused portal tests?" for a mocked test (E P2).
- **Steering traffic replaced a brief.** The coordinator wrote 1,533 steering messages; 66 relays of "do not stage, commit, push"; about 60 messages rebuilding provenance (commit, image revision, diff hash) by hand; 23 briefs hand-rewrote the same header block (D §3, E P4, P5).
- **Compaction thrash and archaeology.** The lead worker compacted every 30 to 60 minutes, 28 times; a Gemini reviewer compacted 5 times in 19 minutes because its brief said "read the whole prompt file"; recovery hunts pointed at line 3833 of the worker's own `events.jsonl` (D P11, E P11).
- **Late constraints retrofitted across workers.** Private endpoints, IP allowlist, "dependsOn on bicep is a massive code smell", "every file is its OWN deployment" arrived over 16 hours and caused a Bicep rewrite mid-flight (D P8).
- **Identifier leak nine hours before the privacy rule** (D P9); **unreadable glued-word reports** from a terse-reporting instruction that overshot (about 1,000 messages, D P13).
- **The Session monitor was dead for 11 days.** Its status tool vanished on 10-23; 357 of its next 370 turns said "Monitoring remains blocked"; this week alone 279 wakes and 822 model requests for nothing; it never reported its own outage (E §4). Useful before that: 13 resumes and 54 answered asks, 28 of them the recommended option.
- **Eval harness notes.** The healthmodel-skills jargon defect survived four generations as a grader-only finding; a delta was reported against a zero baseline; the deploy eval left a live model with Unhealthy and Unknown signals and no teardown (E P12, P13). Worker briefs themselves were adequate: zero blocked workers in the plan evals.
- **Scheduled QLC+ merge re-derived the same 15 known failures five days running** (E P14).

## `copilot /chronicle improve` output

Run in the minime checkout on 2026-11-03 (`copilot -p "/chronicle improve" --trust-folder -s`). It proposed three additions to `copilot-instructions.md` from the last 30 days and changed no file:

1. Act on redirects immediately. On 2026-10-26, "do evals … in clean and separate Copilot CLI sessions" first received more research. Proposed line: when the user switches from research to execution, stop expanding research and run the smallest relevant evaluation; report blockers explicitly.
2. Separate current code from historical evidence. The orchestration investigation needed repeated clarification about checkout, installed plugin and Claude-era capabilities. Proposed line: label capability evidence by source and version; historical results and installed plugins do not prove the current checkout works.
3. Refresh evaluation expectations before reuse. Historical blueprint rubrics included requirements superseded by later decisions. Proposed line: reuse historical fixtures only after reconciling their assertions with the current contract; run comparisons in fresh sessions with isolated repository and HQ state.

All three match findings 3 and 4 above (late redirects, stale beliefs). The tool reads one repository's Copilot history only, so it misses the cross-repo restatements in finding 2; that is the gap the red-pen harvester (improvement 2) fills.

## What this means for the harness-trends proposal

| Proposal item | Evidence this week | Verdict |
|---|---|---|
| 1 Fuel gauge | 3,262 stop-hook verdicts, 28 compactions in one Copilot session, status pings in every long run | Strongly supported; add a per-session cap on identical hook verdicts too |
| 2 Done is computed | 22 + 25 + 12 verification asks, four goal loops on unprovable conditions | Strongly supported; extend to `/goal`: condition = checkable list + deferred file |
| 3 Baseline run first | wrong first theories (B P7, A P6), sideload server down, flaky single-runner | Supported; make the preflight include environment checks, not only the test command |
| 4 Reading verifies | rules restated 16, 13, 16 times because memory is host-local | Supported, with a twist: the red pen is in the session logs; extract should read them |
| 5 Cost is a score | 73% of Copilot calls agent-initiated; 133 idle scheduled runs | Supported |
| 6 Every variant predicts | no direct evidence; the autoresearch rounds already lacked a pre-registered noise floor (C P6) | Supported |
| 7 One removal arm | "not with adding more and more, but adapting" x8 | Supported |
| 8 Reasoning sandwich arm | none this week | neutral |
| 9 Trigger check on Claude Code | skill expansions injected 9 times (skill-creator 480 lines) with no measured effect | Supported as the cheap Claude-only check |

## Improvements to implement and how to test each

Ordered by evidence weight and size. Each has a mechanical test so the measure does not depend on an LLM verdict.

1. **Goal and done contract.** `/goal` and the conductor's final status accept only a checkable list (commands with expected exit, files that must exist, a deferred-items file). A Stop hook stops after 2 identical verdicts and reports instead of re-running. Test: replay the four goal texts from this week through the parser; each is rejected with the missing piece named. Metric: stop-hook verdicts per session next week (baseline 3,262).
2. **Red-pen harvester for extract.** A script that reads this week's Claude and Copilot logs with the extraction used here (typed user turns, correction shapes, repeated rules) and emits candidate rules with receipts (quote, session, timestamp, count). Extract offers them to the wiki as one-rule deltas; `/chronicle improve` is the Copilot input. Test: the script run on this week's logs must find the 12 rules in finding 2 with their counts within 20%. Metric: restatements per rule next week.
3. **Rules readable by both hosts.** Move the rules in finding 2 from Claude memory and chat into repo files both hosts load (AGENTS.md or CLAUDE.md per repo, with the global line "unless the repo says otherwise"), plus two hooks: PreToolUse deny `git add|commit|push|gh pr create` unless a per-session allow file exists; commit-msg reject `Co-Authored-By: Claude` and "Generated with". Test: `copilot instruction list` and Claude's loaded-instructions both show the file; hook unit tests with the denied and allowed commands.
4. **Prompt skeleton as blueprint intake.** Goal / Mode (plan or build) / Hosts / Allowed side effects / Deliverables / Done when (runnable) / Stop rule (budget) / Do-not list. The blueprint skill maps each line to Inputs, Criteria or Boundaries; a missing Done line becomes an open bracket with a default. Test: the five smooth first prompts of the week parse into a blueprint that passes `check`; the five rough ones produce at least one open bracket each.
5. **Preflight in replicate.** Before the first edit: test command on HEAD, required local servers up, single runner, tool availability (browser MCP, sandbox). Return as `ran:` lines. Test: a fixture repo with the sideload server down must end the pass as blocked with the server named, not as a code failure.
6. **Fuel gauge** as proposed, plus `--identical-verdicts 2`. Test: a conductor run against a worker stub that always asks ends as `stopped: budget` at the cap.
7. **Scheduled tasks run a script first.** The switch2jb watch and the Session monitor become a script with a state file; the agent is called only on change or failure. Test: a week of runs produces zero LLM calls while state is unchanged.
8. **STATUS line for long runs.** Every run longer than one phase keeps `STATUS.md` with done / running / next / numbers with units, updated at each phase boundary; the board shows it. Test: the file exists and changed at every phase boundary in a conductor run.
9. **Scoped approval grant.** When the user grants a scope (subscription, resource group, resource type, "test and deploy from this repo"), the conductor records it and a worker's ask inside that scope is answered from the grant; only a wider scope asks again. Test: replay the 10 foundry health-model asks against the 10-27 grant; 10 of 10 answered without a prompt; one ask for a new resource group still prompts.
10. **Pause flag beats autopilot.** A `PAUSED` file in the HQ or run directory makes the conductor and any scheduled prompt return at once. Test: create the file during a run; no worker is dispatched until it is removed.
11. **Provenance in every hand-off.** Worker replies carry commit, diff hash and, where it applies, image revision; the conductor marks evidence stale when the tree hash moved. Test: edit a file after a worker reply; the board shows that reply's evidence as stale.
12. **Capability probe and circuit breaker.** Step 0 of a run probes shell, fetch, browser and session tools once and writes the result for all workers; any scheduled or monitoring run that reports "blocked" three times in a row writes one line to the user and stops. Test: remove the status tool from a monitor stub; it stops after the third wake.

### Agreed split (2026-11-03, with the harness-trends session)

Nothing starts until the user says go in either session.

- Harness-trends session, conductor and flow: 1 fuel gauge with the identical-verdicts cap as the same stop rule; 2 done computed from the proof board; 3 preflight in replicate (`ran:` lines, a down server ends the pass as blocked); 5 cost column and rule in `docs/autoresearch.md`; 6 predictions per variant; 11 in its smallest form (tree hash per worker reply, board marks evidence stale when the tree moved, no image revisions); the conductor side of 10 (a `PAUSED` file in the run directory stops dispatch). Tested through kit round 4 plus the stub tests above.
- This session, session level: 2 red-pen harvester, with the condition that every candidate rule carries the user's quote as its receipt so extract applies the wiki's existing bar unchanged; 3 rules readable by both hosts plus the two hooks; 7 script-first scheduled tasks; 12 circuit breaker; the scheduled-prompt side of 10.
- Left out of minime: 4 prompt skeleton (the lean blueprint already maps user messages verbatim to Inputs and defaults missing values; templates anchor the agent on their shape) and 8 STATUS.md (the board is the status for conductor runs, the per-phase todo for chat runs; a third copy drifts). Either may run as an arm, not a default.
- Deferred: 9 scoped grants, until round 4 shows how many asks survive the v8 defaults-instead-of-asks rule.

### Built on 2026-11-03 (this session's items)

- `hooks/guard.mjs` with `hooks/guard-rules.mjs`, registered in `hooks/hooks.json` for PreToolUse, UserPromptSubmit and Stop (the nested format both hosts already read for SessionStart). A `PAUSED` file in `VIRTUCON_HQ` denies every tool and blocks every prompt; the conductor's denied list (`git add/commit/push/...`, `gh pr create/...`) is denied in chat sessions too unless `MINIME_ALLOW_GIT=1` or an `allow-git` file younger than 8 hours exists in `VIRTUCON_HQ`; a commit carrying `Co-Authored-By: Claude` or `Generated with Claude` is denied even then. The circuit breaker keys on the session's first prompt: three identical final replies in a row trip it (`breaker/<key>.json`), the user gets one line, and further prompts (Claude) and tools (both hosts, by session) for that prompt are blocked until the file is deleted. 48 tests, including the hook end to end through stdin. The denied list is a copy of the one in `conductor/minime.mjs`; the conductor can import it from `hooks/guard-rules.mjs` once that file settles.
- `skills/extract/scripts/redpen.mjs`: the session red pen. Reads Claude Code and Copilot logs, keeps only the user's typed turns (Claude `turnOrigin`, Copilot `source`), counts 12 rule patterns with the quote as receipt, and lists the corrections no rule names. Wired as step 3 of the extract skill's Red pen and named in the session nudge. 48 tests. Measured on the live logs: since 2026-10-27, 498 typed turns and 7,663 steering messages; sub-sessions 25 in 14 sessions, act-like-user 7, no-git-writes 6 typed and 258 relayed, no-slop 6, real-runs 5 typed and 115 relayed, lean 4. Since 2026-10-20 (the window the per-group reports actually drew on): sub-sessions 31, lean 14, no-git-writes 11, real-runs 10, branch-policy 10, no-slop 9, act-like-user 7, upstream 6, inline-single-caller 5, no-sleep 2, browser-tool 2, no-ai-attribution 0. Six of the twelve land within 20% of the hand counts in finding 2; the rest differ because the hand counts included quotes from compaction summaries and `/goal` conditions, which the tool treats as host text, not the user's.
- `conductor/sessions-watch.mjs`: the script-first replacement for the Session monitor. Reads the last 64 KB of every session log touched in the last 24 hours, lists sessions whose tail is a network error with no user turn after it and 15 minutes idle; `--resume` resumes Copilot sessions with `copilot --resume <id> -p` and prints the `claude -r` command for Claude ones. Zero model calls. 14 tests. Schedule it with cron or launchd; a model is only needed when its list is not empty.
- Not changed: the user's existing scheduled prompts (the hourly switch2jb check, the Session monitor) and any repo's CLAUDE.md or AGENTS.md. The installed plugin copies (`~/.copilot/installed-plugins/virtucon/minime`, `~/.claude/plugins/cache/virtucon/minime/0.2.23`) are older than this checkout, so the hooks take effect only after a plugin update.

Not to add, consistent with the harness-trends list: more prose in skills, an LLM judge for "done", agent-written instruction files. Finding 2 asks for rules in repo files, but each line there is a user correction with a receipt, not agent text.

## Limits

- Assistant text was not extracted, so corrections are read from user words and compaction summaries; counts are rough and overlapping.
- Copilot `session.usage_record.cost` is 1.0 per record; the counts above are model calls, not premium-request billing.
- Four of the 270 Claude files are from before this week (long-lived sessions) and contributed quotes with older timestamps; they are marked in the per-group reports.
