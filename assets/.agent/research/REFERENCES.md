# Research Basis

The agent flow in this repo is not arbitrary. Each design decision traces to empirical work. The two load-bearing sources are summarised here; the rest are listed for traceability.

## Primary sources

### DeepMind: Human-AI Complementarity: A Goal for Amplified Oversight (2025)
arXiv:2510.26518 · https://arxiv.org/abs/2510.26518
Jain, Bridgers, Janzer, Greig, Teh, Mikulik (Google DeepMind).

Findings used by this flow:
- Confidence-based hybridization: route high-confidence cases to the AI, low-confidence cases to humans. Beat AI-alone and human-alone overall (89.3% vs 87.7% AI-alone on their eval set). -> our risk-tiered single gate.
- Presentation format determines reviewer accuracy. Showing the AI's judgments / labels / confidence caused measurable OVER-RELIANCE: assisted reviewers did worse than unassisted ones on cases where the AI was wrong.
- Showing only raw evidence (search results + selected quotes) was the single form of assistance that "helps when correct and does not hurt when wrong." -> the review skill forbids verdicts; it ships an evidence package only.
- Benefit of assistance shrinks for skilled reviewers; the naive "show everything incl. confidence" format actively hurt them. -> keep the agent surfacing evidence, not adjudicating.

### Springer AI & Ethics: Designing meaningful human oversight in AI (2026)
https://link.springer.com/article/10.1007/s43681-026-01147-7

Findings used by this flow:
- Layered agency: AI holds operative agency (task execution), humans hold evaluative agency (verification, steering, substitution). -> the flow's shape.
- Exploit the solve-verify asymmetry: design AI outputs so humans can check and contest them WITHOUT re-solving the task. -> small scoped diffs, pasted real test output, stated assumptions instead of conclusions.
- Accountability: sampling, escalation bundles, audit trails make both detections and dismissals reviewable. -> the corrections wiki is the audit trail; cited entries make decisions reviewable.

## Supporting empirical studies

- ClassEval Waterfall ablation (2025), arXiv:2511.09794. Over-structured multi-agent waterfalls did not reliably improve correctness; testing had the largest positive effect. -> one gate, tests front-loaded.
- Enhancing LLM Code Generation: Multi-Agent Collaboration and Runtime Debugging (2025), arXiv:2505.02133. Execution-grounded debug loops outperformed conversational review loops. -> the implement loop.
- AgentCoder (2024), arXiv:2312.13010. Specialized roles improved pass@1 when tightly coupled to executable test feedback. -> selective role specialization.
- LLMs Get Lost in Multi-Turn Conversation (2025), arXiv:2505.06120. Multi-turn degradation driven by unreliability, not aptitude loss. -> collapse stages, refresh context.
- Context Rot (Chroma Technical Report, 2025), https://research.trychroma.com/context-rot. Performance degrades as input length grows. -> concise context windows, fresh context for large steps.
- Memory for Autonomous LLM Agents (2026), arXiv:2603.07670. Formalizes memory as write-manage-read loop. -> harvest memory policies.
- ExpeL/ERL (arXiv:2603.24639). Concatenating all insights scales poorly; score for relevance and consolidate. -> harvest consolidation, plan relevance-scoring.
- Bacchelli & Bird, "Expectations, Outcomes, and Challenges of Modern Code Review" (ICSE 2013). Review is primarily about understanding, not defect detection. -> evidence-focused review.
- Fagan, M.E., "Design and Code Inspections" (IBM Systems Journal, 1976). Structured exit-criteria inspection outperforms ad-hoc review. -> traceability table approach.
- McAleese et al., "LLM Critics Help Catch LLM Bugs" (2024), arXiv:2407.00215. Evidence-anchored critique format outperforms human review in hybrid teams. -> evidence package format.
- Porter, Votta & Basili, "Comparing Detection Methods" (IEEE TSE, 1995). Checklist-based review outperforms ad-hoc. -> structured review process.
- TDAD: Test-Driven Agentic Development (2026), arXiv:2603.17973. Targeted test/code-impact context cut regressions from 6.08% to 1.82%; generic procedural TDD instructions raised regressions to 9.94%; issue resolution improved from 24% to 32%. -> `skills/replicate/SKILL.md` test-scope classification: select tests by code/test impact analysis first, directory/module colocation only as fallback.
- Fostering Appropriate Reliance on Large Language Models: The Role of Explanations, Sources, and Inconsistencies (CHI 2025), arXiv:2502.08554, DOI 10.1145/3706598.3714020. Preregistered N=308 experiment: explanations raised reliance on both correct and incorrect responses; sources or visible inconsistencies lowered reliance on incorrect responses. -> `skills/inspect/SKILL.md` evidence package: cite this paper in Empirical basis and surface inconsistencies/contradictions as a distinct evidence-package item.
- Memora: From Recall to Forgetting: Benchmarking Long-Term Memory for Personalized Agents (ACL 2026 Findings), arXiv:2604.20006. Four LLMs and six memory agents frequently reused invalid memories and failed to reconcile evolving ones; adding memory agents only marginally improved this. -> `skills/blueprint/SKILL.md` step 7: tag each cited wiki entry `active` / `stale` / `superseded` against live code.

## 2026 harness and oversight research

- Agent Scaffolding Beats Model Upgrades (Particula, April 2026). Same LLM scored 42% and 78% on SWE-bench depending solely on agent scaffolding; swapping models produced <1.3 point deltas. Harness optimization is 10-20x more impactful than model upgrades. -> validates the four-phase flow as the high-leverage artifact.
- APA study on AI over-reliance (April 2026). Passive acceptance of AI recommendations diminishes confidence and ownership; active review of evidence maintained both. -> independent validation of evidence-only review.
- International AI Safety Report 2026 (Bengio et al.). Recommends mandatory evidence review steps in AI-assisted workflows. -> converges with our inspect design.
- OneFlow: Rethinking Multi-Agent Workflow (Xu et al., arXiv:2601.12307, Jan 2026). Single iteratively-prompted LLM matches homogeneous multi-agent pipelines. Multi-agent overhead justified only when agents use different models/tools/permissions. -> frau fork kept for bias removal (fresh context), not role specialization.
- AlphaEvolve (DeepMind, May 2026). Uses evidence-based filtering internally for code generation. -> further validation of evidence-anchored review.

## Proof-first design (October 2026)

Several figures below come from abstracts or secondary coverage; the links point to the primary source where one exists.

- SlopCodeBench (Orlanski et al., arXiv:2603.24755, NeurIPS 2026), https://arxiv.org/abs/2603.24755. Agents that extend their own code get more verbose and more eroded in about three quarters of trajectories; quality prompts cut the initial slop by up to a third without changing the rate of decay. -> the diff ratchet in inspect (interfaces outside the Boundaries, single-caller functions, copied blocks) instead of more prompting.
- GitClear, The Maintainability Gap (2026, vendor report), https://www.gitclear.com/the_ai_code_quality_maintainability_gap. Duplicated blocks per million lines up 81% since 2023; moved (refactored) lines down to 3.8%; error-hiding constructs up 47%. -> `blueprint.mjs diff` reports copied blocks; replicate forbids guards for inputs no criterion mentions.
- METR, Recent Frontier Models Are Reward Hacking (June 2025), https://metr.org/blog/2025-06-05-recent-reward-hacking. Models edit tests and scoring code to raise scores. -> inspect runs the tests itself and checks that each test asserts what the criterion text says.
- ImpossibleBench (Zhong, Raghunathan, Carlini, arXiv:2510.20270), https://arxiv.org/pdf/2510.20270. Agents exploit tests that conflict with the spec; read-only tests and an explicit way to report the conflict cut cheating sharply. -> replicate stops and reports instead of improvising; findings compare code with the blueprint text.
- SWT-Bench (arXiv:2406.12952, NeurIPS 2024), https://arxiv.org/pdf/2406.12952. Generated reproduction tests double the precision of SWE-agent's fixes. -> a bug starts with a reproduction test; blueprint records the reproduction as its first `ran:` decision.
- Agentic Property-Based Testing (Maaz, DeVoe, Hatfield-Dodds, Carlini, arXiv:2510.09907), https://arxiv.org/abs/2510.09907v1. Found real bugs in NumPy and pandas, but only 56% of reports held up; realistic inputs are the filter. -> inspect runs realistic inputs at each boundary and ignores inputs that break unstated preconditions.
- Mutation-Guided LLM-based Test Generation at Meta (arXiv:2501.12862, FSE 2025), https://arxiv.org/pdf/2501.12862. Tests aimed at concrete, currently undetected faults were accepted by engineers 73% of the time. -> findings must be concrete: a failing test, a failing input or a quoted deviation.
- RevMate, LLM review comments in practice (Mozilla and Ubisoft, arXiv:2411.07091), https://www.mozillafoundation.org/en/research/library/impact-of-llm-based-review-comment-generation-in-practice-a-mixed-open-closed-source-user-study/. Reviewers accepted about 8% of generated comments. -> opinions are not findings; reviews report executable evidence or deviations from the blueprint only.
- Cognition, Don't Build Multi-Agents (June 2025) and Multi-Agents: What's Actually Working (April 2026), https://cognition.com/blog/dont-build-multi-agents, https://cognition.com/blog/multi-agents-working. Parallel writers fail; several agents work when writes stay single-threaded. -> one writer per file; parallel replicate groups only on disjoint files and fixed interfaces.
- mini-SWE-agent, https://github.com/SWE-agent/mini-swe-agent, and The Devil Is in the Interface (Microsoft Research, arXiv:2608.11386), https://www.microsoft.com/en-us/research/publication/the-devil-is-in-the-interface-evaluating-how-tool-architecture-shapes-coding-agent-behavior/. A minimal scaffold comes close to heavy ones; the tool interface alone changed token use by about half. -> the conductor runs the flow as plain code and keeps the model inside the phases.
- Chroma, Context Rot (July 2025), https://research.trychroma.com/context-rot. Output gets less reliable as input grows, well before the window fills. -> fresh workers per phase and a 4 KB size goal for the blueprint (a warning, not a gate).
- Evaluating AGENTS.md (Gloaguen et al., arXiv:2602.11988, ICLR 2026), https://iclr.cc/virtual/2026/10021235. LLM-written context files lowered task success and raised cost by more than 20%; minimal human-written ones helped slightly. -> workers don't write rules into AGENTS.md; lessons go to the verified wiki.
- Agentic Context Engineering (arXiv:2510.04618, ICLR 2026), https://arxiv.org/abs/2510.04618v2. Rewriting an evolving playbook collapses it; small structured deltas keep the details. -> extract changes one rule at a time.
- VibeMemBench (arXiv:2609.23570), https://arxiv.org/pdf/2609.23570. Memory that agents build from their own history mostly failed to beat no memory; verified experience helped and cut steps. -> a wiki rule needs a receipt: a test, a command with its output, or the user's words.
- Karpathy, LLM Wiki (April 2026), https://venturebeat.com/data/karpathy-shares-llm-knowledge-base-architecture-that-bypasses-rag-with-an. Raw sources, a compiled wiki and a schema, with health checks. -> the raw/wiki/schema layers and the health check that retires unused pages.
- A Few Pages of Markdown (arXiv:2608.25241, ASE 2026), https://arxiv.org/pdf/2608.25241. Repositories that commit a modest set of rules saw a smaller quality cost after adopting coding agents (correlational). -> a small, curated wiki rather than none or a large one.

## Decision theory references

- Howard, R. A. (1966), *Information Value Theory*, IEEE SSC-2(1), 22–26. -> VOI gating.
- Raiffa & Schlaifer (1961), *Applied Statistical Decision Theory*. -> benefit-vs-cost framing.
- Simon, H. A. (1955), *A Behavioral Model of Rational Choice*, QJE 69(1), 99–118. -> decision hygiene.
- Ellsberg, D. (1961), *Risk, Ambiguity, and the Savage Axioms*, QJE 75(4), 643–669. -> decidable vs undecidable.
- Dietvorst et al. (2015), *Algorithm Aversion*, Management Science. -> evidence over authority.
- Logg et al. (2019), *Algorithm Appreciation*, OBHDP 151, 90–103. -> calibrated confidence.

## Engineering references (not controlled studies)

- Ousterhout, [Writing Comments](https://web.stanford.edu/~ouster/cgi-bin/cs190-spring16/lecture.php?topic=comments), author-published CS190 notes (2016), and Nygard, [Documenting Architecture Decisions](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions) (2011). Non-obvious information, context, and consequences belong in documentation; recoverable details can remain behind references. [Diataxis](https://diataxis.fr/explanation/) separates explanation from reference and instructions. Practitioner guidance, not a measured agent-performance gain. -> blueprint's plan-writing and document-review instructions.
- Ousterhout, [A Philosophy of Software Design vs Clean Code](https://github.com/johnousterhout/aposd-vs-clean-code/blob/main/README.md), first-party discussion (2024-2025). Deep modules hide substantial behavior behind simple interfaces; excessive decomposition adds caller knowledge. -> ousterhout-review.
- Parnas, [On the Criteria To Be Used in Decomposing Systems into Modules](https://www.cs.colostate.edu/~france/CS314/Readings/Parnas-decomposition.pdf), CACM (1972), DOI 10.1145/361598.361623. Worked design argument for hiding difficult or changing decisions, not a controlled study. -> responsibility ownership and change locality.
- Normand, *Grokking Simplicity*, Manning: [classification](https://livebook.manning.com/book/grokking-simplicity/chapter-3), [calculations](https://livebook.manning.com/book/grokking-simplicity/chapter-4), [copy-on-write](https://livebook.manning.com/book/grokking-simplicity/chapter-6), [defensive copying](https://livebook.manning.com/book/grokking-simplicity/chapter-7). Available chapter excerpts and [author definitions](https://ericnormand.me/podcast/what-is-an-action) support data/calculations/actions and immutable shared values. -> simplicity-review.
- [Dependency-cruiser](https://github.com/sverweij/dependency-cruiser), [Import Linter](https://import-linter.readthedocs.io/en/stable/), and [ArchUnit](https://www.archunit.org/userguide/html/000_Index.html), first-party documentation. Dependency graphs and declared architecture checks provide language-specific evidence; they do not select responsibility owners. -> project-appropriate evidence in ousterhout-review.
- Chidamber and Kemerer, [A Metrics Suite for Object Oriented Design](https://doi.org/10.1109/32.295895) (1994); Martin, [OO Design Quality Metrics](https://www.linux.ime.usp.br/~joaomm/mac499/arquivos/referencias/oodmetrics.pdf) (1994); McCabe, [A Complexity Measure](https://doi.org/10.1109/TSE.1976.233837) (1976). Counting units and metric assumptions differ; none establishes a universal design score. -> conditional metric interpretation.
- Bernhardt, [Functional Core, Imperative Shell](https://www.destroyallsoftware.com/screencasts/catalog/functional-core-imperative-shell) (2012), author description. Calculations produce values that an effectful shell acts on. Practitioner pattern, not agent-performance evidence. -> private decision logic within existing owners.
- MacCormack, Rusnak, and Baldwin, [Exploring the Structure of Complex Software Designs](https://www.hbs.edu/ris/Publication%20Files/05-016.pdf), working paper 05-016, published in Management Science (2006), DOI 10.1287/mnsc.1060.0552. Exploratory two-product study: Mozilla's redesign reduced potential propagation from 17.35% to 2.78%. This measures dependency reach, not maintenance hours. -> source-grounded boundary comparisons.
- GitHub Copilot agentic memory (2026), https://github.blog/ai-and-ml/github-copilot/building-an-agentic-memory-system-for-github-copilot/. Repo-scoped, citation-verified memories. -> wiki design.
- Karpathy, "LLM Wiki" pattern (2026 gist). Persistent markdown wiki with incremental maintenance. -> wiki-as-artifact shape.

## Practitioner heuristics (internal observations, not empirical)

- Instruction attenuation / constraint re-injection: observed pattern where rules applied early in a loop lose substance mid-loop. Now supported by LLMs Get Lost in Multi-Turn Conversation (arXiv:2505.06120, cited above): multi-turn degradation driven by unreliability is consistent with rules losing substance mid-loop. -> re-injection in the implement skill.
- "Forget-Me-Not" label is a practitioner shorthand, not a published finding.

## Interpretation notes (for workflow decisions)

- Evidence for **context-rot / long-context degradation** is strong and replicated across multiple setups (arXiv + independent technical report).
- Evidence for **multi-agent/subagent gains** is mixed: some role-specialized patterns improve outcomes (e.g., AgentCoder), while over-structured waterfalls can hurt correctness (ClassEval Waterfall).
- The workflow consequence is pragmatic: use subagents selectively for large independent reasoning steps, keep reviewer isolation via fresh context, and avoid adding process stages that are not tied to executable evidence.

## Policy mapping (research -> implementation)

1. **Write filtering / scoring**  
   - Sources: arXiv:2603.07670 (write-path filtering), GitHub Copilot memory blog (store only actionable facts).  
   - Implementation: `harvest` write filtering heuristic (actionability, reusability, citation quality, novelty).

2. **Conflict handling**  
   - Sources: arXiv:2603.07670 (contradiction handling), GitHub Copilot memory blog (verify citations, correct contradictory memories).  
   - Implementation: active vs superseded status, explicit supersession links.

3. **Retrieval prioritization**  
   - Sources: ExpeL/ERL (top-k relevance over dump-all), GitHub Copilot memory blog (retrieval + future weighted prioritization).  
   - Implementation: `plan` ranks by trigger match, status, confidence, value, recency.

4. **Decay / forgetting**  
   - Sources: arXiv:2603.07670 (learned forgetting, continual consolidation), GitHub Copilot memory blog (branch drift and stale memories).  
   - Implementation: stale marking on citation mismatch, consolidation/pruning policy.

5. **Quality loop / measurable impact**  
   - Sources: GitHub Copilot memory blog (precision/recall uplift and A/B merge-rate impact).  
   - Implementation: per-harvest counters (considered/written/superseded/stale-removed) and iterative threshold tuning.
