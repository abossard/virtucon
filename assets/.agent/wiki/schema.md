# Wiki schema

Conventions for the minime knowledge root. An agent reads the wiki to pick up the few rules that change its work in a repository. Every page competes for that agent's attention, so each line has to earn its place.

## Layers

- `raw/<org>/<repo>/`: immutable source material (user feedback, curated findings, decisions, failed approaches, the change diffs extract compares with the user's later edits, earlier blueprint versions under `blueprints/`). Add files; leave existing ones byte-identical. Cross-repo material goes in `raw/_global/`; retired wiki pages go in `raw/_retired/`. Keep logs and bulk output out.
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

## Process pages

The flow is a starting point. Each scope keeps the few rules that change how a phase works in this repository in `process-<phase>.md` (`blueprint`, `replicate`, `inspect`, `extract`), listed under `## Pages` as `Read when <phase> starts`. A phase opens its page before it starts and applies the rules whose shape matches.

- Process pages are exactly `process-blueprint.md`, `process-replicate.md`, `process-inspect.md` and `process-extract.md` in the repo scope. Any other `process-*.md` is an error: process rules live on the phase page.
- Pages follow `_TEMPLATE.md`. A rule's heading is the imperative and is its ID: its slug is the anchor that a blueprint criterion cites in its evidence bracket as `process-<phase>.md#<anchor>`. The body opens with `For <shape>:`, the evidence a later task sees before it makes the mistake (the words of a report, what a probe or a test showed, the wording of a criterion). Evidence links the raw copy of the finding, blocked round or correction it prevents, and LastVerified is set when a rule is added or sharpened.
- At most 5 rules per process page (instead of 8). At the cap, a new rule merges into the closest rule or replaces the one with the weakest receipt; the replaced text goes to a new file in raw.
- Before adding a rule, read the page's rules. A lesson with the shape of an existing rule sharpens that rule instead of adding one: replace its body, keep its heading and add the new citation to Evidence (the best two stay).
- A process rule's heading and body name no file, symbol, function, class, module or library; a lesson that does belongs to a topic page, which the rule links to.
- Process pages are never retired as unused.

## Page rules

A rule earns its place when all of these hold:

- It changes what an agent does compared with its default behaviour.
- Rediscovering it costs real time: a human correction or preference, a gotcha, an unwritten convention, the reason behind a choice.
- A receipt backs it: a test, a command with its output, or the user's own words. An agent's opinion is not a receipt.
- The environment does not already state it in one lookup (README, config file, `--help`).

Cut on sight: task narratives, event dates, revision histories, pasted command output and test counts (the receipt goes to raw, the page links it), evidence lists past the best two citations, restated rules, generic engineering advice, CAPS emphasis, em dashes.

Shape:

- One topic per page, named for the topic: `list-tool-payloads.md`, never `<project>-<topic>-<date>.md`. Raw files keep their date suffix.
- At most 8 rules and 80 lines per page (about 6 KB). Split by trigger when a page grows past that.
- Rule headings are imperative and state the target behaviour: "Project list results to a fixed 5-field DTO".
- Rule body: 1-3 sentences with the consequence of missing it. Quote a human correction verbatim in one short line when the wording carries the preference.
- Evidence: `path:line` plus symbol on the default branch, or a URL for external facts, plus one link to the raw source. Code that exists only on a PR or fork branch gets the branch and short SHA; label uncommitted code `local, uncommitted` and back the rule with raw.
- Add a code example only when prose cannot carry the rule; keep it under 10 lines.
- State each meaning once. Link to the page that owns it instead of repeating it. When a rule moves into a pattern, the scope's next extract replaces its copy with a link.
- A rule that stops being true gets `- **Status:** superseded by <rule>` or `- **Status:** stale`. Delete it once raw holds the history and no active page depends on it.
- Change one rule at a time and leave the other rules byte-identical. Never regenerate a page: rewrites lose the details that made the rules useful.
- A page that no blueprint cited and nobody verified for 60 days retires to `raw/_retired/`; the lint tool lists these as `unused`.

Links are relative. Raw from a repo page: `../../../../raw/<org>/<repo>/<file>.md`; from a pattern: `../../raw/<org>/<repo>/<file>.md`. Write external URLs that contain `.md` as reference links (`[text][id]` plus `[id]: <url>`), because the whole-wiki link check reads every `](...md` target as a relative path.
