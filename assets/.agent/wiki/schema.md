# Wiki schema

Conventions for the minime knowledge root. An agent reads the wiki to pick up the few rules that change its work in a repository. Every page competes for that agent's attention, so each line has to earn its place.

## Layers

- `raw/<org>/<repo>/`: immutable source material (user feedback, curated findings, decisions, failed approaches). Add files; leave existing ones byte-identical. Cross-repo material goes in `raw/_global/`. Keep logs and bulk output out.
- `wiki/`: maintained guidance derived from raw. Repository rules live in `wiki/orgs/<org>/<repo>/`; rules that hold across repositories or for a tool or platform (Bash, PowerShell, KQL, Grafana, Azure CLI) live in `wiki/patterns/`.
- `schema.md` (this file) and `_TEMPLATE.md` (topic page shape).
- `<org>/_<repo>/blueprints/`: task plans. Harvest input for the wiki.

The knowledge root lives only on this machine and stays outside Git: no `git init`, commits or tracking, and no reports that it is untracked or at risk. Write files in place.

One scope per repository, keyed by the configured origin. Forks and upstreams of one codebase share the scope where the work happens; the scope index names the other remote.

## Navigation

Two-level catalog:

1. `wiki/index.md` lists every scope index and every pattern, one line each, patterns grouped under theme headings.
2. `wiki/orgs/<org>/<repo>/index.md` lists the pages of that scope:

```markdown
# <org>/<repo>

<repo URL> · <what the repo is, one line>

## Read first
- [<imperative rule>](./<page>.md#<anchor>)   (3-7 rules that bite most often)

## Pages
- [<Title>](./<page>.md): Read when <trigger>.

## Related patterns
- [<Title>](../../../patterns/<page>.md)
```

`wiki/log.md` records activity, newest first, one line per event:
`- YYYY-MM-DD <extract|lint|reorg> <org>/<repo>: <what changed, at most 20 words>` (`_global` for cross-repo events)
Keep it under 100 lines; move older lines to `wiki/log/archive.md`.

## Page rules

A rule earns its place when all of these hold:

- It changes what an agent does compared with its default behaviour.
- Rediscovering it costs real time: a human correction or preference, a gotcha, an unwritten convention, the reason behind a choice.
- Current code, docs or a user decision backs it.
- The environment does not already state it in one lookup (README, config file, `--help`).

Cut on sight: task narratives, event dates, revision histories, proof receipts and test counts, evidence lists past the best two citations, restated rules, generic engineering advice, CAPS emphasis, em dashes.

Shape:

- One topic per page, named for the topic: `list-tool-payloads.md`, never `healthmodels-lean-dto-2026-06-30.md`. Raw files keep their date suffix.
- At most 8 rules and 80 lines per page (about 6 KB). Split by trigger when a page grows past that.
- Rule headings are imperative and state the target behaviour: "Project list results to a fixed 5-field DTO".
- Rule body: 1-3 sentences with the consequence of missing it. Quote a human correction verbatim in one short line when the wording carries the preference.
- Evidence: `path:line` plus symbol on the default branch, or a URL for external facts, plus one link to the raw source. Code that exists only on a PR or fork branch gets the branch and short SHA; label uncommitted code `local, uncommitted` and back the rule with raw.
- Add a code example only when prose cannot carry the rule; keep it under 10 lines.
- State each meaning once. Link to the page that owns it instead of repeating it. When a rule moves into a pattern, the scope's next extract replaces its copy with a link.
- A rule that stops being true gets `- **Status:** superseded by <rule>` or `- **Status:** stale`. Delete it once raw holds the history and no active page depends on it.

Links are relative. Raw from a repo page: `../../../../raw/<org>/<repo>/<file>.md`; from a pattern: `../../raw/<org>/<repo>/<file>.md`. Write external URLs that contain `.md` as reference links (`[text][id]` plus `[id]: <url>`), because the whole-wiki link check reads every `](...md` target as a relative path.
