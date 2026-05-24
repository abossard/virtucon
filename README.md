# minime

**Evidence-based agent orchestration for Claude Code and GitHub Copilot.**
A four-phase workflow: `plan -> implement -> review -> harvest`. It collapses
the usual `brainstorm -> plan-review -> code -> code-review` pipeline into **one
tiered human review gate**. The gate stays cheap by handing the reviewer an evidence
package instead of a verdict.

The core workflow is informed by empirical work (DeepMind 2025, Springer 2026,
ClassEval). See [`assets/.agent/research/REFERENCES.md`](assets/.agent/research/REFERENCES.md).

---

## What you get

Five skills + two agents, distributed as a plugin:

| Skill | Phase | Auto-invoked? |
|---|---|---|
| `/minime:plan` | Read wiki, nudge EARS quality if needed, plan silently, self-challenge | yes |
| `/minime:implement` | Test-driven generate->run->observe->fix loop | yes |
| `/minime:review` | Verify criteria against evidence; route by uncertainty tier | yes |
| `/minime:harvest` | Capture corrections into the per-repo wiki as cited rules | yes |
| `/minime:init-orchestration` | One-time bootstrap of user-home minime state (no repo writes) | manual only |

| Agent | Role |
|---|---|
| `minime:director` | Runs the flow end-to-end. Invokes skills in sequence, enforces phase transitions. Designed for `claude --agent minime:director`. |
| `minime:reviewer` | Read-only reviewer. No Edit/Write tools. Configured to surface evidence only. Forks automatically from the `review` skill in a fresh context. |

Runtime state lives in `MINIME_HOME` (defaults to `$HOME/.minime`, overridable via env var).
The SessionStart hook resolves and injects the canonical paths into every session.

### Subagent policy

- For high-risk or cross-cutting reasoning, prefer stronger models. Fast models are acceptable for mechanical lookups.
- Give subagents enough tools for the task. Review is the exception: `minime:reviewer` stays read-only.

### Formal VOI policy (decision hygiene)

- Treat unknowns as **decidable-by-data** first; only escalate true **undecidable-now** tradeoffs to user decisions.
- Apply a Value-of-Information gate: run additional research only if it is likely to materially change the choice.
- When a decision is still needed, present a compact decision packet (options, tradeoffs, risks, default recommendation).

---

## Install: Claude Code

In Claude Code, add this repo as a marketplace and install the plugin:

```text
/plugin marketplace add abossard/minime
/plugin install minime@minime
```

Run the bootstrap once (from anywhere):

```text
/minime:init-orchestration
```

This initializes `MINIME_HOME` only and does not create or stage files in your repo.

After that, the orchestration is live: describe your task inline or write a `task.md`, invoke
`/minime:plan`, and follow the flow. No `task.md` file is required. Plan accepts inline context.

### SessionStart hook (auto-nudge)

The plugin ships a `hooks/hooks.json` that injects a nudge into every new session, reminding the
agent that minime skills are available and should be used for non-trivial tasks. This works
automatically. No repo-level custom instructions are needed.

---

## Install: GitHub.com (Copilot Cloud Agent)

Copilot cloud agent on GitHub.com supports **custom agents, agent skills, and hooks** natively.
You can use minime's full orchestration on github.com by placing the skill and agent files
in your repository's `.github/` directory.

The only feature that is **CLI-only** is the plugin marketplace install command (`copilot plugin install`).
On github.com you add the files directly to your repo instead.

### Step-by-step: add minime to a repository for GitHub.com

**Option A: Install with `gh skill` (recommended)**

```bash
# Install all minime skills into your repo (run from inside your target repo)
gh skill install abossard/minime plan
gh skill install abossard/minime implement
gh skill install abossard/minime review
gh skill install abossard/minime harvest
gh skill install abossard/minime init-orchestration
```

Then add the agent profiles and hooks:

```bash
# Copy agent profiles (gh skill doesn't handle agents yet)
mkdir -p .github/agents
curl -sL https://raw.githubusercontent.com/abossard/minime/main/agents/director.md \
  -o .github/agents/minime-director.agent.md
curl -sL https://raw.githubusercontent.com/abossard/minime/main/agents/reviewer.md \
  -o .github/agents/minime-reviewer.agent.md

# Copy hooks
mkdir -p .github/hooks
curl -sL https://raw.githubusercontent.com/abossard/minime/main/hooks/hooks.json \
  -o .github/hooks/minime-hooks.json
curl -sL https://raw.githubusercontent.com/abossard/minime/main/hooks/session-start.js \
  -o .github/hooks/session-start.js
```

Commit and push:

```bash
git add .github/skills/ .github/agents/ .github/hooks/
git commit -m "feat: add minime orchestration for Copilot"
git push
```

**Option B: Copy files manually**

```bash
# From a local clone of minime
git clone https://github.com/abossard/minime /tmp/minime

# Copy into your target repo
cp -r /tmp/minime/skills/ YOUR_REPO/.github/skills/
mkdir -p YOUR_REPO/.github/agents
cp /tmp/minime/agents/director.md YOUR_REPO/.github/agents/minime-director.agent.md
cp /tmp/minime/agents/reviewer.md YOUR_REPO/.github/agents/minime-reviewer.agent.md
cp -r /tmp/minime/hooks/ YOUR_REPO/.github/hooks/

cd YOUR_REPO
git add .github/
git commit -m "feat: add minime orchestration for Copilot"
git push
```

**After install: use on GitHub.com**

- Go to [github.com/copilot/agents](https://github.com/copilot/agents)
- Select your repository from the dropdown
- Your minime agents appear in the agent picker
- Skills are loaded automatically by Copilot when relevant to your prompt
- Update skills later with `gh skill update`

### What requires separate setup

| Feature | GitHub.com | Copilot CLI |
|---------|:---:|:---:|
| Agent profiles (director, reviewer) | Yes (`.github/agents/`) | Yes (plugin or `.github/agents/`) |
| Skills (plan, implement, review, harvest) | Yes (`.github/skills/` or `gh skill install`) | Yes (plugin or `.github/skills/`) |
| Hooks (session-start nudge) | Yes (`.github/hooks/`) | Yes (plugin or `~/.copilot/hooks/`) |
| MCP server tools | Yes | Yes |
| `copilot plugin install` marketplace | No (use `gh skill install` instead) | Yes |
| Per-repo wiki (`MINIME_HOME`) | Manual setup needed | Auto via `init-orchestration` |

### References

- [About agent skills](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills)
- [Adding agent skills for cloud agent](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/add-skills)
- [Managing skills with `gh skill`](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/add-skills#managing-skills-with-github-cli)
- [Creating custom agents for cloud agent](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/create-custom-agents)
- [Hooks for cloud agent](https://docs.github.com/en/copilot/concepts/agents/hooks)
- [Customization cheat sheet (feature matrix)](https://docs.github.com/en/copilot/reference/customization-cheat-sheet)
- [Agent Skills specification (open standard)](https://agentskills.io/specification)

---

## Install: GitHub Copilot CLI

Copilot CLI uses the same Agent Skills standard, so the same skill files work.

### Recommended (team/shared): install from marketplace

```bash
copilot plugin marketplace add abossard/minime
copilot plugin install minime@minime
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

### Direct-from-repo install (best for development/testing)

Install straight from GitHub:

```bash
copilot plugin install abossard/minime
```

Or install from a local checkout:

```bash
git clone https://github.com/abossard/minime ~/.minime
copilot plugin install ~/.minime
```

When you edit plugin files locally, reinstall to refresh the cache:

```bash
copilot plugin install ~/.minime
```

### Initialize user-home state

After plugin install:

```text
/minime:init-orchestration
```

The init skill creates user-home state only:
- `MINIME_HOME/templates/task.template.md`
- `MINIME_HOME/<org>/_<repo>/wiki.md`
- `MINIME_HOME/<org>/wiki.md`

---

## Use

Two modes: pick the one that fits the task.

### Manual mode (explicit, step-by-step)

1. **Per task**: describe your task inline to the agent, or copy
   `MINIME_HOME/templates/task.template.md` -> `task.md` and fill in EARS-style
   acceptance criteria. **No file required.** Plan accepts conversation context directly.
2. **Start the flow**: `skill("plan")`. Reads your task brief (inline or file) and the
   per-repo wiki, discovers other installed skills, nudges EARS quality when needed,
   then plans silently and tells you to invoke `skill("implement")`.
3. **Implement**: `skill("implement")`. Test-first loop, real output observed.
   Hands off with explicit instruction to invoke `skill("review")`.
4. **Review**: `skill("review")`. Forks into `minime:reviewer`
   (fresh context, read-only tools). Checks staged, unstaged, and untracked files.
   Stages if LOW risk and tests green; otherwise surfaces an evidence package for you.
5. **Harvest**: `skill("harvest")` after merge or at session end. Captures lessons
   from any corrections you made into the wiki, with code citations. Works even
   without a merge. Session lessons are harvestable too.

### Autopilot mode (director agent runs the flow)

Start a session as the director:

```bash
claude --agent minime:director
```

The director reads `task.md` or accepts an inline task description, runs all four phases,
and stops only when it needs you. This happens either because the review came back HIGH-risk (you see the
evidence package) or because something destructive needs your authorization.

The director uses your `project` agent memory to accumulate META-learnings
about how the flow goes in this repo over time (separate from the per-repo
corrections wiki, which captures engineering rules).

The full one-page overview is in this repository’s `assets/ORCHESTRATION.md`.

---

## Why this design

| Decision | Source |
|---|---|
| One human gate, not three | Over-structured multi-agent pipelines did not improve correctness (ClassEval Waterfall ablation). |
| Tier review by uncertainty | Confidence-based hybridization outperformed uniform review (DeepMind 2025). |
| Reviewer surfaces evidence, never a verdict | Showing verdicts caused over-reliance; evidence alone did not (DeepMind 2025). |
| Per-repo wiki with cited entries | Repo-scoped, citation-verified memories (GitHub Copilot agentic memory 2026). |

Full citations in [`assets/.agent/research/REFERENCES.md`](assets/.agent/research/REFERENCES.md).

---

## Repo layout

- `.claude-plugin/`
  - `marketplace.json`: this repo is also its own Claude Code marketplace
  - `plugin.json`: plugin manifest
- `hooks/`
  - `hooks.json`: SessionStart hook config (auto-nudge on session start)
  - `session-start.js`: injects skill awareness into every session
- `skills/`
  - `plan/SKILL.md`
  - `implement/SKILL.md`
  - `review/SKILL.md`: forks into minime:reviewer
  - `harvest/SKILL.md`
  - `init-orchestration/SKILL.md`
- `agents/`
  - `director.md`: minime:director. Runs the flow end-to-end
  - `reviewer.md`: minime:reviewer. Read-only evidence reviewer
- `assets/`: reference assets and templates used by the plugin
  - `ORCHESTRATION.md`
  - `task.template.md`
  - `CLAUDE.md`
  - `.github/copilot-instructions.md`
  - `.agent/wiki/_TEMPLATE.md`
  - `.agent/research/REFERENCES.md`

## License

MIT. See `LICENSE`.
