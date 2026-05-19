# Agent Orchestration — minime

A replacement for the classical `brainstorm → plan-review → code → code-review`.
Goal: keep code quality, **remove two of the three human review gates**, and make the surviving gate cheap to clear.

Portable across Claude Code and GitHub Copilot. The flow is four skills plus a plain-text per-repo wiki — no tool lock-in.

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
  YOU: write a short task brief (acceptance criteria, EARS-style)   <- only authored artifact
        │
        ▼
  (director: research if needed)  strong subagents gather cited external evidence
        │
        ▼
  /minime:plan       reads wiki + evidence packet, nudges EARS quality if needed, plans silently, self-challenges. NO human gate.
        │
        ▼
  /minime:implement  tight loop: generate → run tests → observe → fix
        │            tests front-loaded. NO human gate.
        │
        ▼
  /minime:review     self-reviews, computes a RISK score, builds an EVIDENCE PACKAGE
        │
        ├── risk = LOW  + tests green ─────────────► auto-merge
        │
        └── risk = HIGH ──► YOU review the evidence package only ──► merge / send back
        │
        ▼
  /minime:harvest    on every correction you make, writes a cited wiki entry
```

Three former gates (requirements, plan, code) collapse to one tiered gate. The plan is an *input the agent consumes*, never a document you sign off.

## The one rule that makes the review gate cheap

The `review` skill hands you an **evidence package**, never a verdict. It must NOT say "this looks correct", show a confidence score next to a conclusion, or argue for its own work. It shows: the scoped diff, the actual test output (real, pasted), the assumptions it made, and the two or three specific lines/decisions it is least sure about. You judge.

This is the single empirically strongest lever in the whole design — a verdict measurably degrades your error detection.

## Subagents and model strength

For larger steps, minime should prefer fresh-context subagents with strong reasoning models.
Review is always fresh-context by design (`/minime:review` forks to `minime:reviewer`).
If your harness supports model choice, use top reasoning tiers for these subagents and avoid fast/mini-tier variants for large reasoning-heavy phases.
Subagents should have enough tool access for their role: full engineering tool access for implementation/investigation, and deliberately read-only access for review isolation.

## Risk tiers (who reviews what)

- **LOW** — localised, covered by tests you can read, no security/auth/data/migration/public-API surface. → auto-merge on green.
- **HIGH** — touches auth, data integrity, migrations, money, concurrency, a public API, or > ~150 changed lines, OR the agent's self-confidence is low. → human reviews evidence package.

When unsure, the tier is HIGH. Tiers are defined in the `review` skill.

## Files in this repo

```
ORCHESTRATION.md                        this file
task.template.md                        the short EARS-style task brief you fill in per task
CLAUDE.md                               pointer for Claude Code
.github/copilot-instructions.md         pointer for GitHub Copilot surfaces
.agent/wiki/<org>__<repo>.md            symlink to $HOME/.minime/wiki/repos/<org>__<repo>.md
.agent/wiki/_TEMPLATE.md                wiki entry format
.agent/research/REFERENCES.md           empirical basis for every design decision
```

The four skills (`plan`, `implement`, `review`, `harvest`) live in the **minime plugin** at `<plugin-cache>/skills/<name>/SKILL.md`, not in this repo. Invoke them with `/minime:plan`, `/minime:implement`, etc.

The plugin also ships two agents:

- **`minime:director`** — runs the flow end-to-end. Start an autopilot
  session for a single task with `claude --agent minime:director`. It
  re-injects the flow's discipline at every phase boundary and stops only
  when it needs you (HIGH-risk review, or a destructive action).
- **`minime:reviewer`** — the read-only reviewer the `review` skill forks
  into. Lives in a fresh context window with no `Edit`/`Write` tools, so
  it is structurally unable to "fix" anything and can only surface. This
  isolation is what makes the evidence package worth more than an inline
  self-review.

## Per-repo setup

The wiki is keyed by repo URL. The init skill derives the filename automatically from `git remote get-url origin` — `github.com/acme/billing` becomes `.agent/wiki/acme__billing.md`, which is a symlink to the central file at `$HOME/.minime/wiki/repos/acme__billing.md`. The repo keeps the stable entrypoint; the canonical data lives in your user home.
