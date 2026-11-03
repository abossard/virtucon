# Harness and self-improvement research, 2026-11-03

What the field published since mid-2026 on agent harnesses, self-improving skills and verified memory, read against minime's round-3 evidence (`docs/autoresearch.md`) and the v8 decisions. Four web sweeps, primary sources where they exist; items marked (abstract) were read from the arXiv abstract only, (secondary) from a write-up of the source. This folder holds findings and a proposal, not an implementation.

The brief: keep minime light and fun, simple, made for strong agents.

## What the evidence says, in one screen

- The harness moves cost more than accuracy. Three studies find the simplest scaffold ties or wins on pass rate and differs by up to 40x on tokens (Scaffold Effect, Harness or Model, a 7-harness shootout). With 80 tasks the confidence interval is about ±9 points, so 9 tasks cannot separate accuracy; cost can be measured.
- Self-judged progress is a mirage. Loops gated on the agent's own verdict claimed improvement in every cycle while 56% had zero or negative real delta; the best in-band judge accepted 44% regressions. Where success was checkable from the artifact the mirage was zero (arXiv 2607.25152). Agents report done in 45 to 76% of their failures and no LLM judge beats 0.65 AUROC on that (arXiv 2606.09863). Round 3 saw the same: 13 runs resolved while the flow said failed, 8 said done while hidden tests fail.
- Skills are neutral on average with a fat downside. 92 of 98 public skills had no significant effect; best +17.7, worst -17.0 points, because skills anchor the agent on their template and override the task (SWE-Skills-Bench). Skills that win do so by regressing less, adding grounding and verification rather than procedure (Regression Tax). Skill optimizers gain +4.9 points, within run variance (Skill Issue, GEPA).
- Self-improving harness loops work only with a fixed, read-only evaluator, a held-out regression gate and pruning of edits (Self-Harness, AHE, RRSI, Karpathy's autoresearch, Prolific's replication where single-run keeps never reproduced). Every edit in AHE carries a prediction checked next round. Gains came from tools, middleware and memory, never from the system prompt.
- Memory helps only when verified. Copilot stores each memory with code citations, re-checks them against the branch on read and refreshes the timestamp on pass; PR merge rate 90% vs 83%. Insight-level lessons beat raw traces, which hurt (Memory Transfer Learning). VibeMemBench stays the baseline: 11 of 12 agent-built memories gained nothing.
- Failures are epistemic and early. Annotated CLI trajectories fail on wrong beliefs formed in the first steps and hidden until recovery is impossible (Failure as a Process). Fail-to-fail reproduction tests mislead agents (SWE-Doctor).
- Planning mostly saves strong models cost, not accuracy; bash-only tools match rich tool sets for bash-capable models (Fan et al., 176 matched settings). Anthropic removed sprints, per-sprint evals and context resets from its app-building harness once the model got stronger, keeping a planner and one end-of-run evaluator.
- A reasoning sandwich (high effort to plan and verify, lower to build) gave most of a 52.8 to 66.5 gain on Terminal Bench 2.0 in LangChain's harness post; the other middleware was not isolated.

## Proposal: what to add

Ranked by fit: mechanical, a few lines, measurable in a round. Each names the round-3 symptom it answers.

1. **Fuel gauge.** The conductor takes `--requests <n>` and `--minutes <n>` caps; when a run crosses one it ends as `stopped: budget` and grades what is there. The board draws the gauge next to the scores it already counts. Round 3: one run asked 60 times; a cancelled run often already holds a passing patch (22 of 81 in Harness or Model). About 20 lines in `conductor/flow.mjs`; no skill text.
2. **Done is computed, never reported.** The run's final status comes from the proof board alone: every criterion names a test file, inspect's own test run is green, findings `None.`, ratchet clean. A worker's `status` only says what to do next. Round 3: the flow's status was a poor predictor; progress mirage and false-success papers say why. The `proven` score exists; make it the definition. Small change in `flow.mjs`, one sentence in ORCHESTRATION.md.
3. **Baseline run first.** Replicate's first action is the project's test command on untouched HEAD, returned as `[ran: <suite> on HEAD → 73/0]`. Inspect compares its run against that line instead of archiving HEAD itself. Catches a wrong test command, a broken environment and flaky tests before any belief forms (Failure as a Process). One paragraph moves from inspect to replicate.
4. **Reading verifies.** A worker that cites a wiki rule has opened its cited code (the blueprint skill already demands this). Extract reads the blueprint's `research:` brackets and sets `LastVerified` on those pages; a worker whose check contradicts the rule returns it as `stale_rules`, and extract marks the rule stale. Pages that get read stay, pages nobody reads retire on the 60-day timer as now. Copilot's verify-on-read memory is the model (90% vs 83% merge rate). One field in the return contract, one harvest line in extract.
5. **Cost is a score.** The round table carries premium requests and minutes per arm, and the decision rule adds: at equal majority resolve, the cheaper arm wins. The board already counts both. Nine tasks cannot separate accuracy; they can separate cost. A line in `docs/autoresearch.md`.
6. **Every variant predicts.** Before a round, a variant names the pool tasks it expects to flip and why; the table marks each prediction held or missed. A variant whose misses outnumber its hits is not applied, whatever the total. From AHE; it also makes the record read like a lab notebook, which is the fun part. Zero code.
7. **One removal arm per round.** Each round carries an arm that removes a flow part (the ratchet, realistic inputs, extract) to test whether a strong model still needs it. Anthropic's harness pruning and Fan et al. say the answer changes as models improve. Zero code, a rule in `docs/autoresearch.md`.
8. **Reasoning sandwich as an arm.** Blueprint and inspect at high reasoning effort, replicate at the default, through `reasoningEffort` in the Copilot agent files and `effort` in Claude skill frontmatter. One line per phase, run as an arm, not applied by default: minime leaves model settings to the user.
9. **Trigger check on Claude Code.** An `evals/` folder with four cases for `claude plugin eval`: "plan this" triggers blueprint, "check this against the blueprint" triggers inspect, Dr. Evil dispatches instead of editing. Graders `tool_used: Skill` and `file_exists`, no LLM judge. Cheap and Claude-only; minime's real measure stays the Copilot kit.

## What not to add, with the evidence

- A skill optimizer (GEPA, SkillOpt, Skill Issue): +4.9 points on one repo, inside run variance; needs many rollouts.
- A reviewer-plus-critic chain: Adversarial Review isolates no fresh-context effect; in one tool 164 of 177 fresh-context review passes changed no file. Frau stays one fresh inspector that reports evidence.
- A memory system or trace store: VibeMemBench, Memory Transfer (raw traces hurt). The wiki already keeps insight-level rules with receipts.
- An LLM judge as a gate anywhere: progress mirage, false success. Gates stay mechanical: tests, coverage, ratchet counts.
- Agent-written instruction files: the AGENTS.md study holds; Probe-and-Refine helps only when the file is tuned against hidden probes, which is the kit's job, not a worker's.
- Process pages, groups, splits: rounds 2 and 3 measured no effect; parked by the v8 decision.
- More skill prose: the Regression Tax finding says skills win by regressing less. The lean format is the right direction; shorten rather than extend.

## Host features worth leaning on (no code)

- Copilot `subagentStop` hook returns `decision` and `reason`: it could reject a worker reply that lacks the JSON block before the conductor sees it. Copilot `preToolUse` already carries the git and GitHub denials.
- Copilot dynamic workflows (public preview, Oct 2026) are the host's native conductor: steps in code, structured results between stages, checkpoints. Watch it; move `minime.mjs` there only once it leaves experimental.
- Copilot `/chronicle improve` lists the places where the user corrected Copilot. Extract's red pen can take that list as a raw source.
- Claude Code `/skill-doctor` shows context cost per skill once; run it to see which minime skill costs most.
- Claude Code subagents offer `omitClaudeMd`; not for Frau, because the authority order keeps repository instructions above the request.

## Sources

Harness design

- Fan et al., An Empirical Study of Harness Design for Coding Agents, arXiv 2609.20804 (abstract).
- Arjmandi, Harness or Model?, arXiv 2609.11987.
- Vats and Golev, The Scaffold Effect, arXiv 2607.22585.
- Garay, 7-harness shootout on MiniMax-M3, https://efraingaray.com/en/blog/arneses-agentes-minimax-terminal-bench/ (single author, 39 tasks).
- Lewis, Same Model, Different Harness, arXiv 2608.26218 (abstract).
- Harness Engineering: eleven systems, arXiv 2609.00006.
- LangChain, Improving Deep Agents with harness engineering, https://www.langchain.com/blog/improving-deep-agents-with-harness-engineering (Feb 2026).
- Anthropic, Harness design for long-running apps, https://www.anthropic.com/engineering/harness-design-long-running-apps (Mar 2026).
- Failure as a Process, arXiv 2607.09510.
- SWE-Doctor, arXiv 2607.00990.
- Ask or Assume?, arXiv 2603.26233.

Self-improvement loops

- Self-Harness, arXiv 2606.09498 (abstract).
- Agentic Harness Engineering, arXiv 2604.25850; Lilian Weng's note on its read-only evaluator, https://lilianweng.github.io/posts/2026-07-04-harness/.
- Regularized Recursive Self-Improvement, arXiv 2609.24972 (abstract).
- Meta-Harness, arXiv 2603.28052 (abstract).
- Does harness evolution beat simple test-time scaling?, arXiv 2607.12227 (abstract).
- Task-CoEvolve, arXiv 2608.20169 (abstract).
- Predict Before You Modify, arXiv 2610.13991.
- Park and Choi, progress mirage in self-evaluating loops, arXiv 2607.25152.
- Advani, false success detection, arXiv 2606.09863.
- Prolific, autoresearch HITL experiment, https://huggingface.co/blog/ProlificAI/autoresearch-hitl-experiment.
- Ariño de la Rubia and Pafka, run-to-run variance, arXiv 2609.33812.

Skills

- SWE-Skills-Bench, arXiv 2603.15401.
- The Regression Tax, arXiv 2607.22520 (abstract, office benchmarks).
- Skill Issue: optimizing repository SKILLs, arXiv 2609.12742.
- GEPA gskill, https://gepa-ai.github.io/gepa/blog/2026/02/18/automatically-learning-skills-for-coding-agents.
- Anthropic, Improving skill-creator, https://claude.com/blog/improving-skill-creator-test-measure-and-refine-agent-skills.
- Claude Code plugin evals, https://code.claude.com/docs/en/plugin-evals.

Memory

- GitHub, Building an agentic memory system for Copilot, https://github.blog/ai-and-ml/github-copilot/building-an-agentic-memory-system-for-github-copilot/.
- Memory Transfer Learning, arXiv 2604.14004 (abstract).
- MemGuard, arXiv 2608.21867 (abstract).
- Probe-and-Refine, arXiv 2606.20512.

Host docs

- Copilot hooks, https://docs.github.com/en/copilot/reference/hooks-configuration; custom agents, https://docs.github.com/en/copilot/reference/custom-agents-configuration; dynamic workflows, https://github.blog/changelog/2026-10-01-dynamic-workflows-in-copilot-cli-and-the-copilot-app; chronicle, https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/chronicle.
- Claude Code hooks, https://code.claude.com/docs/en/hooks; subagents, https://code.claude.com/docs/en/sub-agents; skills, https://code.claude.com/docs/en/skills.

Not verified: `/chronicle skills`, the Copilot canvas API, Factory's Terminal-Bench harness table (vendor), the multi-agent degradation figures quoted in secondary posts.
