---
name: lab
description: Bootstrap or verify the minime knowledge root under VIRTUCON_HQ, with no repository writes. The session-start hook already does this in every session; run it to force a re-run.
disable-model-invocation: true
allowed-tools: Bash(node *)
---

# Lab

Run the session-start hook once and show the paths it prints:

```bash
node "${CLAUDE_SKILL_DIR}/../../hooks/session-start.js"
```

It creates missing directories, copies the default `schema.md` and topic template, and never overwrites existing files. It writes nothing to the working repository.
