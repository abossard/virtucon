<div align="center">

<img src="assets/banner.png" alt="Virtucon Labs — We Complete You" width="100%" />

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

> *"You complete me."* — Dr. Evil

**Evidence-based agent orchestration for GitHub Copilot.**

Four phases. One tiered human gate. The gate stays cheap by handing the inspector
an evidence package instead of a verdict.

The core workflow is informed by empirical work (DeepMind 2025, Springer 2026,
ClassEval). See [`REFERENCES.md`](assets/.agent/research/REFERENCES.md).

---

## 🧬 What you get

Five skills + two agents, distributed as a plugin:

| | Skill | Phase | Auto |
|---|---|---|:---:|
| ![1](https://img.shields.io/badge/-1-E91E63?style=flat-square) | `/minime:blueprint` | Read wiki, nudge EARS quality, plan silently, self-challenge | ✅ |
| ![2](https://img.shields.io/badge/-2-E91E63?style=flat-square) | `/minime:replicate` | Test-driven generate → run → observe → fix loop | ✅ |
| ![3](https://img.shields.io/badge/-3-E91E63?style=flat-square) | `/minime:inspect` | Verify criteria against evidence; route by uncertainty tier | ✅ |
| ![4](https://img.shields.io/badge/-4-E91E63?style=flat-square) | `/minime:extract` | Capture corrections into the per-repo wiki as cited rules | ✅ |
| ![⚗️](https://img.shields.io/badge/-⚗️-silver?style=flat-square) | `/minime:lab` | One-time bootstrap of Virtucon HQ (no repo writes) | 🔧 |

| Agent | Role |
|---|---|
| `minime:dr-evil` | 🦹 **Dr. Evil** — Runs the flow end-to-end. Invokes skills in sequence, enforces phase transitions. `claude --agent minime:dr-evil` |
| `minime:frau` | 👓 **Frau Inspector** — Evidence-gathering inspector. Full tool access for investigation — can run tests, write probes, execute commands. Must not modify implementation code. Forks from `inspect` in a fresh context. |

Runtime state lives in `VIRTUCON_HQ` (defaults to `$HOME/.minime`, overridable via env var).
The SessionStart hook resolves and injects the canonical paths into every session.

### 🔐 Subagent policy

- For high-risk or cross-cutting reasoning, prefer stronger models. Fast models are acceptable for mechanical lookups.
- Give subagents enough tools for the task. `minime:frau` has full tool access for investigation but must not modify the implementation under review.

### 📊 Formal VOI policy (decision hygiene)

- Treat unknowns as **decidable-by-data** first; only escalate true **undecidable-now** tradeoffs to user decisions.
- Apply a Value-of-Information gate: run additional research only if it is likely to materially change the choice.
- When a decision is still needed, present a compact decision packet (options, tradeoffs, risks, default recommendation).

---


This initializes `VIRTUCON_HQ` only and does not create or stage files in your repo.

After that, the orchestration is live: describe your task inline or write a `task.md`, invoke
`/minime:blueprint`, and follow the flow. No `task.md` file is required. Blueprint accepts inline context.

### SessionStart hook (auto-nudge)

The plugin ships a `hooks/hooks.json` that injects a nudge into every new session, reminding the
agent that minime skills are available and should be used for non-trivial tasks. This works
automatically. No repo-level custom instructions are needed.

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

After plugin install:

```text
/minime:lab
```

The lab skill creates user-home state only:
- `VIRTUCON_HQ/templates/task.template.md`
- `VIRTUCON_HQ/<org>/_<repo>/wiki.md`
- `VIRTUCON_HQ/<org>/wiki.md`

---

## 🎮 Use

Two modes: pick the one that fits the task.

### 🔧 Manual mode (explicit, step-by-step)

1. **Per task**: describe your task inline to the agent, or copy
   `VIRTUCON_HQ/templates/task.template.md` → `task.md` and fill in EARS-style
   acceptance criteria. **No file required.** Blueprint accepts conversation context directly.
2. **Start the flow**: `skill("blueprint")`. Reads your task brief (inline or file) and the
   per-repo wiki, discovers other installed skills, nudges EARS quality when needed,
   then plans silently and tells you to invoke `skill("replicate")`.
3. **Replicate**: `skill("replicate")`. Test-first loop, real output observed.
   Hands off with explicit instruction to invoke `skill("inspect")`.
4. **Inspect**: `skill("inspect")`. Forks into `minime:frau`
   (fresh context, full tool access). Checks staged, unstaged, and untracked files.
   Stages if LOW risk and tests green; otherwise surfaces an evidence package for you.
5. **Extract**: `skill("extract")` after merge or at session end. Captures lessons
   from any corrections you made into the wiki, with code citations. Works even
   without a merge. Session lessons are extractable too.

### 🦹 Autopilot mode (Dr. Evil runs the operation)

Start a session as Dr. Evil:

```bash
copilot --agent minime:dr-evil
```

Or use /agent to select Dr. Evil:

```text
/agent
```

Dr. Evil reads `task.md` or accepts an inline task description, runs all four phases,
and stops only when it needs you. This happens either because the inspection came back HIGH-risk (you see the
evidence package) or because something destructive needs your authorization.

Dr. Evil uses your `project` agent memory to accumulate META-learnings
about how the flow goes in this repo over time (separate from the per-repo
corrections wiki, which captures engineering rules).

The full one-page overview is in this repository's `assets/ORCHESTRATION.md`.

---

## 🧪 Why this design

> *"How about... automate with feeling!"*

| Decision | Source |
|---|---|
| One human gate, not three | Over-structured multi-agent pipelines did not improve correctness (ClassEval Waterfall ablation). |
| Tier inspection by uncertainty | Confidence-based hybridization outperformed uniform review (DeepMind 2025). |
| Inspector surfaces evidence, never a verdict | Showing verdicts caused over-reliance; evidence alone did not (DeepMind 2025). |
| Per-repo wiki with cited entries | Repo-scoped, citation-verified memories (GitHub Copilot agentic memory 2026). |

**Inspection routes** (matching the image's uncertainty tier):

| Risk | Route |
|---|---|
| ![LOW](https://img.shields.io/badge/LOW-4CAF50?style=flat-square) | Auto-stage |
| ![MEDIUM](https://img.shields.io/badge/MEDIUM-FFC107?style=flat-square) | Evidence package |
| ![HIGH](https://img.shields.io/badge/HIGH-E91E63?style=flat-square) | **You decide** |

Full citations in [`assets/.agent/research/REFERENCES.md`](assets/.agent/research/REFERENCES.md).

---

---

<div align="center">

*"One hundred billion dollars!"* — Dr. Evil (on the value of good agent orchestration)

**Trust, but verify (with evidence).** 🧠

[![Built with](https://img.shields.io/badge/Built_with-Pervasive_Literalness-E91E63?style=flat-square&labelColor=1a1a2e)](https://github.com/abossard/virtucon)
[![Today's Mission](https://img.shields.io/badge/Mission-Build_intelligent_agents-silver?style=flat-square&labelColor=1a1a2e)](https://github.com/abossard/virtucon)

</div>

## License

MIT. See `LICENSE`.
