#!/usr/bin/env bash
# install-agent-flow.sh
# One-step installer for the evidence-based agent development flow.
#
# Usage: place this file in the root of a clone of abossard/minime, then:
#   bash install-agent-flow.sh
# It writes all files, creates tool pointer files, commits, and (optionally) pushes.
set -euo pipefail

if [ ! -d .git ]; then
  echo "ERROR: run this from the root of your repo clone (no .git directory found)." >&2
  exit 1
fi

echo "Installing agent flow..."
mkdir -p .agent/skills .agent/wiki .agent/research .github

# ---- ORCHESTRATION.md ----
cat > 'ORCHESTRATION.md' <<'AGENTFLOW_EOF_8f3a2b'
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
AGENTFLOW_EOF_8f3a2b

# ---- spec.template.md ----
cat > 'spec.template.md' <<'AGENTFLOW_EOF_8f3a2b'
# Spec: <one-line task name>

Repo: <repo URL — this keys the wiki>

## Goal
<2–4 sentences. What outcome, and why. Not how.>

## Acceptance criteria (EARS-style — each must be independently testable)
Use these patterns; each criterion collapses to one checkable claim:
- Ubiquitous:  The system shall <requirement>.
- Event:       When <trigger>, the system shall <response>.
- State:       While <state>, the system shall <response>.
- Conditional: If <condition>, then the system shall <response>.
- Optional:    Where <feature included>, the system shall <response>.

1.
2.
3.

## Out of scope
<Explicitly list what NOT to touch. Prevents scope drift.>

## Constraints / non-negotiables
<Perf budgets, libraries to use or avoid, patterns to follow. The agent
re-injects these mid-implementation, so be concrete.>

---
This is the only artifact you author. The agent's plan is not reviewed by you.
The value here is the thinking, not the ceremony — keep it short.
AGENTFLOW_EOF_8f3a2b

# ---- .agent/skills/plan.md ----
cat > '.agent/skills/plan.md' <<'AGENTFLOW_EOF_8f3a2b'
# Skill: plan

Trigger: a `spec.md` exists for a task. Runs first. **No human review gate** —
the plan is consumed directly by `implement`, never signed off.

## Steps

1. **Load repo wiki.** From the spec's repo URL, open
   `.agent/wiki/<org>__<repo>.md`. If absent, create it from `_TEMPLATE.md`.

2. **Score wiki entries for relevance — do not dump them all in.**
   Select only the entries plausibly relevant to this spec. Concatenating the
   whole wiki scales badly and buries the useful entry. Aim for the top ~5.

3. **Verify before trusting (citation check).** Each selected entry cites a
   code location. Open that location. If the code no longer matches the entry,
   the entry is stale — ignore it and flag it for `harvest` to fix. Never plan
   on an unverified memory.

4. **Plan silently.** Produce an internal implementation plan: files to touch,
   order of work, which acceptance criteria each step satisfies, and the tests
   that will prove each one. This is working state, not a deliverable.

5. **Self-challenge (write this down, keep it short).** Answer:
   - What is the riskiest assumption in this plan?
   - Under what condition would this approach be wrong?
   - What in the spec is ambiguous? (If genuinely blocking, ask the human ONE
     question. Otherwise state the assumption and proceed.)

6. **Hand off** the plan + self-challenge to `implement` directly.

## Rules
- Do not produce a plan document for human approval. No plan-review gate.
- Prefer the smallest plan that satisfies the spec. Extra structure measurably
  lowers correctness.
- If wiki and live code disagree, the live code wins.
AGENTFLOW_EOF_8f3a2b

# ---- .agent/skills/implement.md ----
cat > '.agent/skills/implement.md' <<'AGENTFLOW_EOF_8f3a2b'
# Skill: implement

Trigger: `plan` has handed off. **No human review gate.** Quality here comes
from a tight execution-grounded loop, not from human checkpoints.

## The loop (this is the empirically strongest part of the flow)

Repeat per acceptance criterion:

1. **Write the test first** for this criterion. Tests front-loaded had the
   single largest positive effect on correctness in multi-stage studies.
2. **Implement** the smallest change that could pass it.
3. **Run the test. Observe the REAL output.** Never assume a run passed —
   paste/inspect actual output. ("ran tests, passed" with no output is the
   classic instruction-attenuation failure.)
4. **Fix** based on real output. Re-run. A grounded generate→run→observe→fix
   loop outperforms agentic role-play choreography.
5. Move to the next criterion only when this one is genuinely green.

## Constraint re-injection ("Forget-Me-Not")

Every ~5 iterations, OR after any context compaction, re-read the
"Constraints / non-negotiables" and "Out of scope" sections of the spec and
restate them to yourself in one line. Rules decay across long loops — they get
applied in form but lose substance unless refreshed.

## Scope discipline
- Touch only what the spec and plan require. If you discover necessary work
  outside scope, note it for the evidence package — do not silently expand.
- Keep the diff as small as the spec allows. Small diffs are cheap to verify;
  large diffs force the reviewer to re-solve instead of check.

## Hand off to `review` with
- the diff
- every test and its real, pasted output
- assumptions made, and any out-of-scope work discovered
AGENTFLOW_EOF_8f3a2b

# ---- .agent/skills/review.md ----
cat > '.agent/skills/review.md' <<'AGENTFLOW_EOF_8f3a2b'
# Skill: review

Trigger: `implement` handed off. This is the ONLY skill that may reach the
human — and only for the HIGH-risk slice.

## Step 1 — Self-review against the spec
Re-read the spec's acceptance criteria. For each: is there a test, does it
genuinely pass (real output), does it actually verify the criterion? Fix gaps
by looping back to `implement`. Do not pass known-incomplete work forward.

## Step 2 — Compute the risk tier

**HIGH** if the change touches ANY of:
- authentication, authorization, sessions, secrets
- data integrity, schema migrations, money/billing
- concurrency / async correctness
- a public API or contract other code depends on
- more than ~150 changed lines
OR your own confidence that this is correct is below "high".

Otherwise **LOW**. **When in doubt, HIGH.** (Confidence-based routing only
works when the low-confidence slice is honestly escalated — a miscalibrated
"LOW" defeats the whole design.)

## Step 3 — Route

- **LOW + all tests green** → auto-merge. Then run `harvest`.
- **HIGH** → build the evidence package below and STOP for the human.

## Step 4 — The evidence package (HIGH only)

THE ONE RULE: hand the human **evidence, not a verdict.**

Showing a conclusion ("looks correct"), or a confidence score attached to a
conclusion, or an argument for your own work, measurably causes over-reliance
and makes the reviewer WORSE at catching your mistakes when you are wrong.
Raw evidence alone helps when you are right and does not hurt when you are
wrong. So the package contains ONLY:

1. **Scoped diff** — the change, nothing extra.
2. **Test output** — real, pasted, every test. Not "passed".
3. **Assumptions made** — plain list.
4. **Least-sure points** — the 2–3 specific lines or decisions you are least
   confident about, as questions: "Is X the right behaviour when Y?"
   State the uncertainty. Do NOT resolve it for the reviewer.
5. **Out-of-scope work discovered** — if any.

FORBIDDEN in the package: "this looks correct / LGTM / safe to merge / I'm
confident", any overall verdict, any score next to a conclusion, any
persuasion. Surface; do not adjudicate. The human adjudicates.

## Step 5
After the human decides, run `harvest`.
AGENTFLOW_EOF_8f3a2b

# ---- .agent/skills/harvest.md ----
cat > '.agent/skills/harvest.md' <<'AGENTFLOW_EOF_8f3a2b'
# Skill: harvest

Trigger: a task is merged (auto or human). Turns raw outcomes — especially
human corrections — into durable, cited wiki entries for future tasks.

Human corrections are the highest-value signal in the system: they passed
through a human and survived. Capture them first.

## What to capture

1. **Corrections (priority).** Anything the human changed, rejected, or sent
   back during review. Each becomes one entry. The before/after IS the lesson.
2. **Stale entries** flagged by `plan` during its citation check — fix or
   delete them.
3. **Episodic notes** — an approach that failed and why ("tried X, broke Y").
4. Skip anything already covered. No duplicates.

## How to write an entry

Append to `.agent/wiki/<org>__<repo>.md` using `_TEMPLATE.md`. Every entry MUST:

- **Carry a code citation** — `path:line` or a stable symbol name. An entry
  with no citation is unsafe and must not be written: future agents re-verify
  entries against live code before trusting them, and an uncited entry cannot
  be verified.
- **Be a generalised rule, not a task log.** Not "fixed the bug in PR 12" but
  "Money values use integer minor units; never use floats — see billing.py:44."
- **State the trigger** — when this applies — so it can be relevance-scored.
- **Be dated**, so consolidation can prune the old.

## Consolidation (every ~20 entries, or when the file feels noisy)

Do not let the wiki grow unbounded — a bloated wiki buries the useful entry
and slows every future task.
- Merge several specific entries into one general rule where a pattern is
  visible (simple notes should mature into preventative rules over time).
- Delete entries whose cited code no longer exists.
- Keep the file scannable. Quality and recall beat volume.

## Boundaries
- Wiki is per-repo, keyed by repo URL. Never mix repos.
- Never store secrets, tokens, credentials, or customer data.
- The wiki holds engineering knowledge, not a changelog.
AGENTFLOW_EOF_8f3a2b

# ---- .agent/wiki/_TEMPLATE.md ----
cat > '.agent/wiki/_TEMPLATE.md' <<'AGENTFLOW_EOF_8f3a2b'
# Corrections Wiki — <org>/<repo>

Repo URL: <url>   (this file is keyed to it; one wiki per repo)

Per-repo engineering knowledge distilled from past tasks and human
corrections. Read by `plan` (relevance-scored, citation-verified before use),
written by `harvest`. Shared by Claude and Copilot — commit it to the repo.

Rules: every entry cites live code · entries are general rules, not task logs ·
no secrets or customer data · consolidate when it grows past ~20 entries.

---

## Entries

<!-- newest first. copy the block below per entry. -->

### <short rule name>
- **Rule:** <the generalised lesson, one or two sentences>
- **Trigger:** <when this applies — used for relevance scoring>
- **Evidence:** <code citation: path:line or symbol — re-verified before trust>
- **Origin:** <human-correction | failed-approach | observation>
- **Date:** <YYYY-MM-DD>

---

### EXAMPLE — Money is integer minor units
- **Rule:** All monetary values are integer minor units (cents). Never use
  floats for money; never divide before formatting at the boundary.
- **Trigger:** Any task touching prices, billing, totals, or currency.
- **Evidence:** `src/billing/money.py:44` (`Money` value object)
- **Origin:** human-correction (reviewer rejected a float subtotal)
- **Date:** 2026-05-19
AGENTFLOW_EOF_8f3a2b

# ---- .agent/wiki/abossard__minime.md ----
cat > '.agent/wiki/abossard__minime.md' <<'AGENTFLOW_EOF_8f3a2b'
# Corrections Wiki — abossard/minime

Repo URL: https://github.com/abossard/minime   (this file is keyed to it; one wiki per repo)

Per-repo engineering knowledge distilled from past tasks and human
corrections. Read by `plan` (relevance-scored, citation-verified before use),
written by `harvest`. Shared by Claude and Copilot — commit it to the repo.

Rules: every entry cites live code · entries are general rules, not task logs ·
no secrets or customer data · consolidate when it grows past ~20 entries.

---

## Entries

<!-- newest first. copy the block below per entry. -->
<!-- empty: harvest will write the first entry after the first reviewed task. -->

### <short rule name>
- **Rule:** <the generalised lesson, one or two sentences>
- **Trigger:** <when this applies — used for relevance scoring>
- **Evidence:** <code citation: path:line or symbol — re-verified before trust>
- **Origin:** <human-correction | failed-approach | observation>
- **Date:** <YYYY-MM-DD>
AGENTFLOW_EOF_8f3a2b

# ---- .agent/research/REFERENCES.md ----
cat > '.agent/research/REFERENCES.md' <<'AGENTFLOW_EOF_8f3a2b'
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
AGENTFLOW_EOF_8f3a2b

# ---- CLAUDE.md ----
cat > 'CLAUDE.md' <<'AGENTFLOW_EOF_8f3a2b'
# Claude Code instructions

Follow the development flow defined in `ORCHESTRATION.md` at the repo root.
Skills are in `.agent/skills/`. The empirical basis is in `.agent/research/REFERENCES.md`.
AGENTFLOW_EOF_8f3a2b

# ---- .github/copilot-instructions.md ----
cat > '.github/copilot-instructions.md' <<'AGENTFLOW_EOF_8f3a2b'
Follow the development flow defined in ORCHESTRATION.md at the repo root.
Skills are in .agent/skills/. See .agent/research/REFERENCES.md for the rationale.
AGENTFLOW_EOF_8f3a2b

echo "Files written. Staging and committing..."
git add ORCHESTRATION.md spec.template.md CLAUDE.md .agent .github/copilot-instructions.md
git commit -m "Add evidence-based agent flow (plan/implement/review/harvest + corrections wiki + references)"

echo
echo "Committed. Review the commit, then push with:  git push origin main"
echo "You may now delete this installer: rm install-agent-flow.sh"

