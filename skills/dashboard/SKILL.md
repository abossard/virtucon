---
name: dashboard
description: Open the minime dashboard — a native webview showing tasks, wiki entries, and project actions across all minime-managed repos.
when_to_use: When the user asks to open the minime dashboard, view project status, or manage project actions visually.
allowed-tools: Read Edit Write Grep Glob Bash
---

# Skill: dashboard

Trigger: User asks to open the minime dashboard, or `/minime:dashboard`.

## What this skill does

Opens a native webview dashboard that shows minime tasks, wiki entries, and project actions. The dashboard auto-installs as a user-level extension at `~/.copilot/extensions/minime-dashboard/` — no per-repo scaffolding needed.

## How it works

The session-start hook creates a symlink from the plugin's template directory to `~/.copilot/extensions/minime-dashboard/`. The Copilot CLI discovers user-level extensions automatically, so the `/minime-dashboard` command is available in every session.

## Prerequisites

- Node.js ≥ 18
- minime plugin installed
- `npm install` run once in `skills/dashboard/template/` (for `@webviewjs/webview`)

## Usage

Once installed, use `/minime-dashboard` in any Copilot CLI session to open the dashboard.

## Custom actions

Per-repo actions are defined in `MINIME_HOME/<org>/_<repo>/dashboard.json`:

```json
{
  "allowedActions": ["dev", "test", "docs", "clean"],
  "pinnedActions": ["test"],
  "checkoutPath": "/path/to/project",
  "actions": [
    { "name": "dev", "type": "command", "command": ["npm", "run", "dev"], "background": true },
    { "name": "docs", "type": "url", "url": "https://docs.example.com" },
    { "name": "clean", "type": "clear", "paths": ["dist/", ".cache/"] },
    { "name": "test", "type": "script", "script": "test" }
  ]
}
```

### Action types

| Type | Description | Required fields |
|------|-------------|-----------------|
| `script` | Runs npm/make target | `name` (auto-discovered from package.json/Makefile) |
| `url` | Opens URL in browser | `url` (http/https only) |
| `command` | Runs arbitrary command | `command` (string array), optional `background: true` |
| `clear` | Deletes files/dirs | `paths` (relative to checkoutPath, no traversal) |

All actions must be in `allowedActions` to execute. Actions not in the list are shown but locked.

## Files marked VERBATIM — do not modify

These files are from [copilot-webview-creator](https://github.com/SteveSandersonMS/copilot-webview-creator) (commit `d71e090`):
- `lib/copilot-webview.js`
- `lib/webview-child.mjs`
- `extension.mjs`

## Security

- Actions require explicit allowlist in `dashboard.json`
- Commands use `spawn` with `shell: false`
- `clear` enforces strict path containment (no `../`, no absolute paths, no home/root)
- `url` restricted to `http:`/`https:` protocols
- Background processes spawned in process groups, killed via group signal
- All user content rendered with `textContent`, never `innerHTML`
- Webview binds to `127.0.0.1` only (loopback), random port
