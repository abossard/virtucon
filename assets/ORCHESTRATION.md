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
  YOU: describe the task (inline or as task.md with EARS-style criteria)   <- only authored artifact
        │
        ▼
  (director: research if needed)  strong subagents gather cited external evidence
        │
        ▼
  skill("plan")      reads wiki + evidence packet, discovers installed skills,
        │            nudges EARS quality if needed, plans silently, self-challenges.
        │            NO human gate. Outputs: "now invoke skill("implement")"
        │
        ▼
  skill("implement") tight loop: generate → run tests → observe → fix
        │            tests front-loaded. NO human gate.
        │            Outputs: "now invoke skill("review")"
        │
        ▼
  skill("review")    self-reviews staged+unstaged+untracked, computes RISK, builds EVIDENCE PACKAGE
        │
        ├── risk = LOW  + tests green ─────────────► auto-merge (or commit when ready)
        │
        └── risk = HIGH ──► YOU review the evidence package only ──► merge / send back
        │
        ▼
  skill("harvest")   on every correction you make, writes a cited wiki entry.
                     Also captures session lessons even without a merge.
```

Three former gates (requirements, plan, code) collapse to one tiered gate. The plan is an *input the agent consumes*, never a document you sign off.

No `task.md` file is required — plan accepts inline conversation context directly. Each skill explicitly tells the agent which skill to invoke next (explicit chaining).

## The one rule that makes the review gate cheap

The `review` skill hands you an **evidence package**, never a verdict. It must NOT say "this looks correct", show a confidence score next to a conclusion, or argue for its own work. It shows: the scoped diff, the actual test output (real, pasted), the assumptions it made, and the two or three specific lines/decisions it is least sure about. You judge.

This is the single empirically strongest lever in the whole design — a verdict measurably degrades your error detection.

## Subagents and model strength

For larger steps, minime should prefer fresh-context subagents with strong reasoning models.
Review is always fresh-context by design (`skill("review")` forks to `minime:reviewer`).
If your harness supports model choice, use top reasoning tiers for these subagents and avoid fast/mini-tier variants for large reasoning-heavy phases.
Subagents should have enough tool access for their role: full engineering tool access for implementation/investigation, and deliberately read-only access for review isolation.

## Formal VOI gate (when to research vs decide)

- Classify unknowns into:
  - **Decidable-by-data** (resolve via code/docs/tests/sources), and
  - **Undecidable-now** (value tradeoff/policy preference/irreducible uncertainty).
- Run extra research only if Value-of-Information is positive in practice: likely to materially change the chosen path.
- If extra research is unlikely to change the path, stop and request a decision with a compact options/tradeoffs/risks/default packet.

## Risk tiers (who reviews what)

- **LOW** — localised, covered by tests you can read, no security/auth/data/migration/public-API surface. → auto-merge on green (or stage/commit when the user is ready — minime does not force the git timeline).
- **HIGH** — touches auth, data integrity, migrations, money, concurrency, a public API, or > ~150 changed lines, OR the agent's self-confidence is low. → human reviews evidence package.

When unsure, the tier is HIGH. Tiers are defined in the `review` skill.

## SessionStart hook (auto-nudge)

The plugin ships `hooks/hooks.json` + `hooks/session-start.js`. On every new session, the hook injects a nudge listing available minime skills and usage guidance into the agent's context — no repo-level custom instructions needed. The nudge tells the agent to use `skill("plan")` for non-trivial tasks and documents the full chain.

## Inline task briefs (no file required)

`plan` accepts task descriptions from three sources:
1. A `task.md` file in the working directory.
2. Inline conversation context (pasted requirements, a table, verbal description).
3. User is asked to describe the task if neither is present.

Regardless of source, `plan` creates a **persisted living task brief** at `$HOME/.minime/tasks/<org>__<repo>/<date>-<name>.task.md`. This file:
- Preserves the user's original request **verbatim** (never reworded or interpreted).
- Has checkboxes (`[ ]`/`[x]`) on every criterion, ticked by `implement` as tests pass.
- Carries a VOI level per criterion (`decided-by-data`, `needs-research`, `undecidable-now`).
- Has a Decisions table recording how each unknown was resolved and from what source.
- Grows a "Discovered during review" section for criteria surfaced after the initial EARS.
- Grows a "User feedback" section with verbatim human corrections (timestamped, unedited).

The task brief is the single source of truth across all phases and the traceable record of how a feature's requirements evolved.

## Review scope: staged + untracked

The review skill collects the full change set from:
- `git diff` (unstaged), `git diff --staged` (staged), `git ls-files --others --exclude-standard` (untracked new files), and branch diffs when applicable.
Untracked files that are part of the task are reviewable work, not invisible.

## Session harvest (no merge required)

`harvest` accepts lessons from the current session even without a merge event. It looks for:
- Human corrections to the agent's approach or output.
- Design decisions with rationale worth preserving.
- Patterns discovered during implementation.
Code-cited lessons go to the wiki; purely process knowledge goes to the director's project memory.

`harvest` also reads the persisted task brief's Decisions table and "Discovered during review" section to learn what categories of criteria the EARS consistently misses — that meta-learning feeds the director's process memory and sharpens future EARS nudges.

## Data integrity principle

**Preserve raw signal. Derive actions separately. Assess with evidence. Do not interpret.**

- User-written sentences are never reworded, paraphrased, or reinterpreted — they are copied verbatim.
- The persisted task brief keeps the user's original request, their feedback, and the review-discovered criteria as separate, immutable sections.
- Actions and criteria are derived from the raw data but stored alongside it, not in place of it.

## Explicit skill chaining

Each skill's hand-off explicitly instructs the agent which skill to invoke next:
- `plan` → "now invoke `skill("implement")`"
- `implement` → "now invoke `skill("review")`"
- `review` → "invoke `skill("harvest")`"

This prevents the agent from optimizing for speed and skipping structured phases.

## Git timeline decoupling

Minime's workflow does not force coupling to the user's git commit cadence. LOW-risk auto-merge is the default for convenience, but the user can commit at their own pace. `harvest` works from session context, not only from merge events.

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

The four skills (`plan`, `implement`, `review`, `harvest`) live in the **minime plugin** at `<plugin-cache>/skills/<name>/SKILL.md`, not in this repo. Invoke them with `skill("plan")`, `skill("implement")`, etc.

The plugin also ships:

- **`hooks/`** — a SessionStart hook that auto-nudges the agent toward the
  structured workflow on every new session.
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
