# Agent Orchestration: minime

A replacement for the classical `brainstorm -> plan-review -> code -> code-review`.
Goal: keep code quality, **remove two of the three human review gates**, and make the surviving gate cheap to clear.

Portable across Claude Code and GitHub Copilot. The flow is four skills plus a plain-text per-repo wiki. No tool lock-in.

## Why it is shaped this way

Full citations: `.agent/research/REFERENCES.md`.

| Decision | Source |
|---|---|
| One human gate, not three | ClassEval Waterfall ablation (2025) |
| Tier review by uncertainty | DeepMind *Human-AI Complementarity* (2025) |
| Evidence, never a verdict | Same paper. Verdicts cause over-reliance. |
| Checkable outputs | Springer *Designing meaningful human oversight* (2026) |
| Cited wiki entries | GitHub Copilot agentic memory (2026) |

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
  skill("implement") tight loop: generate -> run tests -> observe -> fix
        │            tests front-loaded. NO human gate.
        │            Outputs: "now invoke skill("review")"
        │
        ▼
  skill("review")    self-reviews staged+unstaged+untracked, computes RISK, builds EVIDENCE PACKAGE
        │
        ├── risk = LOW  + tests green ─────────────► stage (user commits when ready)
        │
        └── risk = HIGH ──► YOU review the evidence package only ──► merge / send back
        │
        ▼
  skill("harvest")   on every correction you make, writes a cited wiki entry.
                     Also captures session lessons even without a merge.
```

Three former gates (requirements, plan, code) collapse to one tiered gate. The plan is an *input the agent consumes*, never a document you sign off.

No `task.md` file is required. Plan accepts inline conversation context directly. Each skill explicitly tells the agent which skill to invoke next (explicit chaining).

## The review gate

The `review` skill owns the full review process. See `skills/review/SKILL.md` for the evidence package format, risk model, and traceability table. The short version is simple: evidence only, no verdicts.

## Subagents

Review always runs in a fresh context (`skill("review")` forks to `minime:reviewer`).
For high-risk reasoning, prefer stronger models. Fast models are fine for mechanical work.
Subagents need enough tools for their role; reviewer stays read-only.

## Formal VOI gate (when to research vs decide)

- Classify unknowns into:
  - **Decidable-by-data** (resolve via code/docs/tests/sources), and
  - **Undecidable-now** (value tradeoff/policy preference/irreducible uncertainty).
- Run extra research only if Value-of-Information is positive in practice: likely to materially change the chosen path.
- If extra research is unlikely to change the path, stop and request a decision with a compact options/tradeoffs/risks/default packet.

## Risk tiers

Risk = uncertainty about correctness. Defined in `skills/review/SKILL.md`.
- **LOW**: well-tested, low uncertainty -> stage when ready.
- **HIGH**: any unmitigated uncertainty driver -> human reviews evidence package.

When unsure, HIGH.

## SessionStart hook (auto-nudge)

The plugin ships `hooks/hooks.json` + `hooks/session-start.js`. On every new session, the hook injects a nudge listing available minime skills and usage guidance into the agent's context. No repo-level custom instructions are needed. The nudge tells the agent to use `skill("plan")` for non-trivial tasks and documents the full chain.

## Inline task briefs (no file required)

`plan` accepts task descriptions from three sources:
1. A `task.md` file in the working directory.
2. Inline conversation context (pasted requirements, a table, verbal description).
3. User is asked to describe the task if neither is present.

Regardless of source, `plan` creates a **persisted living task brief** at `MINIME_HOME/<org>/_<repo>/tasks/<date>-<name>.task.md`. This file:
- Preserves the user's original request **verbatim** (never reworded or interpreted).
- Has checkboxes (`[ ]`/`[x]`) on every criterion, ticked by `implement` as tests pass.
- Carries a VOI level per criterion (`decided-by-data`, `needs-research`, `undecidable-now`).
- Has a Decisions table recording how each unknown was resolved and from what source.
- Grows a "Discovered during review" section for criteria surfaced after the initial EARS.
- Grows a "User feedback" section with verbatim human corrections (timestamped, unedited).

The task brief is the cross-phase task record and the traceable record of how a feature's requirements evolved.

## Session harvest (no merge required)

`harvest` accepts lessons from the current session even without a merge event. It looks for:
- Human corrections to the agent's approach or output.
- Design decisions with rationale worth preserving.
- Patterns discovered during implementation.
Code-cited lessons go to the wiki; purely process knowledge goes to the director's project memory.

`harvest` also reads the persisted task brief's Decisions table and "Discovered during review" section to learn what categories of criteria the EARS consistently misses. That meta-learning feeds the director's process memory and sharpens future EARS nudges.

## Git timeline decoupling

Minime does not force the user's git commit cadence. The user commits when ready. `harvest` works from session context, not only from merge events.

## Files in this repo

```
ORCHESTRATION.md                        this file
task.template.md                        the short EARS-style task brief you fill in per task
CLAUDE.md                               pointer for Claude Code
.github/copilot-instructions.md         pointer for GitHub Copilot surfaces
.agent/wiki/<org>/_<repo>/wiki.md            symlink to MINIME_HOME/<org>/_<repo>/wiki.md
.agent/wiki/_TEMPLATE.md                wiki entry format
.agent/research/REFERENCES.md           empirical basis for every design decision
```

The four skills (`plan`, `implement`, `review`, `harvest`) live in the **minime plugin** at `<plugin-cache>/skills/<name>/SKILL.md`, not in this repo. Invoke them with `skill("plan")`, `skill("implement")`, etc.

The plugin also ships:

- **`hooks/`**: a SessionStart hook that auto-nudges the agent toward the
  structured workflow on every new session.
- **`minime:director`**: runs the flow end-to-end. Start an autopilot
  session for a single task with `claude --agent minime:director`. It
  re-injects the flow's discipline at every phase boundary and stops only
  when it needs you (HIGH-risk review, or a destructive action).
- **`minime:reviewer`**: the read-only reviewer the `review` skill forks
  into. Lives in a fresh context window with no `Edit`/`Write` tools, so
  it is structurally unable to "fix" anything and can only surface. This
  isolation is what makes the evidence package worth more than an inline
  self-review.

## Per-repo setup

The wiki is keyed by repo URL. The init skill derives the path automatically from `git remote get-url origin`. For example, `github.com/acme/billing` becomes `MINIME_HOME/acme__billing/wiki.md`. The canonical data lives in your user home. `MINIME_HOME` is resolved by the SessionStart hook (defaults to `$HOME/.minime`, overridable via env var).
