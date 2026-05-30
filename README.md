<div align="center">

<img src="assets/banner.png" alt="Virtucon Labs - We Complete You" width="100%" />

<br/>

[![Blueprint](https://img.shields.io/badge/①_Blueprint-Clone_Plan-E91E63?style=for-the-badge&labelColor=1a1a2e)](skills/blueprint/SKILL.md)
[![Replicate](https://img.shields.io/badge/②_Replicate-Clone_Build-E91E63?style=for-the-badge&labelColor=1a1a2e)](skills/replicate/SKILL.md)
[![Inspect](https://img.shields.io/badge/③_Inspect-Clone_Check-E91E63?style=for-the-badge&labelColor=1a1a2e)](skills/inspect/SKILL.md)
[![Extract](https://img.shields.io/badge/④_Extract-DNA_Harvest-E91E63?style=for-the-badge&labelColor=1a1a2e)](skills/extract/SKILL.md)

**One human gate. Maximum evil.**

[![License: MIT](https://img.shields.io/badge/License-MIT-silver?style=flat-square)](LICENSE)
[![Plugin](https://img.shields.io/badge/Copilot_Plugin-minime-E91E63?style=flat-square&logo=github)](https://github.com/abossard/virtucon)

</div>

---

> *"You complete me."* - Dr. Evil

**Evidence-based agent orchestration for GitHub Copilot.**

Four phases. One tiered human gate. The gate stays cheap by handing the inspector an evidence package instead of a verdict, then using `ask_user` only when human input is truly required.

The core workflow is informed by empirical work (DeepMind 2025, Springer 2026, ClassEval). See [`REFERENCES.md`](assets/.agent/research/REFERENCES.md).

---

## 🧬 What you get

Five skills plus two agents, distributed as a plugin:

| | Skill | Phase | Auto |
|---|---|---|:---:|
| ![1](https://img.shields.io/badge/-1-E91E63?style=flat-square) | `/minime:blueprint` | Read ranked wiki pages, nudge EARS quality, plan silently, self-challenge | ✅ |
| ![2](https://img.shields.io/badge/-2-E91E63?style=flat-square) | `/minime:replicate` | Test-driven generate -> run -> observe -> fix loop | ✅ |
| ![3](https://img.shields.io/badge/-3-E91E63?style=flat-square) | `/minime:inspect` | Verify criteria against evidence; route by uncertainty tier | ✅ |
| ![4](https://img.shields.io/badge/-4-E91E63?style=flat-square) | `/minime:extract` | Capture lessons into the raw/wiki knowledge base with code citations | ✅ |
| ![⚗️](https://img.shields.io/badge/-⚗️-silver?style=flat-square) | `/minime:lab` | Bootstrap Virtucon HQ (auto-runs via session-start hook) | 🔧 |

| Agent | Role |
|---|---|
| `minime:dr-evil` | 🦹 Runs the flow end-to-end. `claude --agent minime:dr-evil` |
| `minime:frau` | 👓 Evidence-gathering inspector in fresh context. Full tool access, no implementation writes. |

Runtime state lives in `VIRTUCON_HQ` (defaults to `$HOME/.minime`, overridable via env var).
The SessionStart hook resolves paths, injects them into every session, and auto-bootstraps the Karpathy-style knowledge layout.

### Knowledge layout

Each repo and org root uses:
- `raw/` for immutable source documents such as findings, results, user messages, and hard-won discoveries
- `wiki/` for linked markdown pages, including `index.md`, `log.md`, and topic pages
- `schema.md` for the conventions that shape the wiki

The previous `wiki.md` becomes `raw/legacy-wiki.md` when bootstrap sees it.
Logs and large outputs stay in execution evidence, not in `raw/`.

### 🔐 Subagent policy

- Always use strong, high-reasoning models for subagents.
- Give subagents all tools.

### 📊 Formal VOI policy (decision hygiene)

- Treat unknowns as **decidable-by-data** first; only escalate true **undecidable-now** tradeoffs to user decisions.
- Apply a Value-of-Information gate: run additional research only if it is likely to materially change the choice.
- When a decision is still needed, use `ask_user` with evidence, suggestions, confidence, reasoning, and a free-text override.

---

The session-start hook auto-bootstraps `VIRTUCON_HQ` and injects a nudge into every session.
No repo-level custom instructions are needed. Describe your task inline and invoke `/minime:blueprint` to start the flow.

---

## 💻 Install: GitHub Copilot CLI

### Recommended (team/shared): install from marketplace

```bash
copilot plugin marketplace add abossard/virtucon
copilot plugin install virtucon@minime
```

Verify and inspect what loaded:

```bash
copilot plugin list
copilot plugin marketplace list
```

In an interactive session:

```text
/agent
/skills list
```

Update to latest published version:

```bash
copilot plugin update minime
```

### ⚗️ Initialize Virtucon HQ

The session-start hook auto-bootstraps `VIRTUCON_HQ` on every session.
Manual bootstrap is rarely needed:

```text
/minime:lab
```

---

## 🎮 Use

Two modes: pick the one that fits the task.

### 🔧 Manual mode (step-by-step)

1. Describe your task inline. Blueprint accepts conversation context directly.
2. `skill("blueprint")` -> reads ranked wiki pages, nudges EARS, plans, hands off to replicate.
3. `skill("replicate")` -> test-first loop, hands off to inspect.
4. `skill("inspect")` -> forks into `minime:frau` (fresh context). LOW risk = stage; HIGH = `ask_user` with an evidence package.
5. `skill("extract")` -> captures lessons into the raw/wiki knowledge base with code citations.

### 🦹 Autopilot mode

```bash
copilot --agent minime:dr-evil
```

Dr. Evil runs all four phases and uses `ask_user` only for HIGH-risk evidence packages or destructive actions.
See `assets/ORCHESTRATION.md` for the full flow.

---

## 🧪 Why this design

> *"How about... automate with feeling!"*

| Decision | Source |
|---|---|
| One human gate, not three | Over-structured multi-agent pipelines did not improve correctness (ClassEval Waterfall ablation). |
| Tier inspection by uncertainty | Confidence-based hybridization outperformed uniform review (DeepMind 2025). |
| Inspector surfaces evidence, never a verdict | Showing verdicts caused over-reliance; evidence alone did not (DeepMind 2025, APA 2026). |
| Karpathy-style raw/wiki knowledge base with citations | Repo-scoped, citation-verified memory compounds best when raw sources and maintained wiki pages are separated. |
| Harness over model | Same LLM: 42% to 78% on SWE-bench from scaffolding alone (Particula 2026). |
| Frau fork for bias removal | Homogeneous multi-agent can be collapsed (OneFlow 2026), but fresh context removes sunk-cost blindness. |

**Inspection routes**

| Risk | Route |
|---|---|
| ![LOW](https://img.shields.io/badge/LOW-4CAF50?style=flat-square) | Auto-stage |
| ![MEDIUM](https://img.shields.io/badge/MEDIUM-FFC107?style=flat-square) | Evidence package |
| ![HIGH](https://img.shields.io/badge/HIGH-E91E63?style=flat-square) | `ask_user` evidence package |

Full citations in [`assets/.agent/research/REFERENCES.md`](assets/.agent/research/REFERENCES.md).

---

<div align="center">

*"One hundred billion dollars!"* - Dr. Evil (on the value of good agent orchestration)

**Trust, but verify (with evidence).** 🧠

[![Built with](https://img.shields.io/badge/Built_with-Pervasive_Literalness-E91E63?style=flat-square&labelColor=1a1a2e)](https://github.com/abossard/virtucon)
[![Today's Mission](https://img.shields.io/badge/Mission-Build_intelligent_agents-silver?style=flat-square&labelColor=1a1a2e)](https://github.com/abossard/virtucon)

</div>

## License

MIT. See `LICENSE`.
