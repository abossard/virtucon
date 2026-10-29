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

You start with a task description. The conductor (or the `minime:dr-evil` agent inside a chat) runs four phases: blueprint, replicate, inspect, and extract. Each phase is a fresh Copilot worker. Large builds split into groups that run in waves, follow-up rounds stay scoped to the criteria they touch, and you only judge choices that data can't settle. A board on `127.0.0.1` shows the proof as it builds up and lets you answer questions, steer, pause or stop.

## Features

- **A short blueprint:** your inputs verbatim, EARS criteria that quote them and carry their evidence in brackets, and narrow boundary interfaces. Smaller is better: `check` warns above 2 KB without the inputs. No history: corrections replace text and the old version goes to raw. `blueprint.mjs check` rejects prose and enforces the traceability. Tests stay in your code.
- **Predictions, not assumptions:** every unknown becomes a prediction that a worker checks by running code, reading the repo, research or the wiki, strongest first. A run that contradicts its prediction is a surprise, and surprises are what the wiki learns first. A recommendation you accept unchanged is recorded as `default:`, not as your decision.
- **A conductor with a board:** `node conductor/minime.mjs` runs the flow as code, so every run follows the same steps. Its board shows each phase with live worker activity, a proof board (criterion, quote, tests, state), scores (proven criteria, net lines, copied blocks, surprises, requests, minutes), one-click answers for open decisions and a box for feedback. Dr. Evil follows the same flow inside a Copilot or Claude Code chat.
- **Execution-grounded implementation:** replicate starts from a reproduction (bug) or the thinnest end-to-end slice through the planned boundaries (feature), then writes a test in your own suite for each criterion, named with its ID, watches it fail and makes the smallest change behind a narrow interface that passes. `blueprint.mjs coverage` lists the test files that name each criterion.
- **Fresh inspection against the text:** the `minime:frau` inspector starts without the implementer's context and checks the code against what the blueprint says. It reports failing tests, failing realistic inputs and quoted deviations, never opinions. A diff ratchet (`blueprint.mjs diff`) flags interface changes outside the boundaries, functions with one caller and copied blocks.
- **Standalone design reviews:** [minime:ousterhout-review](skills/ousterhout-review/SKILL.md) combines available architecture skills with Ousterhout's design principles; [minime:simplicity-review](skills/simplicity-review/SKILL.md) combines optional Ponytail reviews with data, calculations, actions, and effect-safety checks. Both also support the existing flow.
- **The board as a Copilot canvas:** the `minime-flow` canvas in the Copilot app is the conductor board. It owns a conductor run: start a task, answer questions, send feedback, pause or stop, and watch the phases, scores and proof board. Closing the canvas stops its workers. It is the same page and code as `node conductor/minime.mjs`. The wiki canvas searches all repositories by default, offers a removable current-repository preset, and keeps raw sources read-only.
- **A wiki that learns:** minime retrieves relevant cited wiki entries during planning and captures verified lessons (a test, a command output or your words) as small deltas. It also learns from your own edits of earlier agent code. `wiki-lint.mjs` checks every changed page and lists pages no blueprint cited, which a health check retires to raw.
- **Automatic local setup:** a session hook creates the knowledge and blueprint directories under `VIRTUCON_HQ` and copies the default wiki schema and topic template when they are missing. The default location is `$HOME/.minime`.
- **Model policy:** minime respects Copilot App model defaults. It sets task-level model overrides only when you select them.

The phase badges above link to each skill. The [orchestration guide](assets/ORCHESTRATION.md) owns the flow; the [blueprint template](skills/blueprint/template.md) shows the contract every phase works against.

## What changed in 0.5.0b

Since 0.3.1b (2026-10-23):

- **Conductor and board.** `node conductor/minime.mjs` runs the flow as code with a board on `127.0.0.1`; the `minime-flow` canvas is that board inside the Copilot app. The blueprint editor canvas, its server and its UI bundle are gone; the wiki canvas keeps blueprints read-only and opens the board instead. The session nudge prints the conductor command.
- **Lean blueprint.** Three sections: Inputs, Criteria, Boundaries. Decisions, Flows, Constraints, Out of scope and Tests are gone; every value a criterion states ends with the evidence that settled it (`ran:`, `data:`, `research:`, `user:`, `default:` or an `open:` question), and `check` rejects the old sections, a criterion without evidence and `(D1)` references. The size goal is 2 KB without the inputs. An existing blueprint with a Decisions or Flows section fails `check`: fold its facts into the criteria and boundary rows.
- **No review before the build.** A blueprint that returns done is built at once; inspect runs after replicate only. Workers reply with one JSON object and nothing else, and the report is one line per item.
- **Existing tests are the contract.** Removed or rewritten lines of existing tests are counted mechanically and need your answer once per blueprint, with keep recommended. Replicate starts from a reproduction or the thinnest end-to-end slice.
- **Groups and splits.** A round that touches more than three boundary rows builds in groups and waves; a blueprint past the size goal splits into a tree of children, built before the root.
- **Wiki.** A rule needs a receipt (a test, a command with its output, your words); one rule changes at a time; pages no blueprint cited retire to `raw/_retired/` after 60 days (`wiki-lint.mjs` lists them as unused); each repository scope keeps `process-<phase>.md` pages with rules the phases read.
- **Worker guard rails.** The conductor denies workers the `git` commands that stage, commit, push or rewrite the tree, and GitHub writes (`gh repo fork`, `gh pr create` and the like).
- **Benchmark record.** Three rounds of the flow measured against hidden tests on SWE-bench and the author's own tasks, with the decisions for the next variant, in [docs/autoresearch.md](docs/autoresearch.md). Those decisions (one build per blueprint, defaults instead of asks, process pages parked) are not in this version.

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

Run the conductor from your repository and open the board link it prints:

```bash
node ~/.copilot/installed-plugins/virtucon/minime/conductor/minime.mjs --repo . "describe the change"
```

Options: `--port <n>` (default 4177), `--model <id>`, `--open` to open the board in the browser. Without a task, the board asks for one. The session nudge prints the exact path of your installed copy.

Or start Copilot CLI with Dr. Evil:

```bash
copilot --agent minime:dr-evil
```

Describe the coding task in the prompt. Dr. Evil runs the flow and returns the evidence or decisions that need your attention. Set `VIRTUCON_HQ` before launch if you want minime to store its local state somewhere other than `$HOME/.minime`.

The standalone reviews optionally reuse [Matt Pocock's skills](https://github.com/mattpocock/skills) for architecture exploration and design, and [Ponytail](https://github.com/DietrichGebert/ponytail) for over-engineering reviews. Both reviews also work without these integrations.

## Copilot App

The minime board opens as a canvas (`minime-flow`): the same page and conductor as `node conductor/minime.mjs`, run for the session's repository. Next to it, the wiki canvas browses the shared knowledge. See the [Canvas tour](docs/canvases.md) for screenshots and controls, or [Canvas guidance](assets/CANVAS.md) for agent behavior.

The [orchestration guide](assets/ORCHESTRATION.md) defines how work proceeds, how corrections take effect, and when a decision needs your input.

## Evaluation harness

For the promptfoo default-versus-minime benchmark harness, see [evals/promptfoo/README.md](evals/promptfoo/README.md).

The benchmark that drives the flow's changes, with three rounds so far, the decisions for the next variant and how to continue, is recorded in [docs/autoresearch.md](docs/autoresearch.md).

## Inspiration

minime's workflow draws on research into code-generation agents, human oversight, context degradation, and long-term agent memory.

Studies of code-generation agents found that execution-grounded debugging loops outperform conversational review loops. A ClassEval ablation also found that testing contributed more than extra workflow stages. Those results motivate minime's run, observe, and fix cycle.

A 2025 Google DeepMind study found that AI verdicts can increase reviewer over-reliance. Raw evidence helped reviewers without hurting them when the AI was wrong. minime gives a fresh inspector the job of gathering test output, diffs, assumptions, and inconsistencies for human judgment.

Research on multi-turn degradation and context rot motivates short phase handoffs through a persisted blueprint. GitHub's agentic memory work and Karpathy's LLM wiki pattern inspired the cited raw and wiki knowledge store.

The proof-first design follows recent work on how agent code degrades over iterations (SlopCodeBench), reward hacking on tests (METR, ImpossibleBench), reproduction tests (SWT-Bench), property-based testing agents, single-writer orchestration (Cognition), context rot (Chroma), repository instruction files (ETH AGENTS.md study), incremental context updates (ACE) and verified agent memory (VibeMemBench).

Read the [research basis and full citations](assets/.agent/research/REFERENCES.md).

## License

MIT. See [LICENSE](LICENSE).
