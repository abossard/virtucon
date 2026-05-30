import * as assert from 'assert';
import { parseWikiContent, parseWikiPageContent } from '../../src/parsers/wikiParser';

describe('wikiParser', () => {
  const sampleWiki = `# test-org/test-repo: Corrections Wiki

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
    assert.strictEqual(entries.length, 3);
  });

  it('should extract entry names from h3 headings', () => {
    const entries = parseWikiContent(sampleWiki, '/fake/wiki.md');
    assert.strictEqual(entries[0].name, 'Always use parameterized queries');
    assert.strictEqual(entries[1].name, 'Cache API responses for 5 minutes');
  });

  it('should extract rule text', () => {
    const entries = parseWikiContent(sampleWiki, '/fake/wiki.md');
    assert.strictEqual(entries[0].rule, 'Never concatenate user input into SQL strings.');
  });

  it('should extract trigger text', () => {
    const entries = parseWikiContent(sampleWiki, '/fake/wiki.md');
    assert.strictEqual(entries[0].trigger, 'Any task touching database queries or ORM usage.');
  });

  it('should extract evidence', () => {
    const entries = parseWikiContent(sampleWiki, '/fake/wiki.md');
    assert.strictEqual(entries[0].evidence, '`src/db/queries.ts:22`');
  });

  it('should parse numeric valueScore', () => {
    const entries = parseWikiContent(sampleWiki, '/fake/wiki.md');
    assert.strictEqual(entries[0].valueScore, 8);
    assert.strictEqual(entries[1].valueScore, 5);
  });

  it('should extract confidence and status', () => {
    const entries = parseWikiContent(sampleWiki, '/fake/wiki.md');
    assert.strictEqual(entries[0].confidence, 'high');
    assert.strictEqual(entries[0].status, 'active');
    assert.strictEqual(entries[2].confidence, 'low');
    assert.strictEqual(entries[2].status, 'stale');
  });

  it('should track line numbers', () => {
    const entries = parseWikiContent(sampleWiki, '/fake/wiki.md');
    // First entry heading is at line 5 (1-indexed)
    assert.ok(entries[0].lineNumber > 0);
    assert.ok(entries[1].lineNumber > entries[0].lineNumber);
  });

  it('should store filePath on each entry', () => {
    const entries = parseWikiContent(sampleWiki, '/fake/wiki.md');
    entries.forEach(e => assert.strictEqual(e.filePath, '/fake/wiki.md'));
  });

  it('should skip template/example headings', () => {
    const content = `### Entries\n\n### EXAMPLE: Money is integer\n- **Rule:** test\n- **Trigger:** test`;
    const entries = parseWikiContent(content, '/fake/wiki.md');
    assert.strictEqual(entries.length, 0);
  });

  it('should handle empty content', () => {
    const entries = parseWikiContent('', '/fake/wiki.md');
    assert.strictEqual(entries.length, 0);
  });

  it('should handle content with no entries', () => {
    const content = `# Wiki\n\nNo entries yet.`;
    const entries = parseWikiContent(content, '/fake/wiki.md');
    assert.strictEqual(entries.length, 0);
  });

  it('should handle entries with missing fields', () => {
    const content = `### Partial entry\n- **Rule:** Some rule\n- **Trigger:** Some trigger`;
    const entries = parseWikiContent(content, '/fake/wiki.md');
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].rule, 'Some rule');
    assert.strictEqual(entries[0].confidence, 'unknown');
    assert.strictEqual(entries[0].valueScore, 0);
  });

  it('should parse wiki page titles and summaries', () => {
    const page = parseWikiPageContent(
      '# Karpathy contract\n\nImmutable raw documents feed linked wiki pages.',
      '/fake/wiki/karpathy-contract.md',
      '2026-05-30'
    );
    assert.strictEqual(page.name, 'Karpathy contract');
    assert.strictEqual(page.rule, 'Immutable raw documents feed linked wiki pages.');
    assert.strictEqual(page.kind, 'page');
    assert.strictEqual(page.lineNumber, 1);
    assert.strictEqual(page.lastVerified, '2026-05-30');
  });

  it('should fall back to the filename when a wiki page has no heading', () => {
    const page = parseWikiPageContent(
      'Just a paragraph without a title.',
      '/fake/wiki/index.md',
      '2026-05-30'
    );
    assert.strictEqual(page.name, 'index');
    assert.strictEqual(page.rule, 'Just a paragraph without a title.');
  });
});
