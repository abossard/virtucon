import * as assert from 'assert';
import * as path from 'path';
import { parseTaskContent, countCriteria, getStatusIcon } from '../../src/parsers/taskParser';

const FIXTURES = path.join(__dirname, '..', 'fixtures');

describe('taskParser', () => {
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

## Goal
A test task still in planning phase.

## Acceptance criteria (EARS-style -- each must be independently testable)

- [ ] The system shall support pagination -- VOI: needs-research
- [ ] When results exceed 100, the system shall paginate -- VOI: decided-by-data`;

    it('should extract status from header', () => {
      const task = parseTaskContent(doneTaskContent, '/fake/2026-01-15-fixture-task-done.task.md');
      assert.ok(task);
      assert.strictEqual(task.status, 'implemented');
    });

    it('should extract repo from header', () => {
      const task = parseTaskContent(doneTaskContent, '/fake/2026-01-15-fixture-task-done.task.md');
      assert.ok(task);
      assert.strictEqual(task.repo, 'test-org/test-repo');
    });

    it('should extract date and shortName from filename', () => {
      const task = parseTaskContent(doneTaskContent, '/fake/2026-01-15-fixture-task-done.task.md');
      assert.ok(task);
      assert.strictEqual(task.date, '2026-01-15');
      assert.strictEqual(task.shortName, 'fixture-task-done');
    });

    it('should extract goal', () => {
      const task = parseTaskContent(doneTaskContent, '/fake/2026-01-15-fixture-task-done.task.md');
      assert.ok(task);
      assert.strictEqual(task.goal, 'A test task that is fully completed.');
    });

    it('should count criteria correctly for mixed checked/unchecked', () => {
      const task = parseTaskContent(doneTaskContent, '/fake/2026-01-15-fixture-task-done.task.md');
      assert.ok(task);
      assert.strictEqual(task.totalCriteria, 3);
      assert.strictEqual(task.checkedCriteria, 2);
    });

    it('should count criteria correctly for all unchecked', () => {
      const task = parseTaskContent(planningTaskContent, '/fake/2026-05-20-fixture-task-planning.task.md');
      assert.ok(task);
      assert.strictEqual(task.totalCriteria, 2);
      assert.strictEqual(task.checkedCriteria, 0);
    });

    it('should handle content with no criteria section', () => {
      const content = `# Task: minimal\n\nCreated: 2026-01-01  |  Status: planning  |  Repo: org/repo\n\n## Goal\nMinimal task.`;
      const task = parseTaskContent(content, '/fake/2026-01-01-minimal.task.md');
      assert.ok(task);
      assert.strictEqual(task.totalCriteria, 0);
      assert.strictEqual(task.checkedCriteria, 0);
    });

    it('should handle malformed content gracefully', () => {
      const task = parseTaskContent('just some random text', '/fake/bad.task.md');
      assert.ok(task);
      assert.strictEqual(task.status, 'unknown');
      assert.strictEqual(task.shortName, 'bad');
    });

    it('should parse plain .md files (not .task.md)', () => {
      const content = `Status: implemented\n\n# Fix bugs\n\n## Context\nThree bugs found.\n\n## EARS Criteria\n\n- [x] Bug 1 fixed\n- [x] Bug 2 fixed`;
      const task = parseTaskContent(content, '/fake/task.md');
      assert.ok(task);
      assert.strictEqual(task.shortName, 'task');
      assert.strictEqual(task.status, 'implemented');
      assert.strictEqual(task.totalCriteria, 2);
      assert.strictEqual(task.checkedCriteria, 2);
    });

    it('should extract goal from ## Context when ## Goal absent', () => {
      const content = `# Task\n\n## Context\nThree bugs discovered.\n\n## Criteria`;
      const task = parseTaskContent(content, '/fake/2026-01-01-bugs.task.md');
      assert.ok(task);
      assert.strictEqual(task.goal, 'Three bugs discovered.');
    });

    it('should parse .blueprint.md extension correctly', () => {
      const content = `# Blueprint: fixture-blueprint\n\nCreated: 2026-05-26  |  Status: planning  |  Repo: test-org/test-repo\n\n## Goal\nA test blueprint.\n\n## Acceptance criteria\n\n- [ ] C1\n- [x] C2`;
      const task = parseTaskContent(content, '/fake/2026-05-26-fixture-blueprint.blueprint.md');
      assert.ok(task);
      assert.strictEqual(task.shortName, 'fixture-blueprint');
      assert.strictEqual(task.date, '2026-05-26');
      assert.strictEqual(task.totalCriteria, 2);
      assert.strictEqual(task.checkedCriteria, 1);
    });

    it('should extract status from ## Status: header', () => {
      const content = `# Task\n\n## Status: implemented\n\n## EARS Criteria\n\n- [x] Done`;
      const task = parseTaskContent(content, '/fake/data-persistence.md');
      assert.ok(task);
      assert.strictEqual(task.status, 'implemented');
      assert.strictEqual(task.shortName, 'data-persistence');
    });
  });

  describe('countCriteria', () => {
    it('should count EARS Criteria section', () => {
      const content = `## EARS Criteria\n\n- [x] C1 done\n- [ ] C2 pending\n- [x] C3 done`;
      const result = countCriteria(content);
      assert.strictEqual(result.total, 3);
      assert.strictEqual(result.checked, 2);
    });
    it('should count mixed criteria', () => {
      const content = `## Acceptance criteria\n\n- [x] Done\n- [ ] Not done\n- [x] Also done`;
      const result = countCriteria(content);
      assert.strictEqual(result.total, 3);
      assert.strictEqual(result.checked, 2);
    });

    it('should return zero for empty content', () => {
      const result = countCriteria('no criteria here');
      assert.strictEqual(result.total, 0);
      assert.strictEqual(result.checked, 0);
    });

    it('should handle uppercase X', () => {
      const content = `## Acceptance criteria\n\n- [X] Done`;
      const result = countCriteria(content);
      assert.strictEqual(result.total, 1);
      assert.strictEqual(result.checked, 1);
    });
  });

  describe('getStatusIcon', () => {
    const cases: Array<{ input: string; expected: string }> = [
      { input: 'implemented', expected: '\u2705' },
      { input: 'done', expected: '\u2705' },
      { input: 'merged', expected: '\u2705' },
      { input: 'planning', expected: '\uD83D\uDCDD' },
      { input: 'in_progress', expected: '\u23F3' },
      { input: 'implementing', expected: '\u23F3' },
      { input: 'blocked', expected: '\uD83D\uDEAB' },
      { input: 'unknown_status', expected: '\u2754' },
    ];

    cases.forEach(({ input, expected }) => {
      it(`should return correct icon for "${input}"`, () => {
        assert.strictEqual(getStatusIcon(input), expected);
      });
    });
  });
});
