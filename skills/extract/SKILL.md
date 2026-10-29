---
name: extract
description: Capture verified lessons from a finished minime blueprint into the minime wiki, learn from the user's own edits of agent code, or run a wiki health check. Keeps only cited rules that change what an agent does and that a test, a command output or the user's words back, written to the wiki schema as small deltas and checked with a lint tool. Use once a task is verified, at the end of a session, or when the user asks to save what was learned, clean up project knowledge, or lint the wiki.
allowed-tools: Read Edit Write Grep Glob Bash(node *) Bash(git log *) Bash(git diff *) Bash(git show *) Bash(git remote get-url *) Bash(git ls-files *) Bash(mkdir *) Bash(mv *)
---

# Extract

Future blueprints look up the wiki for decisions they don't have to research again. Read `schema.md` in the knowledge root first (path from the session nudge). It owns the layers, the page rules, the index and log formats; `_TEMPLATE.md` owns the page shape. Follow them exactly.

The wiki learns only what was verified. A rule needs a receipt: a test, a command with its output, or the user's own words. A lesson that rests on an agent's opinion stays out.

## Harvest

From the blueprint, in order of value:
1. Surprises: evidence brackets with `ran: … surprise`, where running the code contradicted the prediction.
2. Inputs that corrected direction (user feedback), kept verbatim.
3. The user's edits of earlier agent work (see Red pen), and a correction handed over after the report: a reviewer's or maintainer's diff, a CI result. Compare the diff with the change's own diff (the raw .diff of Red pen step 1; reuse it when extract already ran: owners, mechanism, assertions kept) and read the CI failures as the behaviors the change missed; the phase whose step chose differently gets the process lesson.
4. Values whose bracket is `user:` or `research:`. A `default:` bracket is the agent's recommendation; keep it only when later evidence confirmed it.
5. Findings in `<name>.runs/inspect.md` that led to a fix.
6. Approaches that failed, and rules that made code grow without a criterion needing it (Origin `failed-approach`).
7. The command that builds and runs the project's tests, when the repo's wiki pages lack it.
8. What a phase missed, scoped out, failed to run, or looped on. See Process.

Skip values whose bracket is `data:`; the code already says them.

A child blueprint (`Parent:` in its header) is harvested like a root, and its lessons cite the child file. The root's extract reads the children's blueprints too and doesn't repeat their rules.

## Red pen

The user's edits of agent code are the clearest statement of their taste.

1. Save this task's change: write `git diff HEAD` of its changed files (and the content of new untracked ones) to `raw/<org>/<repo>/<date>-<topic>.diff`.
2. Look for earlier `.diff` files in `raw/<org>/<repo>/`. For each one, check with `git log --since=<its date> -- <its files>` whether the user changed those files since. Where they did, compare the agent's lines in the diff with the current code. What the user deleted, rewrote or moved is a human correction: harvest the pattern behind it ("a function exists only when two places call it"), not the single edit. The user's commit is the evidence.

## Keep or drop

Apply the schema's bar for what earns a rule. Open the cited code before promoting a claim. When a claim contradicts an existing rule, the newer, better-cited one wins and the old rule gets `superseded by` it.

## Process

A lesson about how a phase worked goes to the scope's `process-<phase>.md`, a lesson about the code to a topic page; one finding can yield both. Name the phase whose step would have prevented it. The schema's Process pages section owns the rule shape, the cap and merging: read it and the page's rules before adding one. Read `process-extract.md` before Harvest when the scope index lists it.

A maintainer's diff (Red pen) gives a process rule for the phase that made the choice, its shape quoted from what that phase had in front of it: an input phrase, a `ran` bracket, a criterion's wording.

## Write in small deltas

1. Copy the source verbatim into `raw/<org>/<repo>/<date>-<topic>.md` with secrets redacted.
2. Change one rule at a time in the page that already owns the topic: add, sharpen or retire a rule, and leave the other rules byte-identical. Never rewrite or regenerate a whole page; rewriting loses the details that made the rules useful. A page at the schema's size ceiling gets split by trigger, not extended.
3. Write the lesson, not the story: the rule, the consequence of missing it, the evidence. Logs and transcripts stay in raw.
4. Update the scope `index.md`, the wiki `index.md` for a new scope or pattern, and `wiki/log.md`. Move the oldest log lines to `wiki/log/archive.md` before the log reaches 100 lines.
5. Set `LastVerified` to today only on pages whose cited code you opened.
6. Don't add rules to the repo's AGENTS.md, CLAUDE.md or instruction files: the wiki holds them, where they are verified and pruned.

## Verify

Run the wiki lint tool from the nudge on the scope directory you worked in, `index.md` and `log.md`, with wiki-relative paths and the repo checkout. Add each pattern page you changed:

```bash
node <wiki lint tool> <knowledge root> orgs/<org>/<repo> index.md log.md --repo <repo>
```

Fix every violation in the files you changed. A `cite` error means the cited code moved or is gone: update the line when the rule still holds, otherwise mark the rule `Status: stale` or `superseded by <rule>`. Pages you left alone may carry older violations: report their count and leave them.

## Close

Set ` | Extracted: <YYYY-MM-DD>` on the blueprint's `Repo:` line, replacing an earlier date, then run the blueprint tool's `check` on it.

## Health check

When asked to lint or check the wiki's health, run the tool on the requested scope, or without paths for the whole wiki, and report the `byRule` counts and errors. The tool also counts how many blueprints cite each page; `unused` lists pages that no blueprint cited and nobody verified for 60 days. Move each unused page to `raw/_retired/<wiki-relative path>`, remove its index lines and log the move: raw keeps it, the wiki stops spending attention on it. The tool can't see whether cited code still supports its rule, contradictions between pages or duplicate guidance; check those by opening the cited code and comparing pages. Repair other problems only when asked.

## Return

Reply with one JSON object in a `json` code block and nothing else: `status`, `blueprint_path`, `changed_files` (knowledge-root-relative), `blocking_issue`, `evidence_excerpts` (the lint result and the blueprint check), `captured` (one line per rule added, sharpened or retired) and `retired` (pages moved to raw).
