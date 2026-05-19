# Research Basis

The agent flow in this repo is not arbitrary. Each design decision traces to
empirical work. The two load-bearing sources are summarised here; the rest are
listed for traceability.

## Primary sources

### DeepMind — Human-AI Complementarity: A Goal for Amplified Oversight (2025)
arXiv:2510.26518 · https://arxiv.org/abs/2510.26518
Jain, Bridgers, Janzer, Greig, Teh, Mikulik (Google DeepMind).

Findings used by this flow:
- Confidence-based hybridization: route high-confidence cases to the AI,
  low-confidence cases to humans. Beat AI-alone and human-alone overall
  (89.3% vs 87.7% AI-alone on their eval set). → our risk-tiered single gate.
- Presentation format determines reviewer accuracy. Showing the AI's
  judgments / labels / confidence caused measurable OVER-RELIANCE: assisted
  reviewers did worse than unassisted ones on cases where the AI was wrong.
- Showing only raw evidence (search results + selected quotes) was the single
  form of assistance that "helps when correct and does not hurt when wrong."
  → review.md forbids verdicts; it ships an evidence package only.
- Benefit of assistance shrinks for skilled reviewers; the naive
  "show everything incl. confidence" format actively hurt them.
  → keep the agent surfacing evidence, not adjudicating.

### Springer AI & Ethics — Designing meaningful human oversight in AI (2026)
https://link.springer.com/article/10.1007/s43681-026-01147-7

Findings used by this flow:
- Layered agency: AI holds operative agency (task execution), humans hold
  evaluative agency (verification, steering, substitution). → the flow's shape.
- Exploit the solve-verify asymmetry: design AI outputs so humans can check
  and contest them WITHOUT re-solving the task. → small scoped diffs, pasted
  real test output, stated assumptions instead of conclusions.
- Accountability: sampling, escalation bundles, audit trails make both
  detections and dismissals reviewable. → the corrections wiki is the audit
  trail; cited entries make decisions reviewable.

## Supporting sources

- ClassEval Waterfall ablation — Evaluating Software Process Models for
  Multi-Agent Class-Level Code Generation (2025), arXiv:2511.09794.
  Over-structured multi-agent waterfalls did not reliably improve correctness
  and raised runtime errors 10-53%; requirements/design stages had minimal
  effect; testing had the largest positive effect. → one gate, tests front-loaded.
- Enhancing LLM Code Generation: Multi-Agent Collaboration and Runtime
  Debugging (2025), arXiv:2505.02133. Execution-grounded debug loops beat
  agentic role-play choreography. → the implement loop.
- LLMs Get Lost in Multi-Turn Conversation (2025), arXiv:2505.06120.
  Degradation in multi-turn flows is driven by unreliability (~112% increase),
  not aptitude loss. → collapse stages, reduce gradual reveal.
- Instruction attenuation / "Forget-Me-Not" re-injection — practitioner
  failure-mode analyses, 2026. → constraint re-injection in implement.md.
- GitHub Copilot agentic memory (2026),
  https://github.blog/ai-and-ml/github-copilot/building-an-agentic-memory-system-for-github-copilot/
  Repo-scoped memories; every memory carries a code citation and is
  re-verified against live code before use; adversarial-memory tested.
  → wiki entries must cite code; plan.md verifies before trusting.
- ExpeL/ERL (arXiv:2603.24639) and Google ReasoningBank (2026). Concatenating
  all past insights scales poorly — score for relevance and inject top-k;
  memories should be consolidated and allowed to mature. → harvest.md
  consolidation, plan.md relevance-scoring.
