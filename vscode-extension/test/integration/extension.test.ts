import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Integration Tests', () => {
  test('Extension should be present', () => {
    const ext = vscode.extensions.getExtension('abossard.minime-explorer');
    assert.ok(ext, 'Extension should be registered');
  });

  test('Commands should be registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    const minimeCommands = commands.filter(c => c.startsWith('minime.'));

    assert.ok(minimeCommands.includes('minime.refresh'), 'refresh command');
    assert.ok(minimeCommands.includes('minime.search'), 'search command');
    assert.ok(minimeCommands.includes('minime.openFile'), 'openFile command');
    assert.ok(minimeCommands.includes('minime.openMinimeHome'), 'openMinimeHome command');
    assert.ok(minimeCommands.includes('minime.openLatestTask'), 'openLatestTask command');
  });

  test('Tree view should be registered', () => {
    // The view is registered via package.json contributions
    // We verify by checking the extension's package.json
    const ext = vscode.extensions.getExtension('abossard.minime-explorer');
    assert.ok(ext);
    const views = ext!.packageJSON?.contributes?.views?.minime;
    assert.ok(views, 'minime view container should have views');
    assert.ok(
      views.some((v: { id: string }) => v.id === 'minimeExplorer'),
      'minimeExplorer view should be registered'
    );
  });

  test('Configuration should be registered', () => {
    const config = vscode.workspace.getConfiguration('minime');
    const homeValue = config.get<string>('home');
    assert.strictEqual(typeof homeValue, 'string', 'minime.home should be a string');
  });
});
