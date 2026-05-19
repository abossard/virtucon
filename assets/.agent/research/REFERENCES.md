# Research Basis

The agent flow in this repo is not arbitrary. Each design decision traces to empirical work. The two load-bearing sources are summarised here; the rest are listed for traceability.

## Primary sources

### DeepMind — Human-AI Complementarity: A Goal for Amplified Oversight (2025)
arXiv:2510.26518 · https://arxiv.org/abs/2510.26518
Jain, Bridgers, Janzer, Greig, Teh, Mikulik (Google DeepMind).

Findings used by this flow:
- Confidence-based hybridization: route high-confidence cases to the AI, low-confidence cases to humans. Beat AI-alone and human-alone overall (89.3% vs 87.7% AI-alone on their eval set). → our risk-tiered single gate.
- Presentation format determines reviewer accuracy. Showing the AI's judgments / labels / confidence caused measurable OVER-RELIANCE: assisted reviewers did worse than unassisted ones on cases where the AI was wrong.
- Showing only raw evidence (search results + selected quotes) was the single form of assistance that "helps when correct and does not hurt when wrong." → the review skill forbids verdicts; it ships an evidence package only.
- Benefit of assistance shrinks for skilled reviewers; the naive "show everything incl. confidence" format actively hurt them. → keep the agent surfacing evidence, not adjudicating.

### Springer AI & Ethics — Designing meaningful human oversight in AI (2026)
https://link.springer.com/article/10.1007/s43681-026-01147-7

Findings used by this flow:
- Layered agency: AI holds operative agency (task execution), humans hold evaluative agency (verification, steering, substitution). → the flow's shape.
- Exploit the solve-verify asymmetry: design AI outputs so humans can check and contest them WITHOUT re-solving the task. → small scoped diffs, pasted real test output, stated assumptions instead of conclusions.
- Accountability: sampling, escalation bundles, audit trails make both detections and dismissals reviewable. → the corrections wiki is the audit trail; cited entries make decisions reviewable.

## Supporting sources

- ClassEval Waterfall ablation — Evaluating Software Process Models for Multi-Agent Class-Level Code Generation (2025), arXiv:2511.09794. Over-structured multi-agent waterfalls did not reliably improve correctness and raised runtime errors 10–53%; requirements/design stages had minimal effect; testing had the largest positive effect. → one gate, tests front-loaded.
- Enhancing LLM Code Generation: Multi-Agent Collaboration and Runtime Debugging (2025), arXiv:2505.02133. Execution-grounded debug loops beat agentic role-play choreography. → the implement loop.
- AgentCoder: Multi-Agent-based Code Generation with Iterative Testing and Optimisation (2024), arXiv:2312.13010. Specialized roles (programmer + test designer + test executor) improved pass@1 on HumanEval/MBPP versus baselines. → role-specialized subagents can help when tightly coupled to executable test feedback.
- LLMs Get Lost in Multi-Turn Conversation (2025), arXiv:2505.06120. Degradation in multi-turn flows is driven by unreliability (~112% increase), not aptitude loss. → collapse stages, reduce gradual reveal.
- Context Rot: How Increasing Input Tokens Impacts LLM Performance (Chroma Technical Report, 2025), https://research.trychroma.com/context-rot and replication repo https://github.com/chroma-core/context-rot. Across controlled long-context tasks, performance degrades as input length grows. → prefer concise context windows, refresh context for large steps, and keep prompts self-contained.
- Instruction attenuation / "Forget-Me-Not" re-injection — practitioner failure-mode analyses, 2026. → constraint re-injection in the implement skill.
- GitHub Copilot agentic memory (2026), https://github.blog/ai-and-ml/github-copilot/building-an-agentic-memory-system-for-github-copilot/ Repo-scoped memories; every memory carries a code citation and is re-verified against live code before use; adversarial-memory tested. → wiki entries must cite code; plan verifies before trusting.
- ExpeL/ERL (arXiv:2603.24639) and Google ReasoningBank (2026). Concatenating all past insights scales poorly — score for relevance and inject top-k; memories should be consolidated and allowed to mature. → harvest consolidation, plan relevance-scoring.
- Memory for Autonomous LLM Agents: Mechanisms, Evaluation, and Applications (2026), arXiv:2603.07670. Formalizes memory as a write-manage-read loop and highlights write-path filtering, contradiction handling, retrieval policy, consolidation, and forgetting as core design axes. → direct basis for harvest's 5 memory policies.
- Karpathy, "LLM Wiki" pattern (2026 gist): https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f Persistent markdown wiki with incremental integration and maintenance (practitioner pattern, not a controlled scientific benchmark). → operational shape of wiki-as-compounding-artifact.

## Interpretation notes (for workflow decisions)

- Evidence for **context-rot / long-context degradation** is strong and replicated across multiple setups (arXiv + independent technical report).
- Evidence for **multi-agent/subagent gains** is mixed: some role-specialized patterns improve outcomes (e.g., AgentCoder), while over-structured waterfalls can hurt correctness (ClassEval Waterfall).
- The workflow consequence is pragmatic: use subagents selectively for large independent reasoning steps, keep reviewer isolation via fresh context, and avoid adding process stages that are not tied to executable evidence.

## Policy mapping (research → implementation)

1. **Write filtering / scoring**  
   - Sources: arXiv:2603.07670 (write-path filtering), GitHub Copilot memory blog (store only actionable facts).  
   - Implementation: `harvest` ValueScore rubric + threshold.

2. **Conflict handling**  
   - Sources: arXiv:2603.07670 (contradiction handling), GitHub Copilot memory blog (verify citations, correct contradictory memories).  
   - Implementation: active vs superseded status, explicit supersession links.

3. **Retrieval prioritization**  
   - Sources: ExpeL/ERL + ReasoningBank (top-k relevance over dump-all), GitHub Copilot memory blog (retrieval + future weighted prioritization).  
   - Implementation: `plan` ranks by trigger match, status, confidence, value, recency.

4. **Decay / forgetting**  
   - Sources: arXiv:2603.07670 (learned forgetting, continual consolidation), GitHub Copilot memory blog (branch drift and stale memories).  
   - Implementation: stale marking on citation mismatch, consolidation/pruning policy.

5. **Quality loop / measurable impact**  
   - Sources: GitHub Copilot memory blog (precision/recall uplift and A/B merge-rate impact).  
   - Implementation: per-harvest counters (considered/written/superseded/stale-removed) and iterative threshold tuning.
