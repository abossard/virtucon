# Minime Explorer - VS Code Extension

Browse and search [minime](https://github.com/abossard/virtucon) orchestration data directly from VS Code.

## Features

- **Tree View**: Sidebar explorer showing orgs, repos, blueprints, and wiki pages from VIRTUCON_HQ
- **Task Status**: Visual indicators for blueprint status (planning, implementing, done, blocked)
- **Criteria Progress**: Shows checked and total acceptance criteria per blueprint
- **Wiki Search**: Quick pick search across wiki pages and legacy wiki entries
- **File Watcher**: Auto-refreshes when minime markdown files change on disk
- **Dual Convention**: Supports both `raw/wiki/schema` roots and documented legacy wiki paths

## Tree Hierarchy

```
MINIME
+-- [org] abossard
|   +-- [repo] minime
|   |   +-- Blueprints (3)
|   |   +-- Wiki (4)
|   |       +-- [page] Wiki index: minime
|   |       +-- [page] Wiki log: minime
|   |       +-- [page] Context engineering
+-- Templates
    +-- blueprint.template.md
```

## Commands

| Command | Description |
|---------|-------------|
| `Minime: Refresh` | Re-scan VIRTUCON_HQ and update the tree |
| `Minime: Search Wiki Entries` | Quick pick filtered search across wiki pages and legacy entries |
| `Minime: Open File` | Open a blueprint or wiki file in the editor |
| `Minime: Open VIRTUCON_HQ Folder` | Reveal VIRTUCON_HQ in the OS file manager |
| `Minime: Open Latest Task` | Jump to the most recent blueprint file |

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `minime.home` | `""` | Override VIRTUCON_HQ path. Falls back to env `VIRTUCON_HQ`, then `~/.minime`. |

## Development

```bash
cd vscode-extension
npm install
npm run compile
npm run watch
npm run test:unit
npm run lint
```

## License

MIT
