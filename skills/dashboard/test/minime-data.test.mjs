// Test suite for minime-data.mjs — parity with VS Code extension parsers
// Run: node --test skills/dashboard/test/minime-data.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import {
  parseTaskContent, countCriteria, getStatusIcon,
  parseWikiContent,
  scanMinimeHome, findLatestTask,
  loadDashboardConfig, discoverProjectActions,
  resolveMinimeHome,
  validateUrl, validateClearPaths,
  createRingBuffer, mergeActions,
} from '../template/lib/minime-data.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');

// ── Task parser (parity with vscode-extension/test/unit/taskParser.test.ts) ──

describe('parseTaskContent', () => {
  const doneTaskContent = `# Task: fixture-task-done

Created: 2026-01-15  |  Status: implemented  |  Repo: test-org/test-repo

## Goal
A test task that is fully completed.

## Acceptance criteria (EARS-style -- each must be independently testable)

- [x] When the user clicks save, the system shall persist data -- VOI: decided-by-data
- [x] When the user clicks delete, the system shall remove the item -- VOI: decided-by-data
- [ ] If no items exist, then the system shall show an empty state -- VOI: decided-by-data

## Out of scope
- Nothing`;

  const planningTaskContent = `# Task: fixture-task-planning

Created: 2026-05-20  |  Status: planning  |  Repo: test-org/test-repo

## Acceptance criteria (EARS-style -- each must be independently testable)

- [ ] The system shall support pagination -- VOI: needs-research
- [ ] When results exceed 100, the system shall paginate -- VOI: decided-by-data`;

  it('should extract status from header', () => {
    const task = parseTaskContent(doneTaskContent, '/fake/2026-01-15-fixture-task-done.task.md');
    assert.equal(task.status, 'implemented');
  });

  it('should extract repo from header', () => {
    const task = parseTaskContent(doneTaskContent, '/fake/2026-01-15-fixture-task-done.task.md');
    assert.equal(task.repo, 'test-org/test-repo');
  });

  it('should extract date and shortName from filename', () => {
    const task = parseTaskContent(doneTaskContent, '/fake/2026-01-15-fixture-task-done.task.md');
    assert.equal(task.date, '2026-01-15');
    assert.equal(task.shortName, 'fixture-task-done');
  });

  it('should extract goal', () => {
    const task = parseTaskContent(doneTaskContent, '/fake/2026-01-15-fixture-task-done.task.md');
    assert.equal(task.goal, 'A test task that is fully completed.');
  });

  it('should count criteria correctly for mixed checked/unchecked', () => {
    const task = parseTaskContent(doneTaskContent, '/fake/2026-01-15-fixture-task-done.task.md');
    assert.equal(task.totalCriteria, 3);
    assert.equal(task.checkedCriteria, 2);
  });

  it('should count criteria correctly for all unchecked', () => {
    const task = parseTaskContent(planningTaskContent, '/fake/2026-05-20-fixture-task-planning.task.md');
    assert.equal(task.totalCriteria, 2);
    assert.equal(task.checkedCriteria, 0);
  });

  it('should handle content with no criteria section', () => {
    const content = `# Task: minimal\n\nCreated: 2026-01-01  |  Status: planning  |  Repo: org/repo\n\n## Goal\nMinimal task.`;
    const task = parseTaskContent(content, '/fake/2026-01-01-minimal.task.md');
    assert.equal(task.totalCriteria, 0);
    assert.equal(task.checkedCriteria, 0);
  });

  it('should handle malformed content gracefully', () => {
    const task = parseTaskContent('just some random text', '/fake/bad.task.md');
    assert.equal(task.status, 'unknown');
    assert.equal(task.shortName, 'bad');
  });

  it('should parse plain .md files (not .task.md)', () => {
    const content = `Status: implemented\n\n# Fix bugs\n\n## Context\nThree bugs found.\n\n## EARS Criteria\n\n- [x] Bug 1 fixed\n- [x] Bug 2 fixed`;
    const task = parseTaskContent(content, '/fake/task.md');
    assert.equal(task.shortName, 'task');
    assert.equal(task.status, 'implemented');
    assert.equal(task.totalCriteria, 2);
    assert.equal(task.checkedCriteria, 2);
  });

  it('should extract goal from ## Context when ## Goal absent', () => {
    const content = `# Task\n\n## Context\nThree bugs discovered.\n\n## Criteria`;
    const task = parseTaskContent(content, '/fake/2026-01-01-bugs.task.md');
    assert.equal(task.goal, 'Three bugs discovered.');
  });

  it('should extract status from ## Status: header', () => {
    const content = `# Task\n\n## Status: implemented\n\n## EARS Criteria\n\n- [x] Done`;
    const task = parseTaskContent(content, '/fake/data-persistence.md');
    assert.equal(task.status, 'implemented');
    assert.equal(task.shortName, 'data-persistence');
  });
});

describe('countCriteria', () => {
  it('should count EARS Criteria section', () => {
    const content = `## EARS Criteria\n\n- [x] C1 done\n- [ ] C2 pending\n- [x] C3 done`;
    const result = countCriteria(content);
    assert.equal(result.total, 3);
    assert.equal(result.checked, 2);
  });

  it('should count mixed criteria', () => {
    const content = `## Acceptance criteria\n\n- [x] Done\n- [ ] Not done\n- [x] Also done`;
    const result = countCriteria(content);
    assert.equal(result.total, 3);
    assert.equal(result.checked, 2);
  });

  it('should return zero for empty content', () => {
    const result = countCriteria('no criteria here');
    assert.equal(result.total, 0);
    assert.equal(result.checked, 0);
  });

  it('should handle uppercase X', () => {
    const content = `## Acceptance criteria\n\n- [X] Done`;
    const result = countCriteria(content);
    assert.equal(result.total, 1);
    assert.equal(result.checked, 1);
  });
});

describe('getStatusIcon', () => {
  const cases = [
    { input: 'implemented', expected: '\u2705' },
    { input: 'done', expected: '\u2705' },
    { input: 'merged', expected: '\u2705' },
    { input: 'planning', expected: '\uD83D\uDCDD' },
    { input: 'in_progress', expected: '\u23F3' },
    { input: 'implementing', expected: '\u23F3' },
    { input: 'blocked', expected: '\uD83D\uDEAB' },
    { input: 'unknown_status', expected: '\u2754' },
  ];

  for (const { input, expected } of cases) {
    it(`should return correct icon for "${input}"`, () => {
      assert.equal(getStatusIcon(input), expected);
    });
  }
});

// ── Wiki parser (parity with vscode-extension/test/unit/wikiParser.test.ts) ──

describe('parseWikiContent', () => {
  const sampleWiki = `# test-org/test-repo -- Corrections Wiki

---

### Always use parameterized queries
- **Rule:** Never concatenate user input into SQL strings.
- **Trigger:** Any task touching database queries or ORM usage.
- **Evidence:** \`src/db/queries.ts:22\`
- **Origin:** human-correction
- **ValueScore:** 8
- **Confidence:** high
- **Status:** active
- **LastVerified:** 2026-05-01

---

### Cache API responses for 5 minutes
- **Rule:** All external API responses should be cached with a 5-minute TTL.
- **Trigger:** Adding or modifying external API calls.
- **Evidence:** \`src/cache/apiCache.ts:15\`
- **Origin:** observation
- **ValueScore:** 5
- **Confidence:** medium
- **Status:** active
- **LastVerified:** 2026-04-20

---

### Deprecated rule example
- **Rule:** Old approach that no longer applies.
- **Trigger:** Legacy code paths.
- **Evidence:** \`src/old.ts:1\`
- **Origin:** observation
- **ValueScore:** 2
- **Confidence:** low
- **Status:** stale
- **LastVerified:** 2025-01-01`;

  it('should parse multiple wiki entries', () => {
    const entries = parseWikiContent(sampleWiki, '/fake/wiki.md');
    assert.equal(entries.length, 3);
  });

  it('should extract entry names from h3 headings', () => {
    const entries = parseWikiContent(sampleWiki, '/fake/wiki.md');
    assert.equal(entries[0].name, 'Always use parameterized queries');
    assert.equal(entries[1].name, 'Cache API responses for 5 minutes');
  });

  it('should extract rule text', () => {
    const entries = parseWikiContent(sampleWiki, '/fake/wiki.md');
    assert.equal(entries[0].rule, 'Never concatenate user input into SQL strings.');
  });

  it('should extract trigger text', () => {
    const entries = parseWikiContent(sampleWiki, '/fake/wiki.md');
    assert.equal(entries[0].trigger, 'Any task touching database queries or ORM usage.');
  });

  it('should extract evidence', () => {
    const entries = parseWikiContent(sampleWiki, '/fake/wiki.md');
    assert.equal(entries[0].evidence, '`src/db/queries.ts:22`');
  });

  it('should parse numeric valueScore', () => {
    const entries = parseWikiContent(sampleWiki, '/fake/wiki.md');
    assert.equal(entries[0].valueScore, 8);
    assert.equal(entries[1].valueScore, 5);
  });

  it('should extract confidence and status', () => {
    const entries = parseWikiContent(sampleWiki, '/fake/wiki.md');
    assert.equal(entries[0].confidence, 'high');
    assert.equal(entries[0].status, 'active');
    assert.equal(entries[2].confidence, 'low');
    assert.equal(entries[2].status, 'stale');
  });

  it('should track line numbers', () => {
    const entries = parseWikiContent(sampleWiki, '/fake/wiki.md');
    assert.ok(entries[0].lineNumber > 0);
    assert.ok(entries[1].lineNumber > entries[0].lineNumber);
  });

  it('should store filePath on each entry', () => {
    const entries = parseWikiContent(sampleWiki, '/fake/wiki.md');
    for (const e of entries) assert.equal(e.filePath, '/fake/wiki.md');
  });

  it('should skip template/example headings', () => {
    const content = `### Entries\n\n### EXAMPLE -- Money is integer\n- **Rule:** test\n- **Trigger:** test`;
    const entries = parseWikiContent(content, '/fake/wiki.md');
    assert.equal(entries.length, 0);
  });

  it('should handle empty content', () => {
    const entries = parseWikiContent('', '/fake/wiki.md');
    assert.equal(entries.length, 0);
  });

  it('should handle content with no entries', () => {
    const content = `# Wiki\n\nNo entries yet.`;
    const entries = parseWikiContent(content, '/fake/wiki.md');
    assert.equal(entries.length, 0);
  });

  it('should handle entries with missing fields', () => {
    const content = `### Partial entry\n- **Rule:** Some rule\n- **Trigger:** Some trigger`;
    const entries = parseWikiContent(content, '/fake/wiki.md');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].rule, 'Some rule');
    assert.equal(entries[0].confidence, 'unknown');
    assert.equal(entries[0].valueScore, 0);
  });
});

// ── Scanner (parity with vscode-extension/test/unit/paths.test.ts) ──

describe('scanMinimeHome', () => {
  it('should find orgs and repos from new-convention dirs', () => {
    const orgs = scanMinimeHome(FIXTURES);
    const testOrg = orgs.find(o => o.name === 'test-org');
    assert.ok(testOrg, 'should find test-org');
    const testRepo = testOrg.repos.find(r => r.name === 'test-repo');
    assert.ok(testRepo, 'should find test-repo');
  });

  it('should parse tasks from new convention', () => {
    const orgs = scanMinimeHome(FIXTURES);
    const testOrg = orgs.find(o => o.name === 'test-org');
    const testRepo = testOrg.repos.find(r => r.name === 'test-repo');
    assert.ok(testRepo.tasks.length >= 2, `expected >=2 tasks, got ${testRepo.tasks.length}`);
  });

  it('should parse wiki from new convention', () => {
    const orgs = scanMinimeHome(FIXTURES);
    const testOrg = orgs.find(o => o.name === 'test-org');
    const testRepo = testOrg.repos.find(r => r.name === 'test-repo');
    assert.ok(testRepo.wikiEntries.length >= 2, `expected >=2 wiki entries, got ${testRepo.wikiEntries.length}`);
  });

  it('should merge legacy tasks into same repo', () => {
    const orgs = scanMinimeHome(FIXTURES);
    const testOrg = orgs.find(o => o.name === 'test-org');
    const testRepo = testOrg.repos.find(r => r.name === 'test-repo');
    const legacyTask = testRepo.tasks.find(t => t.shortName === 'legacy-task');
    assert.ok(legacyTask, 'should find legacy task merged into test-repo');
  });

  it('should return empty array for nonexistent path', () => {
    const orgs = scanMinimeHome('/nonexistent/path');
    assert.equal(orgs.length, 0);
  });

  it('should discover project with only legacy wiki (no new-convention)', () => {
    const orgs = scanMinimeHome(FIXTURES);
    const legacyOrg = orgs.find(o => o.name === 'legacy-org');
    assert.ok(legacyOrg, 'should find legacy-org from wiki/repos/legacy-org__legacy-repo.md');
    const legacyRepo = legacyOrg.repos.find(r => r.name === 'legacy-repo');
    assert.ok(legacyRepo, 'should find legacy-repo');
    assert.ok(legacyRepo.wikiEntries.length >= 1, 'should have wiki entries from legacy path');
    assert.equal(legacyRepo.wikiEntries[0].name, 'Legacy-only wiki rule');
  });
});

describe('findLatestTask', () => {
  it('should return the task with the latest date', () => {
    const orgs = scanMinimeHome(FIXTURES);
    const latest = findLatestTask(orgs);
    assert.ok(latest);
    assert.equal(latest.date, '2026-05-20');
  });
});

// ── XSS prevention (AC9 — ensure no script execution) ──

describe('XSS prevention', () => {
  it('should preserve XSS payload as literal text in task content', () => {
    const malicious = `# Task: xss-test

Created: 2026-01-01  |  Status: planning  |  Repo: evil/repo

## Goal
<script>alert(1)</script>

## Acceptance criteria (EARS-style)

- [ ] <img onerror="alert(1)" src=x> -- VOI: decided-by-data`;

    const task = parseTaskContent(malicious, '/fake/2026-01-01-xss-test.task.md');
    assert.equal(task.goal, '<script>alert(1)</script>');
    assert.equal(task.totalCriteria, 1);
    // Parsers return raw strings — UI must use textContent to render safely
  });

  it('should preserve XSS payload as literal text in wiki entries', () => {
    const malicious = `### <script>alert("xss")</script>
- **Rule:** <img onerror="alert(1)" src=x>
- **Trigger:** <script>document.cookie</script>`;

    const entries = parseWikiContent(malicious, '/fake/wiki.md');
    assert.equal(entries.length, 1);
    assert.ok(entries[0].name.includes('<script>'));
    assert.ok(entries[0].rule.includes('<img'));
    assert.ok(entries[0].trigger.includes('<script>'));
  });
});

// ── Dashboard config (AC5, AC10) ──

describe('loadDashboardConfig', () => {
  const tmpDir = join(__dirname, 'fixtures', '_tmp_config_test');

  it('should return defaults when no dashboard.json exists', () => {
    const config = loadDashboardConfig('/nonexistent', 'org', 'repo');
    assert.deepEqual(config.allowedActions, []);
    assert.deepEqual(config.pinnedActions, []);
    assert.deepEqual(config.hiddenPanels, []);
    assert.equal(config.checkoutPath, null);
  });

  it('should parse valid dashboard.json', () => {
    const orgDir = join(tmpDir, 'org', '_repo');
    mkdirSync(orgDir, { recursive: true });
    writeFileSync(join(orgDir, 'dashboard.json'), JSON.stringify({
      allowedActions: ['test', 'build'],
      pinnedActions: ['test'],
      hiddenPanels: [],
      checkoutPath: '/Users/me/src/repo',
    }));

    const config = loadDashboardConfig(tmpDir, 'org', 'repo');
    assert.deepEqual(config.allowedActions, ['test', 'build']);
    assert.deepEqual(config.pinnedActions, ['test']);
    assert.equal(config.checkoutPath, '/Users/me/src/repo');

    rmSync(tmpDir, { recursive: true });
  });

  it('should handle malformed dashboard.json gracefully', () => {
    const orgDir = join(tmpDir, 'org', '_repo');
    mkdirSync(orgDir, { recursive: true });
    writeFileSync(join(orgDir, 'dashboard.json'), 'not valid json');

    const config = loadDashboardConfig(tmpDir, 'org', 'repo');
    assert.deepEqual(config.allowedActions, []);
    assert.equal(config.checkoutPath, null);

    rmSync(tmpDir, { recursive: true });
  });

  it('should filter non-string values from arrays', () => {
    const orgDir = join(tmpDir, 'org', '_repo');
    mkdirSync(orgDir, { recursive: true });
    writeFileSync(join(orgDir, 'dashboard.json'), JSON.stringify({
      allowedActions: ['test', 42, null, 'build'],
      checkoutPath: 123,
    }));

    const config = loadDashboardConfig(tmpDir, 'org', 'repo');
    assert.deepEqual(config.allowedActions, ['test', 'build']);
    assert.equal(config.checkoutPath, null);

    rmSync(tmpDir, { recursive: true });
  });
});

// ── Action discovery (AC3, AC10) ──

describe('discoverProjectActions', () => {
  const tmpDir = join(__dirname, 'fixtures', '_tmp_actions_test');

  it('should discover package.json scripts', () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
      scripts: { test: 'jest', build: 'tsc', lint: 'eslint .' },
    }));

    const actions = discoverProjectActions(tmpDir);
    assert.equal(actions.length, 3);
    assert.ok(actions.find(a => a.name === 'test'));
    assert.ok(actions.find(a => a.name === 'build'));
    assert.ok(actions.find(a => a.source === 'package.json'));

    rmSync(tmpDir, { recursive: true });
  });

  it('should discover Makefile targets', () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, 'Makefile'), `build:\n\tgo build ./...\n\ntest:\n\tgo test ./...\n\n.PHONY: build test`);

    const actions = discoverProjectActions(tmpDir);
    const makeActions = actions.filter(a => a.source === 'Makefile');
    assert.ok(makeActions.length >= 2);
    assert.ok(makeActions.find(a => a.name === 'build'));
    assert.ok(makeActions.find(a => a.name === 'test'));

    rmSync(tmpDir, { recursive: true });
  });

  it('should return empty for directory with no project files', () => {
    mkdirSync(tmpDir, { recursive: true });

    const actions = discoverProjectActions(tmpDir);
    assert.equal(actions.length, 0);

    rmSync(tmpDir, { recursive: true });
  });

  it('should handle malformed package.json gracefully', () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, 'package.json'), 'not json');

    const actions = discoverProjectActions(tmpDir);
    assert.equal(actions.length, 0);

    rmSync(tmpDir, { recursive: true });
  });
});

// ── Extended dashboard.json schema (AC3, AC13) ──

describe('loadDashboardConfig extended schema', () => {
  const tmpDir = join(__dirname, 'fixtures', '_tmp_ext_config');

  it('should parse typed actions array', () => {
    const orgDir = join(tmpDir, 'org', '_repo');
    mkdirSync(orgDir, { recursive: true });
    writeFileSync(join(orgDir, 'dashboard.json'), JSON.stringify({
      actions: [
        { name: 'dev', type: 'command', command: ['npm', 'run', 'dev'], background: true },
        { name: 'docs', type: 'url', url: 'https://docs.example.com' },
        { name: 'clean', type: 'clear', paths: ['dist/', '.cache/'] },
        { name: 'test', type: 'script', script: 'test' },
      ],
      allowedActions: ['dev', 'docs', 'clean', 'test'],
    }));

    const config = loadDashboardConfig(tmpDir, 'org', 'repo');
    assert.equal(config.actions.length, 4);
    assert.deepEqual(config.actions[0], { name: 'dev', type: 'command', command: ['npm', 'run', 'dev'], background: true });
    assert.deepEqual(config.actions[1], { name: 'docs', type: 'url', url: 'https://docs.example.com' });
    assert.deepEqual(config.actions[2], { name: 'clean', type: 'clear', paths: ['dist/', '.cache/'] });
    assert.deepEqual(config.actions[3], { name: 'test', type: 'script', script: 'test' });

    rmSync(tmpDir, { recursive: true });
  });

  it('should backward-compat: old config without actions array returns empty actions', () => {
    const orgDir = join(tmpDir, 'org', '_repo');
    mkdirSync(orgDir, { recursive: true });
    writeFileSync(join(orgDir, 'dashboard.json'), JSON.stringify({
      allowedActions: ['test', 'build'],
      pinnedActions: ['test'],
    }));

    const config = loadDashboardConfig(tmpDir, 'org', 'repo');
    assert.deepEqual(config.allowedActions, ['test', 'build']);
    assert.deepEqual(config.pinnedActions, ['test']);
    assert.deepEqual(config.actions, []);

    rmSync(tmpDir, { recursive: true });
  });

  it('should reject invalid action objects in actions array', () => {
    const orgDir = join(tmpDir, 'org', '_repo');
    mkdirSync(orgDir, { recursive: true });
    writeFileSync(join(orgDir, 'dashboard.json'), JSON.stringify({
      actions: [
        { name: 'valid', type: 'url', url: 'https://x.com' },
        'not-an-object',
        { type: 'url', url: 'https://y.com' },  // missing name
        { name: 'bad-type', type: 'unknown', url: 'https://z.com' },
        42,
        null,
      ],
      allowedActions: ['valid'],
    }));

    const config = loadDashboardConfig(tmpDir, 'org', 'repo');
    assert.equal(config.actions.length, 1);
    assert.equal(config.actions[0].name, 'valid');

    rmSync(tmpDir, { recursive: true });
  });

  it('should reject command actions with non-array command field', () => {
    const orgDir = join(tmpDir, 'org', '_repo');
    mkdirSync(orgDir, { recursive: true });
    writeFileSync(join(orgDir, 'dashboard.json'), JSON.stringify({
      actions: [
        { name: 'bad', type: 'command', command: 'rm -rf /' },
        { name: 'good', type: 'command', command: ['echo', 'hi'] },
      ],
    }));

    const config = loadDashboardConfig(tmpDir, 'org', 'repo');
    assert.equal(config.actions.length, 1);
    assert.equal(config.actions[0].name, 'good');

    rmSync(tmpDir, { recursive: true });
  });

  it('should handle duplicate action names by keeping first', () => {
    const orgDir = join(tmpDir, 'org', '_repo');
    mkdirSync(orgDir, { recursive: true });
    writeFileSync(join(orgDir, 'dashboard.json'), JSON.stringify({
      actions: [
        { name: 'test', type: 'script', script: 'test' },
        { name: 'test', type: 'url', url: 'https://dup.com' },
      ],
    }));

    const config = loadDashboardConfig(tmpDir, 'org', 'repo');
    assert.equal(config.actions.length, 1);
    assert.equal(config.actions[0].type, 'script');

    rmSync(tmpDir, { recursive: true });
  });
});

// ── URL protocol validation (AC11) ──

describe('validateUrl', () => {
  it('should accept http URLs', () => {
    assert.equal(validateUrl('http://example.com'), true);
  });

  it('should accept https URLs', () => {
    assert.equal(validateUrl('https://docs.example.com/path?q=1'), true);
  });

  it('should reject file: protocol', () => {
    assert.equal(validateUrl('file:///etc/passwd'), false);
  });

  it('should reject javascript: protocol', () => {
    assert.equal(validateUrl('javascript:alert(1)'), false);
  });

  it('should reject data: protocol', () => {
    assert.equal(validateUrl('data:text/html,<h1>hi</h1>'), false);
  });

  it('should reject empty string', () => {
    assert.equal(validateUrl(''), false);
  });

  it('should reject non-URL strings', () => {
    assert.equal(validateUrl('not a url'), false);
  });
});

// ── Path containment for clear actions (AC10) ──

describe('validateClearPaths', () => {
  const tmpDir = join(__dirname, 'fixtures', '_tmp_clear_test');

  it('should accept paths within checkoutPath', () => {
    mkdirSync(join(tmpDir, 'dist'), { recursive: true });
    const result = validateClearPaths(['dist/'], tmpDir);
    assert.equal(result.valid, true);
    assert.equal(result.resolvedPaths.length, 1);
    rmSync(tmpDir, { recursive: true });
  });

  it('should reject ../ traversal', () => {
    mkdirSync(tmpDir, { recursive: true });
    const result = validateClearPaths(['../../../etc/passwd'], tmpDir);
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('outside'));
    rmSync(tmpDir, { recursive: true });
  });

  it('should reject absolute paths', () => {
    mkdirSync(tmpDir, { recursive: true });
    const result = validateClearPaths(['/etc/passwd'], tmpDir);
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('absolute'));
    rmSync(tmpDir, { recursive: true });
  });

  it('should reject paths that resolve outside checkoutPath', () => {
    mkdirSync(tmpDir, { recursive: true });
    const result = validateClearPaths(['subdir/../../outside'], tmpDir);
    assert.equal(result.valid, false);
    rmSync(tmpDir, { recursive: true });
  });

  it('should reject home directory targets', () => {
    mkdirSync(tmpDir, { recursive: true });
    const result = validateClearPaths(['.'], '/');
    assert.equal(result.valid, false);
    rmSync(tmpDir, { recursive: true });
  });

  it('should handle empty paths array', () => {
    mkdirSync(tmpDir, { recursive: true });
    const result = validateClearPaths([], tmpDir);
    assert.equal(result.valid, true);
    assert.equal(result.resolvedPaths.length, 0);
    rmSync(tmpDir, { recursive: true });
  });
});

// ── Empty MINIME_HOME (AC12) ──

describe('empty MINIME_HOME', () => {
  const tmpDir = join(__dirname, 'fixtures', '_tmp_empty_home');

  it('should return empty orgs for empty directory', () => {
    mkdirSync(tmpDir, { recursive: true });
    const orgs = scanMinimeHome(tmpDir);
    assert.equal(orgs.length, 0);
    rmSync(tmpDir, { recursive: true });
  });
});

describe('createRingBuffer', () => {
  it('should store appended data', () => {
    const rb = createRingBuffer(100);
    rb.append('hello');
    rb.append(' world');
    assert.equal(rb.value, 'hello world');
  });

  it('should cap at maxSize, keeping tail', () => {
    const rb = createRingBuffer(10);
    rb.append('abcdefghij'); // exactly 10
    assert.equal(rb.value, 'abcdefghij');
    rb.append('XYZ');
    assert.equal(rb.value.length, 10);
    assert.equal(rb.value, 'defghijXYZ');
  });

  it('should handle empty appends', () => {
    const rb = createRingBuffer(10);
    rb.append('');
    assert.equal(rb.value, '');
  });

  it('should handle single large append exceeding cap', () => {
    const rb = createRingBuffer(5);
    rb.append('0123456789');
    assert.equal(rb.value, '56789');
  });
});

describe('mergeActions', () => {
  it('should return typed actions with allowed/pinned flags', () => {
    const config = {
      actions: [
        { name: 'dev', type: 'command', command: ['npm', 'run', 'dev'] },
        { name: 'docs', type: 'url', url: 'https://docs.example.com' },
      ],
      allowedActions: ['dev'],
      pinnedActions: ['dev'],
    };
    const result = mergeActions(config, []);
    assert.equal(result.length, 2);
    assert.equal(result[0].allowed, true);
    assert.equal(result[0].pinned, true);
    assert.equal(result[1].allowed, false);
    assert.equal(result[1].pinned, false);
  });

  it('should merge discovered actions that are not in typed', () => {
    const config = {
      actions: [{ name: 'dev', type: 'command', command: ['npm', 'run', 'dev'] }],
      allowedActions: ['dev', 'test'],
      pinnedActions: [],
    };
    const discovered = [
      { name: 'test', source: 'package.json', command: 'npm test' },
      { name: 'build', source: 'package.json', command: 'npm run build' },
    ];
    const result = mergeActions(config, discovered);
    assert.equal(result.length, 3);
    assert.equal(result[0].name, 'dev');
    assert.equal(result[1].name, 'test');
    assert.equal(result[1].type, 'script'); // auto-typed
    assert.equal(result[1].allowed, true);
    assert.equal(result[2].name, 'build');
    assert.equal(result[2].allowed, false);
  });

  it('should not duplicate typed actions from discovery', () => {
    const config = {
      actions: [{ name: 'test', type: 'script', script: 'test' }],
      allowedActions: ['test'],
      pinnedActions: [],
    };
    const discovered = [{ name: 'test', source: 'package.json', command: 'npm test' }];
    const result = mergeActions(config, discovered);
    assert.equal(result.length, 1);
    assert.equal(result[0].type, 'script');
  });

  it('should handle empty typed + empty discovered', () => {
    const config = { actions: [], allowedActions: [], pinnedActions: [] };
    const result = mergeActions(config, []);
    assert.equal(result.length, 0);
  });

  it('should handle missing actions array in config', () => {
    const config = { allowedActions: ['test'], pinnedActions: [] };
    const discovered = [{ name: 'test', source: 'package.json', command: 'npm test' }];
    const result = mergeActions(config, discovered);
    assert.equal(result.length, 1);
    assert.equal(result[0].allowed, true);
  });
});
