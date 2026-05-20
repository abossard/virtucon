import * as vscode from 'vscode';
import { MinimeTreeProvider } from './providers/minimeTreeProvider';
import { findLatestTask, resolveMinimeHome } from './utils/paths';

let watcher: vscode.FileSystemWatcher | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const treeProvider = new MinimeTreeProvider();

  const treeView = vscode.window.createTreeView('minimeExplorer', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('minime.refresh', () => {
      treeProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('minime.openFile', async (filePath?: string, lineNumber?: number) => {
      if (!filePath) return;
      const uri = vscode.Uri.file(filePath);
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc);
      if (lineNumber && lineNumber > 0) {
        const pos = new vscode.Position(lineNumber - 1, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.AtTop);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('minime.search', async () => {
      const entries = treeProvider.getAllWikiEntries();
      if (entries.length === 0) {
        vscode.window.showInformationMessage('No wiki entries found.');
        return;
      }

      const items = entries.map(entry => ({
        label: entry.name,
        description: `${entry.confidence} | score: ${entry.valueScore}`,
        detail: entry.rule || entry.trigger,
        entry,
      }));

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Search wiki entries by name, rule, or trigger...',
        matchOnDescription: true,
        matchOnDetail: true,
      });

      if (picked) {
        vscode.commands.executeCommand(
          'minime.openFile',
          picked.entry.filePath,
          picked.entry.lineNumber
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('minime.openMinimeHome', () => {
      const config = vscode.workspace.getConfiguration('minime');
      const settingHome = config.get<string>('home') || undefined;
      const home = resolveMinimeHome({ settingHome });
      const uri = vscode.Uri.file(home);
      vscode.commands.executeCommand('revealFileInOS', uri);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('minime.openLatestTask', async () => {
      const orgs = treeProvider.getOrgs();
      const latest = findLatestTask(orgs);
      if (!latest) {
        vscode.window.showInformationMessage('No tasks found.');
        return;
      }
      vscode.commands.executeCommand('minime.openFile', latest.filePath);
    })
  );

  // File watcher for auto-refresh
  setupFileWatcher(context, treeProvider);

  // Re-setup watcher when config changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('minime.home')) {
        disposeWatcher();
        setupFileWatcher(context, treeProvider);
        treeProvider.refresh();
      }
    })
  );
}

function setupFileWatcher(
  context: vscode.ExtensionContext,
  treeProvider: MinimeTreeProvider
): void {
  const config = vscode.workspace.getConfiguration('minime');
  const settingHome = config.get<string>('home') || undefined;
  const home = resolveMinimeHome({ settingHome });

  const pattern = new vscode.RelativePattern(
    vscode.Uri.file(home),
    '**/*.md'
  );

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  watcher = vscode.workspace.createFileSystemWatcher(pattern);

  const debouncedRefresh = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => treeProvider.refresh(), 500);
  };

  watcher.onDidCreate(debouncedRefresh);
  watcher.onDidChange(debouncedRefresh);
  watcher.onDidDelete(debouncedRefresh);

  context.subscriptions.push(watcher);
}

function disposeWatcher(): void {
  if (watcher) {
    watcher.dispose();
    watcher = undefined;
  }
}

export function deactivate(): void {
  disposeWatcher();
}
