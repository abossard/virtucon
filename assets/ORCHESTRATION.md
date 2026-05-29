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
  YOU: describe the task   <- only authored artifact
        │
        ▼
  (dr-evil: research if needed)  strong subagents gather cited external evidence
        │
        ▼
  skill("blueprint")      reads wiki + evidence packet, discovers installed skills,
        │            nudges EARS quality if needed, plans silently, self-challenges.
        │            NO human gate. Outputs: "now invoke skill("replicate")"
        │
        ▼
  skill("replicate") tight loop: generate -> run tests -> observe -> fix
        │            tests front-loaded. NO human gate.
        │            Outputs: "now invoke skill("inspect")"
        │
        ▼
  skill("inspect")    self-reviews staged+unstaged+untracked, computes RISK, builds EVIDENCE PACKAGE
        │
        ├── risk = LOW  + tests green ─────────────► stage (user commits when ready)
        │
        └── risk = HIGH  ──► ask_user with evidence package ──► resume
        │
        ▼
  skill("extract")   on every correction you make, writes a cited wiki entry.
                     Also captures session lessons even without a merge.
```

Blueprint accepts inline conversation context directly. Each skill explicitly tells the agent which skill to invoke next (explicit chaining).

## Ask_user rule (applies to all phases)

The session never idles. It either keeps working or calls `ask_user` when input is truly required.

**Every question to the user MUST use the `ask_user` tool.** Never ask questions in plain text output. This is a hard protocol constraint, not a style preference. A question in prose is a violation even if it contains the right content.

Use `ask_user` only for:
- genuinely blocking ambiguity after decidable-by-data checks
- missing sources after research
- HIGH-risk inspect routing
- destructive or irreversible actions

Every `ask_user` call must include:
- `evidence`: raw proof or observations that show why input is needed
- `suggestions`: options with confidence and reasoning
- `free_text`: a way for the user to override the listed options

**Anti-patterns (violations):**
- Presenting options as conversational prose: "Option A: ... Option B: ... Which do you prefer?"
- Ending a response with a question mark: "Should I proceed?" / "Want me to continue?"
- Asking for plan approval, merge approval, or phase-start confirmation
- Any question directed at the user that is not routed through `ask_user`

After the response, resume the flow from the current phase or the next required step.

## Context engineering (applies to all phases)

Context accumulates linearly; cumulative input processed over turns grows quadratically. Keep it lean:
- **Phase isolation**: dr-evil dispatches each phase in a fresh subagent. The blueprint on disk is the sole cross-phase state bus.
- **Targeted reads**: prefer `view_range` over full file views for known-large files. Use `grep` with `output_mode: "files_with_matches"` before `"content"`.
- **Research delegation**: dispatch `general-purpose` subagents. Return contracts: evidence first (raw proof, URLs, exact quotes, code paths), then citations, then ≤5 bullets of conclusions. No statements without backing evidence.
- **Persist evidence to disk**: write test outputs, plans, and resolved unknowns into the blueprint — not just into chat context.
