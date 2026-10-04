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

## Decision theory references

- Howard, R. A. (1966), *Information Value Theory*, IEEE SSC-2(1), 22–26. -> VOI gating.
- Raiffa & Schlaifer (1961), *Applied Statistical Decision Theory*. -> benefit-vs-cost framing.
- Simon, H. A. (1955), *A Behavioral Model of Rational Choice*, QJE 69(1), 99–118. -> decision hygiene.
- Ellsberg, D. (1961), *Risk, Ambiguity, and the Savage Axioms*, QJE 75(4), 643–669. -> decidable vs undecidable.
- Dietvorst et al. (2015), *Algorithm Aversion*, Management Science. -> evidence over authority.
- Logg et al. (2019), *Algorithm Appreciation*, OBHDP 151, 90–103. -> calibrated confidence.

## Engineering references (not controlled studies)

- Ousterhout, [A Philosophy of Software Design vs Clean Code](https://github.com/johnousterhout/aposd-vs-clean-code/blob/main/README.md), first-party discussion (2024-2025). Deep modules hide substantial behavior behind simple interfaces; excessive decomposition adds caller knowledge. -> boundary-map untangling.
- Parnas, [On the Criteria To Be Used in Decomposing Systems into Modules](https://www.cs.colostate.edu/~france/CS314/Readings/Parnas-decomposition.pdf), CACM (1972), DOI 10.1145/361598.361623. Worked design argument for hiding difficult or changing decisions, not a controlled study. -> responsibility ownership and change locality.
- Normand, *Grokking Simplicity*, Manning: [classification](https://livebook.manning.com/book/grokking-simplicity/chapter-3), [calculations](https://livebook.manning.com/book/grokking-simplicity/chapter-4), [copy-on-write](https://livebook.manning.com/book/grokking-simplicity/chapter-6), [defensive copying](https://livebook.manning.com/book/grokking-simplicity/chapter-7). Available chapter excerpts and [author definitions](https://ericnormand.me/podcast/what-is-an-action) support data/calculations/actions and immutable shared values. -> replicate and inspect.
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
