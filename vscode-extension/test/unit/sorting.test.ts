import * as assert from 'assert';
import * as path from 'path';
import { MinimeTask, MinimeRepo, MinimeOrg, WikiEntry } from '../../src/models/types';
import { sortTasks, sortWikiEntries, sortRepos, sortOrgs, repoRecentActivity } from '../../src/utils/sorting';
import { parseTaskFile } from '../../src/parsers/taskParser';

const FIXTURES = path.join(__dirname, '..', 'fixtures');

function makeTask(overrides: Partial<MinimeTask>): MinimeTask {
  return {
    filePath: '/fake/task.md',
    shortName: 'task',
    date: '2026-01-01',
    status: 'planning',
    repo: 'org/repo',
    goal: '',
    totalCriteria: 0,
    checkedCriteria: 0,
    modifiedAt: 0,
    ...overrides,
  };
}

function makeWikiEntry(overrides: Partial<WikiEntry>): WikiEntry {
  return {
    filePath: '/fake/wiki.md',
    lineNumber: 1,
    name: 'entry',
    rule: '',
    trigger: '',
    evidence: '',
    origin: '',
    valueScore: 0,
    confidence: 'unknown',
    status: 'active',
    lastVerified: '',
    ...overrides,
  };
}

function makeRepo(overrides: Partial<MinimeRepo> & { name: string }): MinimeRepo {
  return {
    org: 'org',
    path: '/fake',
    tasks: [],
    wikiPath: undefined,
    wikiEntries: [],
    ...overrides,
  };
}

describe('sorting', () => {
  describe('sortTasks', () => {
    it('should sort by modifiedAt descending (newest first)', () => {
      const tasks = [
        makeTask({ shortName: 'old', modifiedAt: 1000 }),
        makeTask({ shortName: 'newest', modifiedAt: 3000 }),
        makeTask({ shortName: 'mid', modifiedAt: 2000 }),
      ];
      const sorted = sortTasks(tasks);
      assert.deepStrictEqual(
        sorted.map(t => t.shortName),
        ['newest', 'mid', 'old']
      );
    });

    it('should break ties with filename date descending', () => {
      const tasks = [
        makeTask({ shortName: 'a', modifiedAt: 1000, date: '2026-01-01' }),
        makeTask({ shortName: 'b', modifiedAt: 1000, date: '2026-03-15' }),
        makeTask({ shortName: 'c', modifiedAt: 1000, date: '2026-02-10' }),
      ];
      const sorted = sortTasks(tasks);
      assert.deepStrictEqual(
        sorted.map(t => t.shortName),
        ['b', 'c', 'a']
      );
    });

    it('should break double ties with shortName ascending', () => {
      const tasks = [
        makeTask({ shortName: 'charlie', modifiedAt: 1000, date: '2026-01-01' }),
        makeTask({ shortName: 'alpha', modifiedAt: 1000, date: '2026-01-01' }),
        makeTask({ shortName: 'bravo', modifiedAt: 1000, date: '2026-01-01' }),
      ];
      const sorted = sortTasks(tasks);
      assert.deepStrictEqual(
        sorted.map(t => t.shortName),
        ['alpha', 'bravo', 'charlie']
      );
    });

    it('should not mutate the original array', () => {
      const tasks = [
        makeTask({ shortName: 'b', modifiedAt: 1000 }),
        makeTask({ shortName: 'a', modifiedAt: 2000 }),
      ];
      const original = [...tasks];
      sortTasks(tasks);
      assert.strictEqual(tasks[0].shortName, original[0].shortName);
    });
  });

  describe('sortWikiEntries', () => {
    it('should sort by lastVerified descending (newest first)', () => {
      const entries = [
        makeWikiEntry({ name: 'old', lastVerified: '2025-01-01' }),
        makeWikiEntry({ name: 'newest', lastVerified: '2026-05-20' }),
        makeWikiEntry({ name: 'mid', lastVerified: '2026-03-01' }),
      ];
      const sorted = sortWikiEntries(entries);
      assert.deepStrictEqual(
        sorted.map(e => e.name),
        ['newest', 'mid', 'old']
      );
    });

    it('should push entries with empty lastVerified to the end', () => {
      const entries = [
        makeWikiEntry({ name: 'no-date', lastVerified: '' }),
        makeWikiEntry({ name: 'has-date', lastVerified: '2026-01-01' }),
        makeWikiEntry({ name: 'also-no-date', lastVerified: '' }),
      ];
      const sorted = sortWikiEntries(entries);
      assert.strictEqual(sorted[0].name, 'has-date');
      assert.ok(sorted.slice(1).every(e => e.lastVerified === ''));
    });

    it('should sort dateless entries by name ascending', () => {
      const entries = [
        makeWikiEntry({ name: 'zebra', lastVerified: '' }),
        makeWikiEntry({ name: 'alpha', lastVerified: '' }),
      ];
      const sorted = sortWikiEntries(entries);
      assert.deepStrictEqual(
        sorted.map(e => e.name),
        ['alpha', 'zebra']
      );
    });

    it('should not mutate the original array', () => {
      const entries = [
        makeWikiEntry({ name: 'b', lastVerified: '2025-01-01' }),
        makeWikiEntry({ name: 'a', lastVerified: '2026-01-01' }),
      ];
      const original = [...entries];
      sortWikiEntries(entries);
      assert.strictEqual(entries[0].name, original[0].name);
    });
  });

  describe('sortRepos', () => {
    it('should sort by most recent child activity descending', () => {
      const repos = [
        makeRepo({ name: 'stale', tasks: [makeTask({ modifiedAt: 1000 })] }),
        makeRepo({ name: 'active', tasks: [makeTask({ modifiedAt: 5000 })] }),
        makeRepo({ name: 'mid', tasks: [makeTask({ modifiedAt: 3000 })] }),
      ];
      const sorted = sortRepos(repos);
      assert.deepStrictEqual(
        sorted.map(r => r.name),
        ['active', 'mid', 'stale']
      );
    });

    it('should consider wiki lastVerified as activity', () => {
      const repos = [
        makeRepo({ name: 'task-only', tasks: [makeTask({ modifiedAt: 1000 })] }),
        makeRepo({
          name: 'wiki-recent',
          wikiEntries: [makeWikiEntry({ lastVerified: '2030-01-01' })],
        }),
      ];
      const sorted = sortRepos(repos);
      assert.strictEqual(sorted[0].name, 'wiki-recent');
    });

    it('should break ties with name ascending', () => {
      const repos = [
        makeRepo({ name: 'beta' }),
        makeRepo({ name: 'alpha' }),
      ];
      const sorted = sortRepos(repos);
      assert.deepStrictEqual(
        sorted.map(r => r.name),
        ['alpha', 'beta']
      );
    });

    it('should handle repos with no tasks or wiki entries', () => {
      const repos = [
        makeRepo({ name: 'empty' }),
        makeRepo({ name: 'has-task', tasks: [makeTask({ modifiedAt: 1000 })] }),
      ];
      const sorted = sortRepos(repos);
      assert.strictEqual(sorted[0].name, 'has-task');
    });

    it('should guard against malformed lastVerified dates', () => {
      const repos = [
        makeRepo({
          name: 'bad-date',
          wikiEntries: [makeWikiEntry({ lastVerified: 'not-a-date' })],
        }),
        makeRepo({ name: 'good', tasks: [makeTask({ modifiedAt: 1000 })] }),
      ];
      const sorted = sortRepos(repos);
      assert.strictEqual(sorted[0].name, 'good');
      assert.strictEqual(repoRecentActivity(repos[0]), 0);
    });
  });

  describe('sortOrgs', () => {
    it('should sort by most recent repo activity descending', () => {
      const orgs: MinimeOrg[] = [
        {
          name: 'stale-org', path: '/s',
          repos: [makeRepo({ name: 'r', tasks: [makeTask({ modifiedAt: 1000 })] })],
        },
        {
          name: 'active-org', path: '/a',
          repos: [makeRepo({ name: 'r', tasks: [makeTask({ modifiedAt: 5000 })] })],
        },
      ];
      const sorted = sortOrgs(orgs);
      assert.deepStrictEqual(
        sorted.map(o => o.name),
        ['active-org', 'stale-org']
      );
    });

    it('should break ties with name ascending', () => {
      const orgs: MinimeOrg[] = [
        { name: 'beta-org', path: '/b', repos: [] },
        { name: 'alpha-org', path: '/a', repos: [] },
      ];
      const sorted = sortOrgs(orgs);
      assert.deepStrictEqual(
        sorted.map(o => o.name),
        ['alpha-org', 'beta-org']
      );
    });
  });

  describe('parseTaskFile modifiedAt', () => {
    it('should populate modifiedAt > 0 from file mtime', () => {
      const taskPath = path.join(
        FIXTURES, 'test-org', '_test-repo', 'tasks', '2026-05-20-fixture-task-planning.task.md'
      );
      const task = parseTaskFile(taskPath);
      assert.ok(task, 'parseTaskFile should return a task');
      assert.ok(task!.modifiedAt > 0, `modifiedAt should be > 0, got ${task!.modifiedAt}`);
    });
  });
});
