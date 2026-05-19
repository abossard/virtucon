# Agent Flow — Orchestration

A replacement for `brainstorm → plan-review → code → code-review`.
Goal: keep code quality, **remove two of the three human review gates**, and
make the surviving gate cheap to clear.

Portable across Claude Code and GitHub Copilot. No tool lock-in: the flow is
four skills + a plain-text per-repo wiki.

## Why it is shaped this way (grounding)

Full citations and findings: `.agent/research/REFERENCES.md`.

| Decision | Source |
|---|---|
| One human gate, not three | Spec/design stages have minimal measured effect on correctness (ClassEval Waterfall ablation, 2025); over-structuring lowers correctness. |
| Tier review by agent-reported risk | Confidence-based hybridization beats uniform review — route only the low-confidence slice to the human (DeepMind, *Human-AI Complementarity*, 2025). |
| Reviewer surfaces evidence, never a verdict | Showing labels/judgments/confidence caused **over-reliance** and made reviewers *worse* when the AI was wrong; raw evidence alone "helps when correct, does not hurt when wrong" (same paper). |
| Design outputs to be checkable, not re-solvable | Solve–verify asymmetry — layer AI operative agency under human evaluative agency (Springer, *Designing meaningful human oversight*, 2026). |
| Per-repo corrections wiki with cited entries | GitHub Copilot agentic memory (2026): repo-scoped, citation-verified memories; adversarial-memory tested. |
| Score-then-inject, consolidate periodically | ExpeL/ERL — concatenating all insights scales poorly; ReasoningBank — memories should mature. |

## The flow

```
  YOU: write a short spec (acceptance criteria, EARS-style)   <- only authored artifact
        │
        ▼
  [1] plan  ── reads wiki, plans silently, self-challenges. NO human gate.
        │
        ▼
  [2] implement ── tight loop: generate → run tests → observe → fix
        │            tests front-loaded. NO human gate.
        │
        ▼
  [3] review ── self-reviews, computes a RISK score, builds an EVIDENCE PACKAGE
        │
        ├── risk = LOW  + tests green ─────────────► auto-merge
        │
        └── risk = HIGH ──► YOU review the evidence package only ──► merge / send back
        │
        ▼
  [4] harvest ── on every correction you make, writes a cited wiki entry
```

Three former gates (spec, plan, code) collapse to one tiered gate. The plan is
an *input the agent consumes*, never a document you sign off.

## The one rule that makes the review gate cheap

The `review` skill hands you an **evidence package**, never a verdict.
It must NOT say "this looks correct", show a confidence score next to a
conclusion, or argue for its own work. It shows: the scoped diff, the actual
test output (real, pasted), the assumptions it made, and the two or three
specific lines/decisions it is least sure about. You judge. This is the
single empirically strongest lever in the whole design — a verdict measurably
degrades your error detection.

## Risk tiers (who reviews what)

- **LOW** — localised, covered by tests you can read, no security/auth/data/
  migration/public-API surface. → auto-merge on green.
- **HIGH** — touches auth, data integrity, migrations, money, concurrency,
  a public API, or > ~150 changed lines, OR the agent's self-confidence is low.
  → human reviews evidence package.

When unsure, the tier is HIGH. Tiers are defined in `.agent/skills/review.md`.

## Files

```
ORCHESTRATION.md            this file
.agent/skills/plan.md        skill 1
.agent/skills/implement.md   skill 2
.agent/skills/review.md      skill 3
.agent/skills/harvest.md     skill 4
.agent/wiki/<org>__<repo>.md per-repo corrections wiki (key = repo URL)
.agent/wiki/_TEMPLATE.md     wiki format
.agent/research/REFERENCES.md the empirical basis for every design decision
spec.template.md             the short spec you fill in per task
```

## Setup per repo

The wiki is keyed by repo URL. Derive the filename by slugifying it:
`github.com/acme/billing` → `.agent/wiki/acme__billing.md`.
Commit the wiki to the repo so Claude and Copilot share it.
