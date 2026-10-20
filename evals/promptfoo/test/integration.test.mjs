import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSuiteManifest, resolveRuntimeProfile } from '../cli.mjs';

test('loadSuiteManifest loads known suite', async () => {
  const suite = await loadSuiteManifest('ahm-parser-smoke@1');
  assert.equal(suite.suite.reportingKey, 'ahm-parser-smoke@1');
  assert.equal(suite.suite.role, 'smoke');
});

test('loadSuiteManifest rejects unknown suite', async () => {
  await assert.rejects(() => loadSuiteManifest('missing@1'), /Unknown suite/);
});

test('resolveRuntimeProfile returns user-approved defaults for smoke and hard', () => {
  const smoke = resolveRuntimeProfile({ suite: { suite: { role: 'smoke' } } });
  const hard = resolveRuntimeProfile({ suite: { suite: { role: 'hard' } } });
  assert.equal(smoke.model, 'gpt-5.3-codex');
  assert.equal(smoke.reasoningEffort, 'high');
  assert.equal(smoke.maxAiCredits, null);
  assert.equal(smoke.taskTimeoutSeconds, 900);
  assert.equal(hard.taskTimeoutSeconds, 2700);
});

test('resolveRuntimeProfile keeps explicit credit cap override', () => {
  const smoke = resolveRuntimeProfile({
    suite: { suite: { role: 'smoke' } },
    maxAiCredits: '30',
  });
  assert.equal(smoke.maxAiCredits, 30);
});
