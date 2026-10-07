<div align="center">

<img src="assets/banner.png" alt="Virtucon Labs - We Complete You" width="100%" />

<br/>

[![Blueprint](https://img.shields.io/badge/①_Blueprint-Clone_Plan-E91E63?style=for-the-badge&labelColor=1a1a2e)](skills/blueprint/SKILL.md)
[![Replicate](https://img.shields.io/badge/②_Replicate-Clone_Build-E91E63?style=for-the-badge&labelColor=1a1a2e)](skills/replicate/SKILL.md)
[![Inspect](https://img.shields.io/badge/③_Inspect-Clone_Check-E91E63?style=for-the-badge&labelColor=1a1a2e)](skills/inspect/SKILL.md)
[![Extract](https://img.shields.io/badge/④_Extract-DNA_Harvest-E91E63?style=for-the-badge&labelColor=1a1a2e)](skills/extract/SKILL.md)

**Evidence-based task orchestration for GitHub Copilot CLI**

[![License: MIT](https://img.shields.io/badge/License-MIT-silver?style=flat-square)](LICENSE)
[![Plugin](https://img.shields.io/badge/Copilot_Plugin-minime-E91E63?style=flat-square&logo=github)](https://github.com/abossard/virtucon)

</div>

## What is minime?

minime is a GitHub Copilot CLI plugin that carries a coding task through planning, implementation, independent inspection, and knowledge capture. It addresses requirements drift in long agent sessions, reviews built on summaries instead of executed proof, and useful lessons that disappear when a session ends.

You start with a task description. The `minime:dr-evil` agent manages the work and coordinates four phases: blueprint, replicate, inspect, and extract. It dispatches one native task worker per phase, keeps criterion-linked runtime reporting, and asks you to judge choices it cannot resolve from data.

## Features

- **A living blueprint:** minime persists verifiable criteria, a visual boundary map, and design decisions across fresh contexts.
- **Native blueprint canvas:** when capability exists, minime opens or focuses the blueprint canvas, supports section-first editing plus advanced source on the same draft, preserves section boundary newlines during replacement, and falls back to the blueprint file path when canvas support is unavailable.
- **Visible work management:** Dr. Evil discovers available skills and plugins, aligns the blueprint with native plans, todos, and subagent work, and can keep an external tracker synchronized with your permission.
- **Execution-grounded implementation:** replicate runs checks for the touched surface, fixes observed failures, implements approved boundaries, and returns structural drift for a decision.
- **Fresh inspection:** the `minime:frau` inspector starts without the implementer's context, checks the current task against its criteria, and returns evidence for human judgment.
- **Standalone design reviews:** [minime:ousterhout-review](skills/ousterhout-review/SKILL.md) combines available architecture skills with Ousterhout's design principles; [minime:simplicity-review](skills/simplicity-review/SKILL.md) combines optional Ponytail reviews with data, calculations, actions, and effect-safety checks. Both also support the existing flow.
- **Global wiki canvas:** minime ships a wiki canvas that searches all repositories by default, offers a removable current-repository preset, and keeps raw sources read-only.
- **Durable project knowledge:** minime retrieves relevant cited wiki entries during planning and captures reusable lessons with links back to live code.
- **Automatic local setup:** a session hook creates the knowledge and blueprint directories under `VIRTUCON_HQ`. The default location is `$HOME/.minime`.
- **Model policy:** minime respects Copilot App model defaults. It sets task-level model overrides only when you select them.

The phase badges above link to each skill. See the [orchestration guide](assets/ORCHESTRATION.md) for workflow mechanics and policy.

## Install

Add the marketplace and install the plugin:

```bash
copilot plugin marketplace add abossard/virtucon
copilot plugin install minime@virtucon
```

Update an existing installation:

```bash
copilot plugin update minime@virtucon
```

minime does not ship a copy installer. Use `copilot plugin update` when you want the latest packaged canvases.

## Use

Start Copilot CLI with Dr. Evil:

```bash
copilot --agent minime:dr-evil
```

Describe the coding task in the prompt. Dr. Evil runs the flow and returns the evidence or decisions that need your attention. Set `VIRTUCON_HQ` before launch if you want minime to store its local state somewhere other than `$HOME/.minime`.

The standalone reviews optionally reuse [Matt Pocock's skills](https://github.com/mattpocock/skills) for architecture exploration and design, and [Ponytail](https://github.com/DietrichGebert/ponytail) for over-engineering reviews. Both reviews also work without these integrations.

## Copilot App

Minime includes an editable blueprint view and a shared wiki browser. See the [Canvas tour](docs/canvases.md) for screenshots and controls, or [Canvas guidance](assets/CANVAS.md) for agent behavior.

The [orchestration guide](assets/ORCHESTRATION.md) defines how work proceeds, how corrections take effect, and when a decision needs your input.

## Inspiration

minime's workflow draws on research into code-generation agents, human oversight, context degradation, and long-term agent memory.

Studies of code-generation agents found that execution-grounded debugging loops outperform conversational review loops. A ClassEval ablation also found that testing contributed more than extra workflow stages. Those results motivate minime's run, observe, and fix cycle.

A 2025 Google DeepMind study found that AI verdicts can increase reviewer over-reliance. Raw evidence helped reviewers without hurting them when the AI was wrong. minime gives a fresh inspector the job of gathering test output, diffs, assumptions, and inconsistencies for human judgment.

Research on multi-turn degradation and context rot motivates short phase handoffs through a persisted blueprint. GitHub's agentic memory work and Karpathy's LLM wiki pattern inspired the cited raw and wiki knowledge store.

Read the [research basis and full citations](assets/.agent/research/REFERENCES.md).

## License

MIT. See [LICENSE](LICENSE).
