import * as fs from 'fs';
import * as path from 'path';
import { MinimeTask } from '../models/types';

export function parseTaskFile(filePath: string): MinimeTask | undefined {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return parseTaskContent(content, filePath);
  } catch {
    return undefined;
  }
}

export function parseTaskContent(content: string, filePath: string): MinimeTask | undefined {
  const ext = filePath.endsWith('.task.md') ? '.task.md' : '.md';
  const fileName = path.basename(filePath, ext);
  const dateMatch = fileName.match(/^(\d{4}-\d{2}-\d{2})-(.+)$/);

  const date = dateMatch ? dateMatch[1] : '';
  const shortName = dateMatch ? dateMatch[2] : fileName;

  const status = extractField(content, 'Status') || 'unknown';
  const repo = extractField(content, 'Repo') || '';
  const goal = extractGoal(content);

  const { total, checked } = countCriteria(content);

  return {
    filePath,
    shortName,
    date,
    status,
    repo,
    goal,
    totalCriteria: total,
    checkedCriteria: checked,
  };
}

function extractField(content: string, fieldName: string): string | undefined {
  // Match "Status: value" in header line (pipe-separated) or "## Status: value" or bare "Status: value"
  const patterns = [
    new RegExp(`${fieldName}:\\s*(.+?)(?:\\s*\\||$)`, 'im'),
    new RegExp(`^##\\s*${fieldName}:\\s*(.+)$`, 'im'),
  ];
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) return match[1].trim();
  }
  return undefined;
}

function extractGoal(content: string): string {
  const goalSection = content.match(/## (?:Goal|Context)\s*\n([\s\S]*?)(?=\n## |\n---|$)/);
  if (!goalSection) return '';
  return goalSection[1].trim().split('\n')[0].trim();
}

export function countCriteria(content: string): { total: number; checked: number } {
  const criteriaSection = content.match(
    /## (?:Acceptance [Cc]riteria|EARS [Cc]riteria)[\s\S]*?\n([\s\S]*?)(?=\n## |\n---|$)/
  );
  if (!criteriaSection) return { total: 0, checked: 0 };

  const lines = criteriaSection[1].split('\n');
  let total = 0;
  let checked = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- [x]') || trimmed.startsWith('- [X]')) {
      total++;
      checked++;
    } else if (trimmed.startsWith('- [ ]')) {
      total++;
    }
  }

  return { total, checked };
}

export function getStatusIcon(status: string): string {
  const s = status.toLowerCase();
  if (s === 'done' || s === 'implemented' || s === 'merged') return '\u2705';
  if (s === 'planning') return '\uD83D\uDCDD';
  if (s === 'in_progress' || s === 'implementing') return '\u23F3';
  if (s === 'blocked') return '\uD83D\uDEAB';
  return '\u2754';
}
