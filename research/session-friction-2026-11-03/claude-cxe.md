# Friction analysis B: Desktop-cxe-* sessions (2026-10-21 to 2026-11-02)

Notation: `PORTAL` = AHM-CloudHealth-Portal--2239 (src/portal_tests); `mcp` = mcp repo; `hms` = healthmodel-skills; `waf` = well-architected-pr. Format: `project__sessionId8 MM-DDTHH:MM` (UTC, from the file). Quotes keep original typos.

## 1. Numbers

- Sessions: 52 files read (4 have zero prompts, 7 contain only background-task notifications).
- "Prompts": 1250 lines, but only 383 are human-side (about 300 are real typed text, the rest are screenshots, pasted logs, `<bash-input>`). 867 are machine-injected:
  - 617 `<task-notification>` (Monitor/background events counted as user turns)
  - 110 "Another Claude session sent a message" (71 subagent hand-backs, 39 cross-session)
  - 23 Stop-hook feedback + 2 goal check-ins, 18 compaction continuations, 12 CI-monitor events, 21 skill expansions, 4 review templates, 3 "response cut off" resumes
- Of the 383 human-side prompts (rough, overlapping):
  - ~35 corrections (wrong approach, scope, naming, slop, misread ask)
  - ~30 repeats of an earlier instruction (commit/stage 10, multi-model Copilot review 8+, comments/slop 6, waits/sleep 3, "act like a user" 5)
  - 4 literal "[Request interrupted by user]" (PORTAL__dd4e3691 x2, PORTAL__19f1a04e, PORTAL__766e6471) plus ~6 mid-turn steering messages
  - ~25 verification asks or pasted failures ("work and fix it", "test yourself", "run it against a REAL model", status pings)
  - ~35 harness/environment fights (restarts, cut-offs, compaction, sibling-session collisions, sideload server down, Stop-hook loop, wrong browser tool, auth/token)
  - ~40 one-line approvals ("Yes, implement", "Yes, fix both") that only unblock an option the agent presented
- 18 compactions (PORTAL__945912f6 and PORTAL__dd4e3691: 2 to 4 each).

## 2. Patterns

### P1. Commit/stage/push boundary restated in almost every project (about 10x)
- "dont do any git commit" (PORTAL__0b4fbbe8 10-23T18:08)
- "no commits, never" (PORTAL__945912f6 10-27T19:16)
- "I didn't want you to commit the diagrams, just to show them to me as altearntive" (waf__428c83c0 10-29T10:41)
- Also "please ondt push any changes and don't commit them either" (cloudhealth-ga__9115d33d 10-24T20:15).
- Better: memory file `no-git-staging.md` exists but the user still restates it. A project-level CLAUDE.md line plus a PreToolUse hook denying `git add|commit|push` (user commits himself: "I'll commit and test it on windows", PORTAL__dd4e3691 10-29T15:32) removes it. Exception granted explicitly once (waf 10-29T10:47) shows it needs a per-session override, not a prose rule.

### P2. Wait/sleep/timeout policy had to be taught, then re-taught (about 6x)
- "waiting in terms of sleep or so: not a gooed idea. use playwright supplied tools that check with timeout" (PORTAL__0b4fbbe8 10-23T19:31)
- "never sleep!!!! make it an eslint policy" (PORTAL__0b4fbbe8 summary 10-24T00:43)
- "An interval there I would consider a bad "waitring" pattern" (PORTAL__f478cbe0 10-30T15:29) and "wait, what do you mean by poll? we talk about TIMEOUTs, right?" (10-30T15:26)
- Better: the rule belongs in the test package AGENTS.md and as an eslint rule from day one. The user did ask for eslint policies in the very first prompt; later rules (no `toBeInViewport` 10-28T10:15, no `focus()` 10-30T07:34, no nested retries 10-31T05:42) were each requested one by one after a failure.

### P3. "Act like a real user" principle discovered by failure, not stated up front (about 6x)
- "I don't really want toBeInViewport be used anywhere. Ideally selectors should not be viewport depdencand" (PORTAL__dd4e3691 10-28T10:12)
- "we first need to understand the bigger picture please: * is the test going through the app with browser interaction like a user would?" (10-29T12:56)
- "oh if possible, we don't want ot open blade by urls ever." (10-29T22:46)
- Better: three days of flake fixing (hack per failure) preceded the stated principle. A 6-line "test philosophy" (user actions / portal workarounds / bootstrap; no URL navigation, no focus, no viewport, retries only in leaves) in AGENTS.md at session 1. It finally appeared as the Naur "code theory" prompt on 11-01 (PORTAL__19f1a04e 11-01T00:19).

### P4. Slop comments and prose bloat (about 7x, three projects)
- "you add a lot of blabla and comments and write obvious things or useless details" (PORTAL__945912f6 10-27T19:17)
- "and stop adding the sstupid slop comments everywhere" (PORTAL__dd4e3691 10-29T22:34)
- "comment sentences with smicolon.... can you rewrite them to be just e.g. 2 direct setences?" (mcp__7a8ebd10 11-02T07:09)
- Better: a hook or CLAUDE.md rule: "no comments that restate code; one-sentence max; no semicolon chains; examples over prose". The global CLAUDE.md covers answer style but not code comments or doc prose.

### P5. Scope creep and over-engineering the user had to cut back (about 8x)
- "the whole downstreamFailures and that is overkill for this first version." (PORTAL__dd4e3691 10-29T15:25)
- "no wait!!! ONLY fix whats new in this BRANCH ... NOT THE WHOEL repo" (mcp__7143c302 summary 11-01T12:21; agent had edited NOTICE.txt, reverted)
- "no, don't add to the root. .look, agents know the package.json ... AGENTS.md is enough" (PORTAL__fb93fd84 11-01T21:58)
- "forget the test annotations again" (PORTAL__945912f6 10-27T15:24)
- Better: the agent should state diff scope before editing (the agent apparently fixed repo-wide findings after a branch-scoped review). Put "scope = merge-base..HEAD only" in the review prompt template.

### P6. Bad naming/structure the user had to point at (about 6x)
- "ownModel is suech weird name, also it configures the test" (PORTAL__945912f6 10-27T15:37)
- "announcePortalTarget is also a weird comfabulation.... it's so werirldy done, right?" (10-27T15:38)
- "the code itself reads often like a mess. Not like as if someone deeleivartely chose a domain, terms and actions" (PORTAL__dd4e3691 10-29T22:36)
- Also questions revealing unreadable code: "can you explin clickUntilBlade?" (10-28T08:10), "What do you mean by spare iframe?" (10-30T16:57), "what do you mean by 'Skipped: the three blade-level retries ...'" (PORTAL__945912f6 10-27T12:38).
- Better: naming/domain vocabulary was in the very first prompt ("follow John Ousterhout principles") yet drift persisted; add a glossary of domain verbs to AGENTS.md and ask for a naming pass before running reviews, not after 2 days.

### P7. Agent explained a failure with a confident wrong theory
- "I dont really believe you, to be honest. I suspect it might be something else" (PORTAL__945912f6 10-27T14:05; summary: first "replaced node" explanation was wrong, trace showed click landed in unfiltered list)
- "there a false negative ... the test actually workd" (PORTAL__dd4e3691 10-28T10:07, toBeInViewport)
- "you're flow is wrong in that sense, I think you have to go back a bit to the drawing board." (dd4e3691 summary 10-30T12:03)
- Better: require trace/screenshot evidence before a root-cause claim; the user supplied `trace.zip` by hand. "Find the root cause" (10-29T22:33) needed its own prompt.

### P8. User pastes raw failures and the agent fixes without re-running (about 10x)
- "work and fix it please" + pasted Playwright log (PORTAL__dd4e3691 10-28T11:09)
- "look another thing" + pasted rollup failure (10-28T15:05); "investigate and fix" (10-30T07:28)
- "run it against a REAL model." (cloudhealth-ga__c85817ef 10-24T23:43)
- Also "please do the live validation of the tests" (PORTAL__0b4fbbe8 10-23T20:52), "DONT do any manual commands. stick to the npm run commands" (PORTAL__945912f6 10-27T15:49).
- Better: standing rule "after any fix, run the single failing spec via the npm script, then the full suite, and report pass/fail with the run id" so the user stops being the test runner. Contributing factor: the user's own machine also ran tests (Windows, VS Code worker), see P10.

### P9. Status pings during long autonomous work (about 9x)
- "is the work finished?" then "no do it now" (PORTAL__0b4fbbe8 10-23T22:54)
- "how far are you?" (PORTAL__945912f6 10-27T11:59); "will it be finished soon? what's still open?" (PORTAL__dd4e3691 10-29T15:20)
- "whats the status?" x4 (dd4e3691 10-29T16:14, 10-29T23:08, 10-30T16:55; mcp__f2a89d33 summary); "show where it's at and why it's taking so long" (10-29T15:53)
- Better: agent ends turns waiting on a timer or sibling ("schedule a check every 15mins"); instruct "never end a turn while a run is pending; report the next checkpoint".

### P10. Shared state collisions between parallel sessions and the user
- Sibling sessions shared worktree, Edge profile, test-results (PORTAL__0b4fbbe8 / c92d1c5e, 10-23T23:07 to 10-24T08:11); `ProcessSingleton` lock (dd4e3691 summary 10-28T12:32).
- User had to stop agent runs: "can you stop all tests, so I can run them?" (PORTAL__945912f6 10-27T15:26); "(dont run anything, I'm running the tests currently)" (summary); "somehow it was running now in multiple workers" then "make limited to 1 worker again plaaese" (PORTAL__fb93fd84 11-01T22:29, 11-02T04:14).
- Better: a repo-level single-run guard (the agent's ad-hoc `pgrep` guard was buggy, summary 10-30T16:47) and a preflight that fails fast when the sideload server (:1339) is down; the user restarted it 3 times ("It's back up", dd4e3691 10-29T13:24).

### P11. Open-ended /goal Stop hook produced a 25-turn forced loop
- mcp__f2a89d33 10-30T15:36 to 10-30T22:34: 23 "Stop hook feedback" turns for the condition "...but also cotnously find more improvements and work closely with the research sessions". Each said the condition "requires an ongoing process" so it could never be met.
- Afterwards the user asked "So….its not better?" (summary 10-30T22:45).
- Same pattern in cloudhealth-ga__9115d33d 10-24T18:41: goal condition mixed a work item with an open question ("does the az extension support custom repos?").
- Better: goals must be a checkable end state with a stop rule ("until board shows >=1.3x vs baseline and tests green"); questions go outside the hook condition.

### P12. Iterating a domain concept through the agent instead of fixing the spec (hms, 9 rounds in 2 days)
- "by chance it seems that user flows and system flows map one to one Thisis form a misundertanding" (hms__98b2d277 10-22T10:10)
- "it's not quite there yet" (10-22T11:06); "only very little is missing now but it needs a discintice change" (10-22T14:01)
- Recurs in a new project: "a userflow should be somethign the user understands. not framework names" (hms__d50c7d51 10-27T22:31)
- Better: write one worked example of the target model (entity names, parent/child rules, "no entity with a single child") into the skill/eval spec first, then grade against it. User later did exactly this ("Add this project to the evaluations").

### P13. Tool/harness mismatches
- Wrong browser: "feel free to use playwirght MCP", "no, not claude-in-chrome", "Playwright MCP" (PORTAL__dd4e3691 10-29/10-30 summary + 10-29T16:01); built-in pane: "the browser view barely shows anything", "I don't see it" (PORTAL__0b4fbbe8 10-23T20:43 to 20:46).
- Cut-offs and restarts: "Your response above was cut off mid-stream" (3x), "Try again" (4x), "I had to restart, please pick the work up" (PORTAL__945912f6 10-27T11:29), "The app was quit while you were working." (mcp__f2a89d33 10-30T09:20).
- CS9007 raw-string errors recurred across 5 research sessions (summaries) with no shared note.
- Secret handling: user pasted an OpenAI key into chat (mcp__f2a89d33 summary 10-30T11:44); later "I have the openai key somewhere in a .env file".
- Better: put "Playwright MCP (not claude-in-chrome); one run at a time; sideload server must be up" and the C# raw-string `$$$` gotcha in project notes.


## 3. Standing-instruction candidates

| Rule | Evidence | Home |
|---|---|---|
| Never stage/commit/push/amend unless told; user commits | P1 quotes; "no commits, never"; "please ondt push any changes" | Hook (PreToolUse deny on git add/commit/push) plus CLAUDE.md |
| Run tests yourself via `npm run ...`, never manual commands; re-run failing spec after each fix | "DONT do any manual commands. stick to the npm run commands" (PORTAL__945912f6 10-27T15:49); "you have to run them with npm run test" (10-27T10:14) | portal_tests AGENTS.md |
| No sleeps, no polling intervals; use Playwright auto-wait with `retrying` leaves only; warn on retry | P2 quotes; "Retry only in leaves" (PORTAL__19f1a04e 10-31T05:53); "if it fails and has to retry, that should also be a warning" (summary 10-30T16:47) | ESLint rules + AGENTS.md |
| Tests act like a user: no URL blade open, no `focus()`, no viewport assertions, helpers never in the spec, keyboard only where stable | P3 quotes; "helpers should never be with the spec" (10-29T22:45); "can we have a rule to not use "focus" since that's not a user action?" (10-30T07:34) | AGENTS.md + eslint |
| One Playwright worker / one run at a time per profile | "make limited to 1 worker again plaaese" (PORTAL__fb93fd84 11-02T04:14); "can you stop all tests, so I can run them?" | playwright.config + AGENTS.md |
| Code review via Copilot CLI: 3-4 strong different models, treat as grain of salt, verify each finding, focus on structure/logic/facts, not prose | "take the review with some grain of salt, right? verify deeply" at PORTAL__0b4fbbe8 10-24T19:35, cloud-adoption-framework-pr__db37f34f 10-24T19:47, caf-to-ahm__c6b34fbf 10-24T19:52, PORTAL__55c8ac79 11-01T21:57; "Rubberduck wtih 3 copilot cli" (mcp__7143c302 11-01T09:10) | Skill (`copilot-review`) with the model list and verify step |
| No restating comments, no semicolon chains, short READMEs without rule dumps; examples over prose | P4 quotes | CLAUDE.md (code-comment section) |
| Use real sub-sessions (not background tasks) for investigate/implement splits; scale effort per subsession | "make good use of subsession and adapt the effort" (PORTAL__dd4e3691 10-29T13:03); "can you use real sub sessions instead of background tasks?" (mcp__f2a89d33 10-28T23:56) | CLAUDE.md |
| Ask clarification questions with the ask-user tool, not in prose | "for future quetion, use the ask user tool" (cloud-adoption-framework-pr__db37f34f 10-23T21:49); "ask all questions interactively with enough simple context" (caf-to-ahm__c6b34fbf 10-24T11:44) | CLAUDE.md |
| Analysis requests are read-only until told | "dont change anything yet" (PORTAL__f478cbe0 10-30T13:48), "don't change anything yet, but create a table" (waf__428c83c0 10-29T08:16), "(hold off with fixes)" (mcp__7a8ebd10 11-02T07:06), "don't just change and do stuff" | CLAUDE.md |
| Doc PRs: link official AHM docs instead of restating; minimal edits; use official terms | "better link to existing official AHM docs than repeating large topics" (waf__428c83c0 10-29T09:30) | CAF/WAF repo CLAUDE.md |
| Review scope = branch since merge-base only | "ONLY fix whats new in this BRANCH ... NOT THE WHOEL repo" | Review prompt template |

## 4. Prompting-template candidates

Smooth sessions (first prompt contained):
- PORTAL__0b4fbbe8 10-23T17:12: goal ("complete rewrite"), 8 concrete bullets (dedicated Edge profile, Deployment Stacks setup/destroy, "no single use wrapper, no overengineering", "don't create any offline tests", eslint policies), permission to run and deploy "with the rewritten code and not manually", named principles (Ousterhout, Grokking Simplicity), and "ask me more questions". The agent asked 9 questions, user answered "1 a and b ... 9 a". Only 2 corrections in the first hour ("dont look at files in the parent folder", "dont do any git commit").
- mcp__d792a28c 10-24T22:32: situation ("a bit a mess"), 3 variants named, success metric ("LLM efficiency", "READ only"), end state ("settle on one method"), tooling (Copilot CLI strongest models, ponytail), process (sub sessions). Later added the AOT/real-PR constraint late ("keep in mind that it has to be possible to become a real MCP PR"), which cost a rewrite (GraphQL parked 11-01T00:39).
- waf__428c83c0 10-29T08:16: input source named (PR comments), explicit read-only ("don't change anything yet") and output form ("create a table with inputs and why").

Rough sessions (missing):
- No acceptance criteria / definition of done: "make sure to have a clean and fully working version. I go now and eat something" (PORTAL__945912f6 10-27T16:05) and "is the work finished?" (PORTAL__0b4fbbe8). Add "done = `npm run test` green 3 consecutive times, 0 warnings, N lines fewer".
- Design principles stated after the code existed (P3, P6): include the "code theory" (user actions / portal workarounds / bootstrap) and naming rules in the first prompt or AGENTS.md.
- Domain concepts not specified (hms user flow vs system component, 9 rounds): include one concrete target example and a counter-example ("not framework names").
- Constraints discovered mid-flight: AOT-compatible, read-only Azure, "don't push" (mcp__f2a89d33), "only this branch" (mcp__7143c302). Put a constraints block (push policy, Azure write policy, scope, tools to use, test runner, forbidden patterns) at the top of every first prompt, or in the repo CLAUDE.md so it survives compaction (18 compactions; "I had to restart, please pick the work up").
- Goals phrased as endless loops (P11). Replace with an exit criterion.
- Decisions left open: model-creation strategy flip-flopped az -> wizard -> "only for delete" (PORTAL__945912f6, summary 10-27T13:35); decide it in the first prompt.

Skeleton: Goal / Definition of done (commands, thresholds) / Constraints (commit, push, scope, read-only) / Principles / Tools / Process / Do-not list.
