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
        └── risk = HIGH ──► YOU review the evidence package only ──► merge / send back
        │
        ▼
  skill("extract")   on every correction you make, writes a cited wiki entry.
                     Also captures session lessons even without a merge.
```

Blueprint accepts inline conversation context directly. Each skill explicitly tells the agent which skill to invoke next (explicit chaining).