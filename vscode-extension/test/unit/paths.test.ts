import * as assert from 'assert';
import * as path from 'path';
import { resolveMinimeHome, scanMinimeHome, getTemplatePaths, findLatestTask } from '../../src/utils/paths';

const FIXTURES = path.join(__dirname, '..', 'fixtures');

describe('paths', () => {
  describe('resolveMinimeHome', () => {
    const originalEnv = process.env.VIRTUCON_HQ;

    afterEach(() => {
      if (originalEnv !== undefined) {
        process.env.VIRTUCON_HQ = originalEnv;
      } else {
        delete process.env.VIRTUCON_HQ;
      }
    });

    it('should prefer config setting over env var', () => {
      process.env.VIRTUCON_HQ = '/env/path';
      const result = resolveMinimeHome({ settingHome: '/setting/path' });
      assert.strictEqual(result, '/setting/path');
    });

    it('should use env var when no setting', () => {
      process.env.VIRTUCON_HQ = '/env/path';
      const result = resolveMinimeHome();
      assert.strictEqual(result, '/env/path');
    });

    it('should fall back to ~/.minime', () => {
      delete process.env.VIRTUCON_HQ;
      const result = resolveMinimeHome();
      assert.ok(result.endsWith('.minime'));
    });
  });

  describe('scanMinimeHome (new convention)', () => {
    it('should find orgs and repos from new-convention dirs', () => {
      const orgs = scanMinimeHome(FIXTURES);
      const testOrg = orgs.find(o => o.name === 'test-org');
      assert.ok(testOrg, 'should find test-org');
      const testRepo = testOrg!.repos.find(r => r.name === 'test-repo');
      assert.ok(testRepo, 'should find test-repo');
    });

    it('should parse tasks from new convention', () => {
      const orgs = scanMinimeHome(FIXTURES);
      const testOrg = orgs.find(o => o.name === 'test-org')!;
      const testRepo = testOrg.repos.find(r => r.name === 'test-repo')!;
      assert.ok(testRepo.tasks.length >= 2, `expected >=2 tasks, got ${testRepo.tasks.length}`);
    });

    it('should parse legacy wiki.md files from new convention repos', () => {
      const orgs = scanMinimeHome(FIXTURES);
      const testOrg = orgs.find(o => o.name === 'test-org')!;
      const testRepo = testOrg.repos.find(r => r.name === 'test-repo')!;
      assert.ok(testRepo.wikiEntries.length >= 2, `expected >=2 wiki entries, got ${testRepo.wikiEntries.length}`);
      assert.ok(testRepo.wikiEntries.every(entry => entry.kind === 'entry'));
    });

    it('should surface wiki pages from wiki directories', () => {
      const orgs = scanMinimeHome(FIXTURES);
      const testOrg = orgs.find(o => o.name === 'test-org')!;
      const wikiDirRepo = testOrg.repos.find(r => r.name === 'wiki-dir-repo')!;
      assert.strictEqual(wikiDirRepo.wikiPath, path.join(FIXTURES, 'test-org', '_wiki-dir-repo', 'wiki'));
      assert.deepStrictEqual(
        [...wikiDirRepo.wikiEntries.map(entry => entry.name)].sort(),
        ['Karpathy contract', 'Wiki index: wiki-dir-repo', 'Wiki log: wiki-dir-repo']
      );
      assert.ok(wikiDirRepo.wikiEntries.every(entry => entry.kind === 'page'));
    });

    it('should surface org-level wiki directories as a synthetic repo', () => {
      const orgs = scanMinimeHome(FIXTURES);
      const testOrg = orgs.find(o => o.name === 'test-org')!;
      const orgWikiRepo = testOrg.repos.find(r => r.name === '(org wiki)')!;
      assert.strictEqual(orgWikiRepo.wikiPath, path.join(FIXTURES, 'test-org', 'wiki'));
      assert.deepStrictEqual(
        [...orgWikiRepo.wikiEntries.map(entry => entry.name)].sort(),
        ['Org wiki index: test-org', 'Org wiki log: test-org']
      );
    });

    it('should prefer wiki directories over legacy wiki.md when both exist', () => {
      const orgs = scanMinimeHome(FIXTURES);
      const testOrg = orgs.find(o => o.name === 'test-org')!;
      const repo = testOrg.repos.find(r => r.name === 'prefer-wiki-dir-repo')!;
      assert.strictEqual(repo.wikiPath, path.join(FIXTURES, 'test-org', '_prefer-wiki-dir-repo', 'wiki'));
      assert.deepStrictEqual(repo.wikiEntries.map(entry => entry.name), ['Directory wiki index']);
      assert.ok(repo.wikiEntries.every(entry => entry.kind === 'page'));
    });
  });

  describe('scanMinimeHome (legacy convention)', () => {
    it('should merge legacy tasks into same repo', () => {
      const orgs = scanMinimeHome(FIXTURES);
      const testOrg = orgs.find(o => o.name === 'test-org')!;
      const testRepo = testOrg.repos.find(r => r.name === 'test-repo')!;
      const legacyTask = testRepo.tasks.find(t => t.shortName === 'legacy-task');
      assert.ok(legacyTask, 'should find legacy task merged into test-repo');
    });
  });

  describe('scanMinimeHome (nonexistent)', () => {
    it('should return empty array for nonexistent path', () => {
      const orgs = scanMinimeHome('/nonexistent/path');
      assert.strictEqual(orgs.length, 0);
    });
  });

  describe('getTemplatePaths', () => {
    it('should return empty for fixture dir (no templates folder)', () => {
      const templates = getTemplatePaths(FIXTURES);
      assert.strictEqual(templates.length, 0);
    });
  });

  describe('findLatestTask', () => {
    it('should return the task with the latest date', () => {
      const orgs = scanMinimeHome(FIXTURES);
      const latest = findLatestTask(orgs);
      assert.ok(latest);
      assert.strictEqual(latest.date, '2026-05-26');
    });
  });
});
