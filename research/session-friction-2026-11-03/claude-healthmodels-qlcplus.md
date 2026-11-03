# Friction analysis A: healthmodels-plus + qlcplus (2026-05 to 2026-10-30)

File names below are shortened: `hm_` = Desktop-projects-healthmodels-plus__, `qlc_` = Desktop-projects-qlcplus__ (first 8 chars of session id).

## 1. Numbers

- Sessions read: 49 files (22 healthmodels-plus, 27 qlcplus). 29 have prompts, 20 are empty sub-sessions.
- Prompts in index: 2146. Only about 130 are typed by the developer, plus about 25 button/AskUserQuestion answers ("Yes, merge them", "Fix 1-5 first").
- The other ~1990 are automated: 632 Stop-hook feedback (one session, hm_ac8c0401), ~190 task-notifications, ~165 cross-session/subagent messages, 43 image markers, 17 compaction summaries, 2 pasted /loop bodies, 2 pasted /code-review bodies.
- Friction, rough counts of typed prompts:
  - Corrections: ~12
  - Repeats (same text re-sent, or same rule re-stated across sessions): ~35
  - Interrupts / mid-turn steers: 1 explicit "[Request interrupted by user for tool use]" (qlc_f2639d11), ~8 mid-turn redirects
  - Verification asks (agent should have shown proof): ~22
  - Harness fights: ~14 distinct (classifier denials, usage limits, sandbox, session tooling)
- Caveat: assistant text is not in the logs. Corrections are inferred from user text and the compaction summaries.

## 2. Patterns

### P1. Goal hook spins 632 times on an unreachable condition (harness, ~632 turns)
- hm_ac8c0401, /goal at 2026-10-27T21:41: "a fully commited and pushed, well documented github repositoty, with working github actions, and releases and fully checked commands..."
- The auto-mode classifier denied the PR merge twice. Hook verdict, repeated: "the squash merge was denied by the permission classifier." 87 fires 04:xx, 534 fires 05:xx on 2026-10-28.
- User resolved it by hand: "merged, can you check? and you can work durecly on main" (2026-10-28T09:19).
- Different: goal conditions that need user-only actions (merge, release approval) need a bail-out clause ("or stop and ask if blocked"). The agent should stop and ask after the 2nd identical verdict. A loop cap in the hook would help.

### P2. Permission classifier / sandbox blocks routine steps (harness, ~7)
- hm_1e6357b1: git restore of test-rewritten SVGs denied, then user: "Restore them" (2026-10-28T23:10). Same again after the release suite.
- qlc_58c87728: Copilot cmake denied; user: "disable the sandbox mate". Also "better ask now so I can allow it" (2026-10-25T20:51).
- qlc_d56d5419 (summary): Copilot outside review blocked ("Create Unsafe Agents"). Sessions also refused start_session on automated turns and under Remote Control.
- Different: pre-approve a project allowlist (git restore of `*.svg`, `/opt/homebrew/bin/cmake`, `copilot -p`) in `.claude/settings.json`. Agent asks once up front for the whole batch, not mid-run.

### P3. Verification pushed to the user (~22)
- "so is everything commiteed?" (qlc_1669e00d, 2026-10-24T14:29)
- "did you update the screenshots as well?" then "Regenerate them" (hm_ac8c0401, 2026-10-29T05:42 / 05:59)
- "ok is now everythign 100% on main and a new tag and being built?" (hm_1e6357b1, 2026-10-28T23:49)
- "is everythin merged and fully tested? please ensure and keep markdown test respirts with full screenshots" (qlc_d9c12de3 and qlc_f22ae184, 2026-10-30T15:40, sent to both)
- Also: "Were show tests done with VDJ as well? As it was planned by the other seasion?" (qlc_d9c12de3, 17:01), "are you sure the tasks are still running?" (qlc_58c87728, 2026-10-24T23:43).
- Different: a closing checklist skill (git status clean, branch/tag/CI state, docs and screenshots regenerated, plan items ticked) that the agent runs before saying "done". Enforce it with a Stop hook, not by asking.

### P4. User babysits live runs (VDJ, QLC+, Azure portal) (~10)
- "you run it please" (qlc_58c87728, 2026-10-24T17:40); "there was a confirmation dialog from VDJ if I want to stop the playback"; "I'll try to dsiable the load security"; "I starte vdj again" (2026-10-26T01:10).
- Summary shows the cause: QLC+ close killed VDJ "several times", and the smoke run auto-loaded the user's `AUDIO.qxw`.
- hm_ac8c0401: agent's install test used shared `~/.azure` and "briefly broke the user's real `az monitor health-models`".
- Different: a `live-run` skill with a preflight (scratch workspace argument, back up prefs, isolated `AZURE_CONFIG_DIR`/`AZURE_EXTENSION_DIR`, VDJ dialogs to dismiss) written once. The rules existed only in summaries and memory.

### P5. Blind resends after errors and limits (~15)
- "Try again" x7: qlc_6b0c996c (2026-08-22T11:38, 08-23T07:20, 07:49, 14:18), qlc_58c87728 (2026-10-25T07:08, after model switch).
- "I hit my usage limit while you were working, but it has reset now. Please continue from where you left off." (qlc_e368e247, 2026-08-24).
- Same prompt re-sent: "implement this algortim, and show the database.xml path..." x3 (qlc_cd1ae9c8, 2026-07-03T21:16/21:47/21:52); "go and implement the revised plan" x3 (2026-07-04 10:00/10:31/11:20); "yes, fix them and then compare with the plan." x3 (14:02/14:03/16:20).
- Different: the agent should persist a plan file with step status so "continue" is enough. Summary said "Agents died on the Fable limit", so subagents need a fallback model in the dispatch.

### P6. Assumptions stated as fact (~6 corrections)
- "you are so inaccurate and full of assumptions, it's not giving me confidence on anything you do" (qlc_f2639d11, 2026-09-12T20:34).
- "I can't wire the Stube AP. That's the WHOLE point of what you have try to improve on" (same file, 19:41).
- "what other weird assumptions did you add? in the end, the logic needs to be simple and predicavble." (qlc_58c87728, 2026-10-24T23:00). Overdub answer: "we don't know that we're in a loop. and we should not know or care." (summary).
- Summaries also admit "Wrong claim in the report" (qlc_d9c12de3) and a README troubleshooting note "disproved by real-environment testing" (hm_ac8c0401).
- Different: findings labelled "observed" vs "inferred from code". Ask for the constraints first (can the AP be wired?) before the plan. User prompt could add "list your assumptions before acting".

### P7. Same rules re-stated session after session (~25)
- Upstream compatibility: "it's important that it remains compatible with upastream" (qlc_6b0c996c, 2026-08-22T11:38); "we want to stay upstream compatbile and if upstream has fixed somethign we fixed, it's better to take it from upstream" (qlc_cd1ae9c8, 2026-07-04T17:22); "I want to be able to update myself FROM upstream" (qlc_b9e4fa25, 2026-10-24T11:49).
- MANUAL_REVIEW.md: "review what changes and see if the @MANUAL_REVIEW.md needs an update" (qlc_8bcf9af2, 2026-08-21); "anthing that needs to added to @MANUAL_REVIEW.md ?" (qlc_cd1ae9c8, 07-02); "is the @MANUAL_REVIEW.md also up to date?" (qlc_58c87728, 10-26). 5 times total.
- Sub-sessions for context: "work in sub sessions within this project to protect the context size" (hm_ac8c0401); "use subsessions to manage the context" (qlc_58c87728); "Use subsessions to manage the context better" (qlc_d9c12de3). 9 times total.
- Single-caller functions: "like e.g. a function that is only called from a single place" (qlc_c7985954, 10-23); same phrase in qlc_58c87728 (10-24) and "inline behavior that is used only in one place".
- Different: these belong in the project CLAUDE.md or a skill (see section 3).

### P8. Requirements arrive late or in slices (~12)
- hm_ac8c0401: initial prompt, then separate prompts "dont forget to add screenshots and examples to the README", "make sure to add cool badges and screenshots", "no one ever installed the old extensiokns, remove that from the readme".
- qlc_d9c12de3: test report asked in three steps: "keep markdown test respirts with full screenshots" -> "Make the test reports human readbale with screenshots and add it to the tepo" -> "link up all test reports with the readme" (10-30T15:40, 17:25, 20:03).
- qlc_1669e00d: "follow TDD and implement these changes in the current branch (dont change any branch)" came after the review, not before.
- qlc_58c87728: "I let know the macbook alone for 10 hours, so you can run anytests" and Copilot-review request came 10 hours after the first prompt.
- Different: first prompt carries deliverable list (README content, screenshots, report location, what NOT to touch).

### P9. Git permission whiplash and attribution drift (~8)
- hm_1e6357b1: "Commit and PR", then mid-turn "dont stage or commit or push" (stopped the agent), later "once you fully finished it, merge with main and make a new release".
- Merge authority is re-granted per action in button text: "Merge ... into mcp-server in the main checkout (keep my uncommitted files as they are). Don't push." (qlc_f22ae184, 10-30). Also "Merge into mcp-server" x3, "Commit both", "Push to origin", "update from origin".
- Rule "Never add AI attribution" restated in every summary, yet qlc_58c87728 shows commits carrying `Co-Authored-By: Claude Fable 5.1`/`Opus 5.5` and qlc_b9e4fa25 summary lists "Commit attribution line: Co-Authored-By: Claude Opus 5.5".
- Different: a commit-msg hook that rejects `Co-Authored-By: Claude` and "Generated with". A written branch policy (see section 3).

### P10. User manually coordinates parallel sessions (~10)
- "check the other session for qlcplus and coordinate the work" (qlc_58c87728, 10-24T19:46); "coordinate with the other session" (hm_ac8c0401, 10-28T23:14); "coordinate with the other active session" (qlc_f22ae184).
- Identical prompt pasted into several sessions at once: "please run copilot cli reviews about the changes for the VC console and use multiple strong models." in qlc_1669e00d, qlc_b9e4fa25, qlc_c7985954 (19:34 to 19:35, 2026-10-24) and three sessions reviewed the same VC series (13+15 confirmed findings each).
- Same for "make sure you create plenty of screenshots of all features and check them visually" (qlc_d9c12de3 and qlc_f22ae184, 10-29T22:56).
- hm: version bump collision avoided only because a peer said "please don't bump the version".
- Different: one coordinator session owns the plan and branch ownership table; the user prompts once.

### P11. Context overflow noticed by the user, not the agent (~6)
- "since this session context if overfull, dump the open tasks into a graph based plan in multiple markdown files writing-for-agents" (qlc_58c87728, 10-25T20:38).
- "What are the failures? Use subsessions to manage the context better" (qlc_d9c12de3, 10-30T16:59).
- 17 compaction continuations; summary admits "Scratchpad wiped at session restart: lost the captures and the baseline names."
- Global CLAUDE.md already says warn at 50%. Different: a hook or statusline check that triggers the warning; plans in files from the start (the user finally had to ask).

### P12. Sensitive data and scope in a public repo (~4)
- "ok, cut them all off and remove all ids and stuff from all scripts and put them into a .env file that isn't commiteed" (hm_1e6357b1, 2026-10-28T20:11). Summary: images with email/alias were rejected by a sub-session; fixtures needed sanitising.
- "sorry, you have to use playweight MCP with Edge" (hm_1e6357b1): wrong browser tool chosen first (built-in browser, needed sign-in).
- Different: a repo CLAUDE.md saying "public repo: no subscription/tenant IDs, emails or aliases in files or screenshots; IDs live in uncommitted `.env`; use Playwright MCP on Edge".

### P13. Wrong project / wrong goal framing (~3)
- qlc_f2639d11 is a Wi-Fi mesh troubleshooting session started in the qlcplus directory, 20 prompts, with the one explicit interrupt. First message was a pasted assistant reply plus "it's connected in chrome now"; goal ("something is making my mesh and my wifi really slow") came after.
- qlc_c7985954: "fix the bugs with TDD and I think you can remove the preview again, it's not so helpful" (a feature the user asked for 34 minutes earlier, 10-23T22:08 vs 22:42).
- qlc_3e917114: "BUT drag and fling the page is better than click and drag" and mid-turn "I don't think it's a rendering issue, more how it handles touch events".
- Different: for exploratory asks, say "prototype first, decide after" and open in a scratch project dir.

## 3. Standing-instruction candidates

qlcplus project CLAUDE.md (or `.claude/rules/`):
- Fork policy: all QLC+ additions go in fork-owned files/layer, stay mergeable from upstream, prefer upstream's fix. Evidence: P7 quotes (08-22, 07-04, 10-24).
- Branch policy: integration branch `mcp-server`; work on `feat/`/`fix/` worktrees named like the branch; merge into `mcp-server` only when asked; never push; keep user's uncommitted files. Evidence: "dont change any branch" (qlc_1669e00d), "Don't push" button text x3, "Merge into mcp-server" x3.
- After upstream merge or large change: update `MANUAL_REVIEW.md` (5 prompts).
- Review-fix loop: verify each finding with subagents, fix only proven ones red-first, re-review. Evidence: "make sure you verify all iessues with subagents and only fix the ones that proof to be valid" (qlc_58c87728); "please review with an indodependet subagent" (qlc_cd1ae9c8).
- Design bias: simple FSM, type-safe, unidirectional flow; inline functions called from one place. Evidence: qlc_cd1ae9c8 (07-04, 07-06), qlc_58c87728, qlc_c7985954.
- Test evidence: TDD, red first, plus screenshots with visual check and a markdown test report in the repo. Evidence: "follow TDD" (qlc_1669e00d), "full tdd Proof that the bug exists" (qlc_6b0c996c), "plenty of screenshots... check them visually" x2.
- Live run rules (hook or skill): never kill a qlcplus5 you did not start, start with scratch workspace file, back up/restore prefs, never change VDJ settings, keep tracks under 40 s. These live only in memory/summaries today.
- Copilot CLI review recipe (command, models, read-only flags) used in 4 sessions; belongs in a skill.

healthmodels-plus CLAUDE.md:
- Public repo: no IDs/emails/tenant in files, fixtures or screenshots; IDs in uncommitted `.env`. Evidence: 2026-10-28T20:11 prompt.
- Live health models: never Save in designer, restore layout after tests, topology edits only on anbotrai-stability with `demo-*`. These appear only in summaries.
- Tests/install checks use isolated `AZURE_CONFIG_DIR` and `AZURE_EXTENSION_DIR`, never `~/.azure`.
- Browser automation: Playwright MCP with Edge, sign-in done by user. Evidence: "sorry, you have to use playweight MCP with Edge".
- Direct-to-main allowed here; releases via `v*` tag (user said it, but only once).
- After test runs: `git restore '*.svg'` (snapshot churn), user said "Restore them" twice.

Hooks:
- commit-msg: block `Co-Authored-By: Claude` / "Generated with".
- Stop hook for /goal: cap fires, stop after N identical verdicts.
- PreToolUse: deny `pkill`/`killall` of qlcplus5 and VirtualDJ.

## 4. Prompting-template candidates

Smooth sessions had:
- qlc_e368e247 (MCP): scope + evidence rule + process in 3 prompts: "make a evidence oriented plan, e.g. how will you test that is has been implemented? for each item", then "implement it, but iteratively, meaning batch by batch, and then use an indepdendent agent to review it... project should never be in a broken state. keep track in a markdown file."
- qlc_cd1ae9c8 (VDJ beat grid): problem + constraints list + "Don't implement yet", then "please implment!" after agreement; later "make a good plan first that I will review".
- qlc_f22ae184 / qlc_d9c12de3: "first assess and think what would be needed" / "this is just to learn now and explore", then decision cards, then "everything, but use parallel subsession". Few corrections.
- hm_1e6357b1: a bullet list of steps incl. restore and "feel free to make it script based and repeatable".

Rough sessions lacked:
- Acceptance criteria for "done": hm_ac8c0401's goal said "fully checked" but not who merges; 632 hook fires.
- Exclusions stated up front: no IDs in public repo, no branch switching, no push, no git staging.
- Environment facts: VDJ running, safe-to-test window, which browser, which project folder.
- Deliverable list: README screenshots, badges, report location arrived over 5 follow-ups.
- Single-task scoping: qlc_58c87728's first prompt had 8 asks and 2 parallel sessions; qlc_6b0c996c typed workflow into the /code-review "Review target" slot.

Template:
1. Goal and why (one line).
2. Mode: explore-only / plan-then-wait / implement.
3. Deliverables list (files, docs, screenshots, report path).
4. Exclusions (branches, push, kill, real data).
5. Done = checklist the agent proves (tests red-then-green, screenshots viewed, git clean, CI state).
6. Execution: sub-sessions yes/no, independent review yes/no, plan file path.
