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
