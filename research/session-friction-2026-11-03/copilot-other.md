# Copilot week analysis E (non-foundry-aio sessions)

Session ids are the first 8 chars. Timestamps are UTC from the files. Quotes verbatim.

## 1. Numbers

- 271 sessions, 29,045 tool calls, 31 errors, 33 compactions.
- Messages: 403 tagged "typed", 933 agent steering, 1,303 automated (1,079 system, 224 autopilot).
- "Typed" is inflated. About 225 are scripted briefs (120 Claude-started reviewer/QA runs, 43 parity-notes gen/judge, 30 healthmodel-skills evals, 24 mcp reviews, 8 QLC+ cron). Human-typed is roughly 175.

| Area | Sessions | typed | steer | auto | Err | Comp |
|---|---|---|---|---|---|---|
| Session monitor | 1 | 6 | 2 | 1067 | 29 | 5 |
| Claude-started reviewers/QA (`_private_tmp`) | 120 | 120 | 33 | 0 | 1 | 6 |
| parity-notes live-eval | 43 | 43 | 0 | 0 | 0 | 0 |
| healthmodel-skills evals | 28 | 30 | 32 | 0 | 0 | 0 |
| cxe mcp reviews | 23 | 24 | 8 | 0 | 0 | 8 |
| .copilot_chats (no repo cwd) | 16 | 71 | 264 | 133 | 0 | 1 |
| AHM Portal | 12 | 68 | 51 | 0 | 0 | 1 |
| alz CAF PRs | 4 | 2 | 171 | 4 | 0 | 1 |
| travel-agents | 3 | 9 | 339 | 98 | 0 | 9 |
| QLC+ daily cron | 8 | 8 | 0 | 1 | 1 | 0 |
| other (minime, monitor-lab, cwyd, WAF, KPI, HIP) | 13 | 22 | 33 | 0 | 0 | 2 |

- Non-monitor errors: 2. One DNS failure at 08:57 on 11-02 killed the QLC+ cron run (e2032c86). One "model preparation cancelled without a turn abort" (89555466).
- Compaction thrash: 5 of the 6 reviewer compactions and at least 6 of the 8 mcp compactions are Gemini-4-argon reviewers (pattern 11).

## 2. Patterns

**1. Pre-granted approval ignored, same approval re-asked** (~15 events across 4 sessions)
- 00199487 10-27T20:45 typed: "I give you all approvals to create health models on azure and to test and deploy stuff from this repo"
- 00199487 ask_user, 10 times from 10-27T20:56 to 23:41: "Deploy these four health models to `rg-anbotrai` now?"
- Autopilot poll 10-28T03:36: "exact S165 Azure model/RBAC approval remains unanswered". The user typed "APPROVE" at 08:44.
- 2bc924c8 11-02T16:50, after two region/SKU asks: "globalstandard is always fine as alternative"
- Fix: standing-instruction/brief. Record a scoped grant (subscription, RG, resource type, "revisions inside the same scope are covered") and re-ask only if scope widens. The 10 asks were revisions of the same model set, not new scope.

**2. Permission asks for harmless actions** (82094190: 4 of 15 ask_user; 40da4b9a)
- 82094190 11-02T13:27: "May I run the focused portal tests after the refactor?"
- 82094190 11-03T00:04: "May I run the existing focused authorization regression for #4379?" (the ask itself says it uses mocked responses)
- 40da4b9a 10-29T16:05: "Not created: this chat has read-only access to the backend checkout."
- Fix: user's prompt/setup. A chat session with no cwd cannot create the worktree it was told to create. Start such requests from the repo, or put a read-only/mocked-test allowlist in instructions.

**3. Scope creep, user must narrow after the fact** (4 typed, 3 sessions; 1 admitted by the agent)
- 6bdce573 10-29T13:15 agent: "It wasn’t strictly necessary: the same checks could be added to the original switch with a smaller diff."
- 6bdce573 10-29T13:16: "smaller diff please"
- c755ed55 10-30T13:10: "ONLY write the test, or adapt an existing one"
- d8c69c4e 10-30T13:15: "DONT FIX any imeplemnation of course, right?"
- 82094190 11-03T07:25: "no no no. Except in the auth tests, don't do any auth related actions please. that's cleaner"
- Fix: the "do ONLY what's asked" rule already exists in global instructions and was still broken 4 times. It needs a mechanical check, not more text: a pre-commit/hook step that prints diff size against the request, or a brief line "touch only: <files>".

**4. "Don't stage or commit" restated per session and re-relayed by orchestrators** (4 typed, 66 orchestrator relays)
- 6bdce573 10-28T15:02: "ok please address these open things, dont'stage or commit"
- 20077034 10-28T23:25: "dont stage or commit any changes yet"
- 20077034 10-28T23:28: "please approve all required permission, but dont let the stage anything"
- 6bdce573 10-29T05:40: "dont stage or commit anything"
- Orchestrator c76f83fe 10-28T23:26: "Do not stage, commit, push, or run a merge that stages changes or creates a commit."
- Fix: global default "never stage or commit unless told". The user lifted it once (20077034 10-29T00:04: draft PR plus opposite-model rubber duck). That exception should be a named mode.

**5. Orchestrator re-steers workers on stale artifacts and snapshots** (stale/hash/freeze ~90 relays)
- 75b7ca9f (from 00199487) 10-27T22:38: "confirm the deployed revision contains the verified envelope before readiness"
- 75b7ca9f 10-27T22:57: "do not assume the prior token-provider build contains it"
- ec2bcc15 10-28T23:47: "do not send a stale diff"
- ec2bcc15 10-29T02:16: "do not upload the stale file; wait for the final bundle"
- Fix: worker brief template. Add a "provenance" field (commit, image revision, diff SHA-256) that every handoff must carry. Orchestrators spent about 60 messages rebuilding that by hand.

**6. Human as test runner and log courier** (AHM Portal, several pure-paste messages)
- 82094190 11-02T12:33 user: "the tests were runnong on Windows"
- 82094190 agent ask 11-02T12:33: "The attached folder does not contain the reported failure"
- 82094190 agent ask 11-02T22:50: "The local `test-results` folder has been cleared by a later run"
- 715b902e 11-02T21:30 "oh oh" plus a pasted Playwright error, inside an unrelated CVE research session
- Fix: user's prompt/setup. Name the artifact path with each paste (trace.zip, error-context.md). The agent should ask for those once, up front, and runs should write to per-run folders. Keep pasted failures in the session that owns the test.

**7. Interrupting a patch-on-patch spiral with fragments** (AHM Portal, 82094190)
- 11-02T13:23: "what a mess, right?" followed by "go a step back, clear and simple actions and boundaries"
- 11-02T21:15 agent: "That step has timed out once and is retrying". User, same minute: "some kind of stuck in the enter loop"
- 21:16 "this stuff is too brittle"; 21:19 "it's not about retries now"
- Fix: agent. It added retries to a test helper whose problem was structure, and kept retrying under a user who had said it was stuck. A "same failure twice: stop and redesign" rule would have fired at the first retry.

**8. Developer enforces red/green evidence; claims arrive without it** (4 asks)
- 82094190 11-02T22:10: "ok add such a test to the existing test, lets see if its really red"
- 82094190 11-02T21:59: "where is that coming from? it worked earlier?"
- 6bdce573 10-28T23:42: "verify if setCanSave ... is reallty needed, make some counter tests and arguments"
- 82094190 agent ask 11-02T22:16: "The test file then changed unexpectedly"
- Fix: standing instruction. For every bug fix or removal, "write a failing test first, show red, then green". The agent reproduced the crash only after the user asked.
- Positive counter-example: 2bc924c8 11-02T21:22 "Its green overall state is therefore misleading."

**9. Harness and tooling blocks surface at the end** (3 sessions)
- 308900bc 10-28: "Draft PR creation is blocked: `msazure-ado` returned `MCP OAuth challenge required (HTTP 401)`." Later: "the ADO MCP currently exposes no PR-creation tool, and the CLI fallback timed out."
- ec2bcc15 10-28T23:44 user: "I'm trying to connect hte helper" ... 10-29T00:02 "I pressed the button to send". The browser-driven Teams helper needed a human click.
- 82094190 agent ask 11-02T22:27: "GitHub MCP can create the issue, but it cannot upload the screenshot."
- Fix: agent. Probe the MCP write capability first, before 2 hours of work. The user asked for a "draft PR in the ADO" at 12:19 after the fix was done.

**10. Vague first prompts, late goals, dead retypes** (6 sessions)
- 20077034 10-28T16:05: "I want them all to be 100% ready,". No acceptance criteria. It became 308 prompts, 129 autopilot nudges, 4 sub-sessions.
- 1b2e0159 10-29T07:04: "make sure all the open githhhb PR's where their folders are". Agent: "I found 492 open PRs across your accounts, mostly in unrelated forks."
- 4ff076ec: started 10-26T20:58. The goal was stated 9 hours later, 10-27T06:07: "the key point is, that at it's core, minime flow, the whole thing should be a about harness engineering"
- d66785f5 11-02T16:22: "can you run the evals?"
- df39000f 10-27T20:54: the same message sent twice (typo "ACT" then "ACR").
- Fix: user's prompt. Put the goal and "done means" in message 1: "ready = CAF helper checklist passes, checks green, PR still draft".

**11. Compaction thrash on small-context reviewers** (874715bf, 57035a84, 8424820d)
- 874715bf: 5 compactions in 19 min on gemini-4-argon (11-01T22:06 to 22:25). Pre 158-192k tokens, post 85-113k. 57035a84: 4 in 9 min.
- Briefs say "read the whole prompt file, return a report", so the model reads large diffs, compacts, then re-reads them.
- c76f83fe 10-29T00:52: after compaction the reviewer restarted: "I'll begin the rubber-duck review of PR #7402. Let me start by verifying the bundle integrity"
- Large coordinators compact at about 700k tokens (00199487 x6 in 27 h). 20077034 compacted the moment the user asked "can you summarie what has been changed?" (10-29T06:23, 698k).
- Fix: worker brief. Cap reviewer inputs (diff stat first, per-file reads) when the host model's window is under 200k, or route those reviews to a 900k model.

**12. Eval graders flag the same skill defect across generations** (healthmodel-skills)
- "Health percentages lack plain-language explanation." (8e648af1 probe-0, 10-27)
- "“non-paging work” is unexplained jargon." (584deb29 travel-1b)
- "plan.md retains unexplained jargon." (750226a2 local-2026-11-02, 11-02T16:35)
- Also "User concerns mix app-user outcomes with requester planning and comparison tasks." (4af0a6dd travel-0). The same mix appeared in c475604d (0b) and 8e648af1. It was fixed in travel-1 (0fb38ebb 10/10).
- The jargon defect survived four generations. Fix: promote it to a hard line in the skill, not a grader-only finding.

**13. Eval harness measures against no baseline; deploy case leaves residue** (d66785f5, ebe74ac8)
- d66785f5 11-03: "The last report’s +0.88 delta was calculated against zero because no baseline existed"
- ebe74ac8 11-02T16:51 "Yes, deploy it." produced "Recovery requires fresh approval": two immutable relationships were rejected, leaving a live model with 2 Unhealthy and 4 Unknown signals.
- Fix: harness. Add config B (no skill, previous skill) before quoting deltas. Add a teardown step to the deploy eval.
- Eval worker briefs themselves were adequate: no blocked workers, 0 ask_user in plan evals. "can't answer questions right now, just note them" produced "Needed from you" lists instead of stalls. eval-3 3/4 failed only on "proposed answers".

**14. Scheduled QLC+ merge repeats the same baseline work** (8 sessions, one prompt)
- Prompt ends "once you\nrun tests and update the @MANUAL\_REVIEW file": a dangling sentence.
- Five reports say the same: "the same 15 `timelineViewport` failures" (10-27, 10-28, 10-29, 10-30, 11-01). Each run re-derives the baseline.
- e2032c86 11-02 08:57: DNS error, session shut down 09:08, no merge. 30dfe195 caught up the next day.
- Fix: put the 15 known failures in a baseline file the run diffs against. Add a retry on network error.

## 3. Standing-instruction candidates

| Rule | Evidence | Home |
|---|---|---|
| Default: never stage, commit or push. Draft-PR mode is an explicit exception requiring opposite-model rubber duck first. | Pattern 4, plus 66 relays | copilot-instructions.md (global) |
| Scoped grant for approvals. A revised plan inside an approved scope does not re-ask. | Pattern 1, 10 asks in 3 h, 9 h idle | Worker brief template plus approval ledger |
| Read-only commands and mocked tests never need "May I". | Pattern 2 | copilot-instructions.md |
| Touch only what was named. Print diff stat vs request before finishing. | Pattern 3, 4 corrections despite an existing rule | Hook (pre-final check) |
| Bug fix = show red test first, then green. | Pattern 8 | Skill (tdd) / copilot-instructions.md |
| Tool routing: GitHub issues via github MCP, ADO via ado MCP, internal docs via enghub MCP. Probe write capability first. | "use the github mcp as tool" (82094190 11-02T22:20, 22:26), "use the ado mcp or something" (308900bc 10-28T12:21), "better use the enghub mcp" (8466773d 10-28T12:30) | copilot-instructions.md |
| ahm-diagrammo docs: use latest version, regenerate SVGs, never hand-edit, visually inspect. | 1b2e0159 10-29T07:06, 07:49, 08:14; d789b724 07:27, 07:49; cd5aa188 07:25 | Repo skill/AGENTS.md for ahm-diagrammo PRs |
| Portal e2e: outside auth specs assume authorization is done. | 82094190 11-03T07:25 | AGENTS.md in `src/portal_tests` |
| Handoff provenance: commit, image revision, diff SHA-256. | Pattern 5 | Worker brief template |
| Stop and redesign after the same failure twice. | Pattern 7 | copilot-instructions.md |

## 4. Session monitor

**What it was.** A "Session monitor" created 10-08T17:49, gpt-6.1-sol. A cron prompt woke it every 20 min (30 min from 10-15) to restart or resume sessions broken by flaky internet and answer ask_user prompts. The prompt was saved in 4 versions (10-08, 10-13, 10-14, 10-15), each with more delegation text. It ran 26 days: 1,075 wakes, 5 compactions at about 700k tokens (10-12, 10-15, 10-18, 10-23, 11-03). The user typed "Continue from where you left off." on 10-09 and 10-17.

**Useful phase, 10-08 to 10-23.**
- 13 resume messages (1 on 10-08, 5 on 10-09, 7 on 10-21) after DNS/408 failures.
- 54 answers to other sessions' ask_user (10-13 to 10-23). 28 were just the "(Recommended)" option. 26 were custom scope-limiting answers, some approving a digest-pinned image download and an isolated tool run.
- 2,241 sql and 2,181 update_todo calls kept its own recovery ledger.

**Dead phase, 10-23T16:22 onward.** `get_sessions_status` vanished from its toolset (last call 10-23T11:34). From then on, 357 of 370 assistant messages read "Monitoring remains blocked because the live session-status tool is unavailable; no sessions were assessed or changed." The other 13 are a variant of the same line. It performed zero sends and zero answers. It never stopped itself, because the prompt says "Keep this timer active until the user disables it."

**Cost.**
- Account snapshot 11-03: 1,041 premium-request units, 3,090 model requests, about 1.0B cache-read tokens, 0.78M output tokens, 27M ms API time. About 3 requests per wake, almost all input.
- Dead phase alone: 378 wakes, 1,117 requests (36% of lifetime), 443M input tokens, 176k output tokens. This week (since 10-28): 279 wakes, 822 requests, 384M input tokens, for nothing.
- 29 errors: 28 network (DNS ENOTFOUND, connect, one 408; 15 on 10-09 alone), 1 auth 401 (10-28T14:07). All came from the same flaky network the monitor existed to handle. It had no retry of its own.

**Did it help?** Yes for 10-09 to 10-21. The 10-21 resumes had checkpoint evidence behind them. No for the last 11 days. Nothing in the monitor reported its own outage to the user.

**Simpler mechanism.**
1. A launchd/cron shell script, zero model tokens. For each `~/.copilot/session-state/*/events.jsonl` touched in the last day: `jq` the last event. If it is `session.error` matching ENOTFOUND/408/Connect, the file is idle for 15 min and no later `user.message` exists, run a resume. The LLM is only invoked on a hit.
2. For ask_user: a hook or timeout that picks the "(Recommended)" option. That covers 28 of 54 answers. The 26 custom ones should wait for the user.
3. Circuit breaker in any future model-driven monitor: after 3 consecutive "blocked" wakes, write one line to the user and delete the timer.
