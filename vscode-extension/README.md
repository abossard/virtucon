# Minime Explorer - VS Code Extension

Browse and search [minime](https://github.com/abossard/minime) agent orchestration data directly from VS Code.

## Features

- **Tree View**: Sidebar explorer showing orgs, repos, tasks, and wiki entries from MINIME_HOME
- **Task Status**: Visual indicators for task status (planning, implementing, done, blocked)
- **Criteria Progress**: Shows checked/total acceptance criteria per task
- **Wiki Search**: Quick pick search across all wiki entries by name, rule, or trigger
- **File Watcher**: Auto-refreshes when minime files change on disk
- **Dual Convention**: Supports both new (`<org>/_<repo>/`) and legacy (`tasks/<org>__<repo>/`) paths

## Tree Hierarchy

```
MINIME
+-- [org] abossard
|   +-- [repo] well-architected-pr
|   |   +-- Tasks (3)
|   |   |   +-- [done] pr3194-review-comments  2026-05-20 | 20/20
|   |   +-- Wiki (5)
|   |       +-- [verified] VdjDeckModel signals...
|   +-- [repo] minime
|       +-- Tasks (1)
|       +-- Wiki (0)
+-- Templates
    +-- task.template.md
```

## Commands

| Command | Description |
|---------|-------------|
| `Minime: Refresh` | Re-scan MINIME_HOME and update the tree |
| `Minime: Search Wiki Entries` | Quick pick filtered search across all wiki entries |
| `Minime: Open File` | Open a task or wiki file in the editor |
| `Minime: Open MINIME_HOME Folder` | Reveal MINIME_HOME in the OS file manager |
| `Minime: Open Latest Task` | Jump to the most recent task file |

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `minime.home` | `""` | Override MINIME_HOME path. Falls back to env `MINIME_HOME`, then `~/.minime`. |

## Install from Source

```bash
cd vscode-extension
./scripts/install.sh
```

## Update

```bash
cd vscode-extension
./scripts/update.sh
```

## Install from VSIX Artifact

Download the `.vsix` from the GitHub Actions build artifacts, then:

```bash
code --install-extension minime-explorer-0.1.0.vsix
```

## Development

```bash
cd vscode-extension
npm install
npm run compile    # build once
npm run watch      # rebuild on changes
npm run test:unit  # run unit tests
npm run lint       # type-check
```

## Testing

### Unit Tests
Pure-function tests for parsers and path resolution. No VS Code dependency.

```bash
npm run test:unit
```

### Integration Tests
Test extension activation, command registration, and tree view inside a real VS Code instance.

```bash
npm run test:integration
```

### UI Tests
For end-to-end UI testing (tree view interaction, clicking nodes), use
[vscode-extension-tester](https://github.com/redhat-developer/vscode-extension-tester).
Not included by default to keep dev dependencies light. Add it with:

```bash
npm install --save-dev vscode-extension-tester
```

Then write tests using its API to automate tree view clicks, quick pick interactions, etc.

## License

MIT
