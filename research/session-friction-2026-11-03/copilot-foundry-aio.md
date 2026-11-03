# foundry-aio Copilot sessions, friction analysis (2026-10-30 to 2026-11-03)

Session ids are the first 8 hex chars. All times UTC.

## 1. Numbers

- 57 sessions, 7,312 messages, 37.7k tool calls. 4,753 messages landed on 10-31 alone, 2,289 on 10-30, 269 on 11-01..03.
- Typed: 36 (0.5%). 29 in the coordinator `3254d053`, 6 in `36bb702b`, 1 in `bf8746c4`.
- Agent-to-agent: 6,747. Of these 734 are content-free "Session X finished processing" notices. The coordinator (`3254d053`) wrote 1,533 of the rest. The rest are worker reports (`fd50b201` is the lead worker, `bcd8c6e2` research, `02fc50bd` reflection, `ecbeaa8d` backend, `45075f4e` Bicep).
- Autopilot: 463, all empty continuation prompts. System: 65, two scheduled-review prompts repeated 54 times.
- Errors: 2 (DNS `ENOTFOUND` to api.enterprise.githubcopilot.com in `36bb702b` 11-03T09:24; HTTP 500 in `d80cc09e` 10-31T19:28). One failed compaction ("summarizer did not settle within 600s", `fd50b201`).
- Compactions: 108. `fd50b201` 28, `bcd8c6e2` 24, `ecbeaa8d` 10, `02fc50bd` 10, `3254d053` 6, `45075f4e` 5. `fd50b201` compacted every 30-60 min, each pass dropping 300-500 messages into a 30-45 KB summary.
- The week ended with the goal unmet. The 10-30 21:50 status was "demo is live, but not complete". On 11-03 the reset preflight reported deployment still refused by checked-in hooks. The repo has one commit ("Initial commit") and everything else uncommitted.

## 2. Patterns

### P1. Self-imposed safety gates blocked the actual goal (deployment) for 4 days. Count: about 676 "blocked", 83 "azd up" mentions, 47 "ordinary-trust" mentions.
- typed `3254d053` 10-31T06:50:58: "why is the deployment blocked?"
- assistant `3254d053` 10-31T06:51:57: "We blocked deployment ourselves in [azure.yaml](azure.yaml); this is not a confirmed Azure outage."
- coordinator to reviewer 10-31T07:02:24: "actually user-required or an overstrong assumption we introduced"
- `36bb702b` 11-03T09:47 (agent-0ac1fd55): "Block the reset: `scripts/bootstrap.sh` refuses recreation of a missing group, and the checked-in deployment hooks refuse deployment."
- Different: the brief should rank "deployed and visible" above assurance work. Every new gate must name the user requirement it serves. The "reassess against the user's actual goal" prompt (first sent 10-31T02:08) should have fired on a schedule, not after the user asked why.

### P2. Synthetic/mock tests produced when the user wanted real end-to-end. Count: "synthetic" 919 mentions (188 in coordinator messages).
- user request quoted in QA brief `43b8fc74` 10-31T00:30: "work until you have it deployed and verifyed also viusally with e.g. playwright MCP"
- typed `3254d053` 10-31T06:49:08: "no syntehtic tests, real end to end tests please"
- coordinator to QA 06:50:23: "Stop any synthetic/mock browser runs and the queued synthetic matrix."
- The QA worker ran 6 hours of replay/fixture work before the correction.
- Different: the worker brief must state "acceptance = real service, deployed revision; mocks are never evidence". The QA brief should have refused to start without a deployed target.

### P3. Scope growth into bespoke security/continuity machinery (hand-rolled infrastructure). Count: about 700 "freeze/frozen" mentions, 57 script files and 14.5k lines in `scripts/`.
- typed `3254d053` 10-31T05:55:23: "for the MCP implementation, it should use a exixtint dotnet library and nothandroll one."
- `fd50b201` 10-31T01:14:14: "Implementing controlled Python3.9+ forkpty relay on macOS/Linux, owning the child PID/session"
- `fd50b201` 10-31T05:59:04: "Final broad script run reached 2319 cases: 2318 passed"
- typed `bf8746c4` 11-03 (in brief): "no stop with all tha pnning stuff". The reduction session got scripts from 32 to 29.
- Checkpoint titles of `fd50b201` drift from "private proof" to "startup containment and replay", "durable replay and authority gates", "immutable journal".
- Different: standing rule "prefer a maintained library or platform feature; custom security machinery needs user sign-off". A reviewer should ask "does this move deployment closer?" on each freeze.

### P4. Freeze / review / refreeze loop that never converged. Count: 115 refreeze messages, 293 "stale" mentions, 149 refrozen/withdrawn/superseded.
- `fd50b201` 10-31T01:14:14: "77-test native freeze withdrawn for both cleanup findings."
- `ba5fd664` 10-30T23:48:39: "SQL regression fixed and REFROZEN."
- coordinator to QA 10-31T03:05:50: "The backend's `VisitorStore` and `Program` have changed since the matched replay."
- Evidence goes stale because a shared in-place checkout keeps moving. Reviews are of hashes that no longer match HEAD.
- Different: limit to two review rounds per unit, then ship or escalate. Pin evidence to a source hash and have a script re-check it (the hash was already carried in messages).

### P5. The user had to ask for status; no status artifact. Count: 5 typed status asks, 734 empty "finished processing" notices.
- typed `3254d053` 10-30T15:37:38: "how many more questions?"
- typed 10-30T21:48:42: "whats the status?"
- typed 10-31T05:44:16: "what did you all change or imrpove?"
- typed (subagent channel) 10-31T23:16:58: "what is still open?"
- Different: a standing rule "maintain STATUS in LOOP.md: goal checklist, last live evidence time, open user decisions". The user's LOOP.md handoff request on 11-01T00:40 came after the fact.

### P6. Autopilot and schedules kept running after the user said stop. Count: 40 autopilot prompts in the hour after the pause.
- typed `3254d053` 10-31T20:59:19: "stop for a momeny"; 21:00:01 "stop all sub sessions"
- coordinator 21:11:14: "the parent keeps receiving automatic continuation prompts despite the user's explicit pause."
- assistant 21:08:56: "The active Autopilot objective is still requesting continuation; disable it in the app to prevent automatic restarts."
- The mode only changed to interactive at 21:11:21, after the coordinator messaged workers to send itself a message.
- Different: a hook that treats a pause flag file as authoritative over autopilot/scheduled prompts. Autopilot mode was active for 29 hours (10-30T15:41 to 10-31T21:11).

### P7. Role and scope confusion early, user corrected after workers had acted. Count: 4 typed corrections in the first 90 minutes.
- typed 10-30T12:36:30: "attentiokn: "Research reflection" has to check github issues, not the "Foundry deployment reseatch""
- typed 13:40:56: "to save time, the researcher don't need to deploy full samples."
- by then `bcd8c6e2` 13:28:04 had reported "authorized `azd up` is running from the scratch copy" and registered a preview feature in the user's subscription.
- `02fc50bd` 10-31T00:45:04 (coordinator): "Stop this task immediately. ... I will handle the issue monitoring directly."
- Different: the first prompt defined timers but not each role's deploy rights. Briefs need a "may deploy: yes/no" line.

### P8. User constraints arrived late and were retrofitted across all workers. Count: 7 typed design constraints between 13:28 on 10-30 and 05:55 on 10-31.
- typed 10-30T13:28:22: "but the infra should use private endpoints"
- typed 21:51:30: "whitelist my current public IP as security measure or protect the website with a little key in the url"
- typed 22:07:57: "dependsOn on bicep is a massive code smell, it's almost NEVER required."
- typed 22:13:33: "in bicep, every file is it's OWN deployment"
- Result: a Bicep rewrite mid-flight (103/98 resource parity checks), and `dependsOn` was still being discussed 13 hours later (128 mentions, last on 10-31T11).
- Different: a short constraints list in LOOP.md that every worker brief inlines by reference, plus the first prompt asking up front for network exposure, auth and IaC style.

### P9. Identifier leaks despite a privacy rule. Count: 69 "exposed/leak" mentions, one literal subscription id in 11 messages.
- coordinator 10-30T22:50:12: "never print identifiers"; 10-31T06:56:08 asks for affected path and line numbers "without quoting the values"
- assistant `3254d053` 10-31T05:48:57: "An older sandbox probe report exposed a subscription ID and public IP in a tool read."
- assistant 23:17:51: "A private identifier also remains staged."
- The first leak was in a worker report at 10-30T13:28, nine hours before the rule was stated.
- Different: a secret-scan hook on outgoing messages and tracked files, plus the rule in the base brief template (it appears 72 times as "without printing" in ad hoc form).

### P10. Stall and liveness detection by guessing. Count: 10 scheduler/busy-skip messages.
- coordinator 10-31T11:37:03: "it has remained busy for over 20 minutes without the requested PE/NIC handoff"
- coordinator 12:23:40: "the hourly research automation reports lastRunAt 09:03Z, updatedAt 12:04Z and nextRunAt 13:04Z, despite current time 12:23Z"
- `fd50b201` 17:56:30: "busy for3574s with no pending user input"
- The hourly wake was silently skipped for about 4 hours because the target was busy.
- Different: workers write a heartbeat line (last step, next step, blocker) to a file every N minutes; the coordinator reads it instead of probing session status.

### P11. State recovered by archaeology after compaction. Count: 108 compactions; at least 3 explicit recovery hunts.
- coordinator 10-31T06:22:08: "recover the original evaluation request's provenance and existing authorized reader"
- `fd50b201` 06:33:39: "Specific original nested history located", pointing at line 3833 of its own `events.jsonl`
- `fd50b201` 10:43: "I found checkpoint016's source note but not the artifact paths yet."
- Summaries kept user quotes and the todo table (post-compaction work resumed within seconds), but decisions made 20 compactions earlier (who authorised the one-shot routine call) were not queryable.
- Different: a decisions ledger (id, user words verbatim, date, authorising message, effect) outside the transcript, rewritten at each compaction.

### P12. Open-ended definition of done and a user who is away. Count: 98 "user unavailable / decision needed" mentions.
- typed first prompt 10-30T12:17:55: "efficint means: fast, realible, very quick if it doesn't have too much chnages"
- brief to `fd50b201` 15:40:58: "keep expanding the set during implementation"; "Do not claim completion until every identified feasible capability works end to end"
- typed 15:39:05: "if more questions pop up, dont be blocked, add them to the look and ask me once I'm back"
- coordinator 10-31T06:01:21: "Routine pagination regression remains on hold because the user is unavailable to confirm its test seam."
- Different: the user's own prompt could have set a fixed capability list and "deployed demo with these N working by date" as acceptance. The "don't be blocked" instruction needed a rule for what to do with a decision that blocks the critical path (pick the default, record it, proceed).

### P13. Degraded report style. Count: about 1,000 worker messages with words glued together (22+ char lowercase runs), almost all on 10-30 and 10-31 from `fd50b201`, `ecbeaa8d`, `bcd8c6e2`, `45075f4e`, `ba5fd664`; none after 11-01.
- `fd50b201` 10-30T22:15:57: "Actual fresh-shell operatorwrapper DIDNOTpass withinbounded10min."
- `ecbeaa8d` 10-31T03:24:17: "REFROZENnewseparateVisitorEnrollmentcandidate."
- Different: a terse-reporting instruction overshot into unreadable text. Lint inbound messages and reject long lowercase tokens.

### P14. Prose quality needed three user rounds. Count: 3 typed.
- typed 10-30T21:52:45: "deep /stop-slop and /ponytail-review of all the text and prosa in README.md and LOOP.md"
- typed 10-31T05:52:46: "Not this huge vomit style blob"
- typed `36bb702b` 11-01T10:39:24: "improve the narrative and structure"
- Different: put a README shape (short, feature links, install, start) in standing instructions and run the prose skill before reporting done.

### P15. No revert path in a shared in-place checkout. Count: 27 "in-place" briefs, 45 worktree/branch warnings.
- every worker brief carried: "Do not create/switch branches/worktrees or commit/push"
- `bf8746c4` 11-03T10:36:09: "No pre-change copies were preserved (files untracked, nothing stashed or copied)."
- `a288dec3` 11-02T20:27: "created `scripts/diagnostic-privacy.test.mjs` and removed only that file. The index checksum is unchanged"
- Different: the brief should require a pre-edit snapshot outside the index (`git stash create` or a copied directory) and per-file ownership, since commits are off the table.

### P16. Harness walls hit repeatedly, with workers spending turns discovering them. Count: 2 session errors, 1 failed compaction.
- coordinator 10-30T22:50:53: "Python `pty.spawn`, which is being killed locally even for a synthetic shell"
- `36bb702b` 11-03T10:58: "no web-fetch/browser/shell tool reachable at any depth". Six sub-agent delegations were spent proving it; one returned "Please provide your question or task."
- compaction `fd50b201` 10-31T17:53: "did not settle within 600s of starting; pending summary discarded"
- Different: capability probe (can I fetch a URL, spawn a shell, create a session?) as step 0 of the orchestrator, written to a file so workers do not each re-test.

## 3. Standing-instruction candidates

- **Goal first (copilot-instructions / worker brief):** "Priority order: deployed and working, then verified with real services, then hardening. Report time since last live deploy attempt." Evidence: P1, P2, the 07:02 reassessment.
- **Gate provenance (reviewer skill):** each guard added to azure.yaml, hooks or scripts cites a user requirement; reviewers reject gates without one. Evidence: "overstrong assumption we introduced", 11-03 reset blocked by the same hooks.
- **No synthetic evidence (brief template):** "Mocks, fixtures and replays are not acceptance evidence. Real service, deployed revision only." Evidence: user 06:49, QA stop 06:50, 919 mentions.
- **Use libraries and platform features first (instruction):** MCP, OCI publishing, PTY relay, continuity journals. Evidence: P3, typed 05:55:23, typed 11-03 "reduce the scripts".
- **Never print identifiers (hook plus template line):** subscription ids, IPs, keys; scan outgoing messages. Evidence: 72 "without printing", P9.
- **Brief header block (template):** repo path and "shared in-place checkout", no branch/worktree/commit/push, "Own ONLY <paths>", no Azure writes unless named, report format. These lines were hand-rewritten in at least 23 briefs.
- **Pause flag (hook):** a file `PAUSED` blocks autopilot and scheduled prompts in all sessions. Evidence: P6.
- **Status block in LOOP.md (instruction):** goal checklist, last live evidence, open decisions needing the user. Evidence: P5.
- **Review budget (instruction):** at most two freeze/review rounds per unit. Evidence: P4.
- **Report style (instruction):** normal spaced prose, short. Evidence: P13.
- **Late-constraint intake (instruction):** when the user states a constraint, append it to a CONSTRAINTS section and broadcast the one line to all workers. Evidence: P8 (dependsOn, privacy, private endpoints, IP allowlist).

## 4. Orchestration lessons

- **Report volume exceeded the coordinator's ability to use it.** The coordinator received about 5,000 worker messages over 2 days and compacted 6 times (1.6-1.9k messages dropped each time). Mechanical check: a daily ratio of "messages with live-Azure evidence" to total; alert when it stays at zero for 6 hours.
- **Success criteria drifted from the user's.** Hardening of deployment and continuity grew until deployment itself was blocked. Mechanical check: a goal checklist (deployed, evaluation, routine, sandbox, UI QA) with a timestamp of last progress on each; the coordinator may not open new workstreams while the top item is stale for more than 2 hours.
- **Compaction is frequent in workers (every 30-60 min) and survivable because of todos and files**, but old authorisations and provenance are lost. Mechanical check: after each compaction, a hook injects the decisions ledger and the constraints list, and the first assistant turn must cite the active goal item.
- **Stop commands are not authoritative.** Autopilot, hourly schedules and child sessions kept going after the user said stop. Mechanical check: pause file checked by a prompt hook.
- **Liveness is inferred from "busy" status.** Mechanical check: heartbeat file per worker with a max age; the schedule layer logs skipped wakes.
- **Stale evidence in a shared checkout.** Reviews referenced hashes while other workers edited. Mechanical check: a script that compares each cited source hash to the current tree and marks evidence stale automatically.
- **No safety net for revert.** One commit for the week and workers forbidden to commit. Mechanical check: per-unit patch snapshot created by the orchestrator before dispatch.
- **Privacy rule arrived after the first leak.** Mechanical check: pre-send scan of agent messages and tracked files for GUID, IP and key patterns.
