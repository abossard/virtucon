---
name: extract
description: Capture reusable lessons from a finished minime blueprint into the minime wiki, or lint the wiki. Keeps only cited rules that change what an agent does, written to the wiki schema and checked with a lint tool. Use once a task is verified, at the end of a session, or when the user asks to save what was learned, clean up project knowledge, or lint the wiki.
allowed-tools: Read Edit Write Grep Glob Bash(node *) Bash(git log *) Bash(git diff *) Bash(git show *) Bash(git remote get-url *)
---

# Extract

Future blueprints look up the wiki for decisions they don't have to research again. Read `schema.md` in the knowledge root first (path from the session nudge). It owns the layers, the page rules, the index and log formats; `_TEMPLATE.md` owns the page shape. Follow them exactly.

## Harvest

From the blueprint, in order of value:
1. Inputs that corrected direction (user feedback), kept verbatim.
2. Decisions sourced from `user:` or `research:`.
3. Findings in `<name>.runs/inspect.md` that led to a fix.
4. Approaches that failed, with the reason.

Skip decisions sourced from `data:`; the code already says them.

## Keep or drop

Apply the schema's bar for what earns a rule. Open the cited code before promoting a claim. When a claim contradicts an existing rule, the newer, better-cited one wins and the old rule gets `superseded by` it.

## Write

1. Copy the source verbatim into `raw/<org>/<repo>/<date>-<topic>.md` with secrets redacted.
2. Edit the page that already owns the topic. Sharpen or delete the old rule before adding a new one. A page at the schema's size ceiling gets split by trigger, not extended.
3. Update the scope `index.md`, the wiki `index.md` for a new scope or pattern, and `wiki/log.md`. Move the oldest log lines to `wiki/log/archive.md` before the log reaches 100 lines.
4. Set `LastVerified` to today only on pages whose cited code you opened.

## Verify

Run the wiki lint tool from the nudge on the scope directory you worked in, `index.md` and `log.md`, with wiki-relative paths and the repo checkout. Add each pattern page you changed:

```bash
node <wiki lint tool> <knowledge root> orgs/<org>/<repo> index.md log.md --repo <repo>
```

Fix every violation in the files you changed. A `cite` error means the cited code moved or is gone: update the line when the rule still holds, otherwise mark the rule `Status: stale` or `superseded by <rule>`. Pages you left alone may carry older violations: report their count and leave them.

## Lint

When asked to lint, run the tool on the requested scope, or without paths for the whole wiki, and report the `byRule` counts and errors. The tool can't see whether cited code still supports its rule, contradictions between pages or duplicate guidance; check those by opening the cited code and comparing pages. Repair only when asked.

## Return

Report the candidates considered, the pages changed, the claims marked stale or superseded, and the lint result.
