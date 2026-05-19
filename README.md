# minime

**Evidence-based agent orchestration for Claude Code and GitHub Copilot.**
A four-phase workflow — `plan → implement → review → harvest` — that collapses
the usual `brainstorm → plan-review → code → code-review` pipeline into **one
tiered human review gate**, kept cheap by handing the reviewer an evidence
package instead of a verdict.

Every design choice traces to empirical work (DeepMind 2025, Springer 2026,
ClassEval, ReasoningBank). See [`assets/.agent/research/REFERENCES.md`](assets/.agent/research/REFERENCES.md).

---

## What you get

Five skills, distributed as a plugin:

| Skill | Phase | Auto-invoked? |
|---|---|---|
| `/minime:plan` | Read the per-repo wiki, plan silently, self-challenge | yes |
| `/minime:implement` | Test-driven generate→run→observe→fix loop | yes |
| `/minime:review` | Compute risk tier; auto-merge LOW, escalate HIGH with evidence package | yes |
| `/minime:harvest` | Capture corrections into the per-repo wiki as cited rules | yes |
| `/minime:init-orchestration` | One-time bootstrap of per-repo files into a target repo | manual only |

Plus a small set of per-repo files dropped into your target repo by `init-orchestration`:
`ORCHESTRATION.md`, `spec.template.md`, `CLAUDE.md`, `.github/copilot-instructions.md`,
`.agent/wiki/<org>__<repo>.md` (your corrections wiki), `.agent/research/REFERENCES.md`.

---

## Install — Claude Code

In Claude Code, add this repo as a marketplace and install the plugin:

```text
/plugin marketplace add abossard/minime
/plugin install minime@minime
```

Then, **inside the target repo you want to manage**, run the bootstrap once:

```text
/minime:init-orchestration
```

That stages the per-repo files. Review with `git diff --cached`, then commit.

After that, the orchestration is live: write a `spec.md` for a task, invoke
`/minime:plan`, and follow the flow.

---

## Install — GitHub Copilot CLI

Copilot CLI uses the same Agent Skills standard, so the same skill files work.

**Option A — Copilot CLI plugin (if your CLI version supports third-party plugins):**

```text
/plugin install minime@<marketplace-name>
```

(Consult Copilot CLI docs for adding `abossard/minime` as a marketplace; the plugin
file layout — `skills/<name>/SKILL.md`, `agents/`, `hooks.json`, `.mcp.json` —
matches Copilot CLI's plugin convention.)

**Option B — Per-repo install only (works for VS Code Copilot Chat, web Copilot,
Copilot Code Review, and the Copilot coding agent):**

Clone this repo somewhere and copy the asset files into your target repo by hand:

```bash
git clone https://github.com/abossard/minime ~/.minime
cd /path/to/your/target/repo
cp -r ~/.minime/assets/. .
mv .agent/wiki/_TEMPLATE.md .agent/wiki/$(git remote get-url origin \
    | sed -E 's#^.*github\.com[:/]##; s#\.git$##; s#/#__#g').md
git add ORCHESTRATION.md spec.template.md CLAUDE.md \
        .github/copilot-instructions.md .agent
```

The `.github/copilot-instructions.md` pointer is what makes every Copilot
surface (VS Code Chat, web, code review, cloud agent) pick up the flow.

---

## Use

1. **Per task, in the target repo**: copy `spec.template.md` → `spec.md`, fill
   in the acceptance criteria (EARS-style), commit it.
2. **Start the flow**: `/minime:plan`. The agent reads your spec and the
   per-repo wiki, plans silently, and hands off.
3. **Implement**: `/minime:implement`. Test-first loop, real output observed.
4. **Review**: `/minime:review`. Auto-merges if LOW risk and tests green;
   otherwise builds an evidence package for you to review.
5. **Harvest**: `/minime:harvest` after merge. Captures lessons from any
   corrections you made into the wiki, with code citations.

The full one-page overview lives in `ORCHESTRATION.md` once installed.

---

## Why this design

| Decision | Source |
|---|---|
| One human gate, not three | Over-structured multi-agent pipelines did not improve correctness in the ClassEval Waterfall ablation; spec/design stages had minimal measured effect. |
| Tier review by agent-reported risk | Confidence-based hybridization beat AI-alone and human-alone on DeepMind's Human-AI Complementarity benchmark. |
| Reviewer surfaces evidence, never a verdict | Showing AI judgments / confidence caused over-reliance and made reviewers measurably *worse* when the AI was wrong; raw evidence "helps when correct, does not hurt when wrong". |
| Per-repo corrections wiki with cited entries | Mirrors GitHub Copilot's agentic memory design: repo-scoped, citation-verified, adversarial-memory tested. |
| Score-then-inject, consolidate periodically | ExpeL/ERL and ReasoningBank — concatenating all insights scales poorly; memories should mature. |

Full citations and findings in [`assets/.agent/research/REFERENCES.md`](assets/.agent/research/REFERENCES.md).

---

## Repo layout

```
.claude-plugin/
  marketplace.json          this repo is also its own Claude Code marketplace
  plugin.json               plugin manifest
skills/
  plan/SKILL.md
  implement/SKILL.md
  review/SKILL.md
  harvest/SKILL.md
  init-orchestration/SKILL.md
assets/                     files copied into target repos by init-orchestration
  ORCHESTRATION.md
  spec.template.md
  CLAUDE.md
  .github/copilot-instructions.md
  .agent/wiki/_TEMPLATE.md
  .agent/research/REFERENCES.md
```

## License

MIT — see `LICENSE`.
