import * as fs from 'fs';
import * as path from 'path';
import { WikiEntry } from '../models/types';

export function parseWikiFile(filePath: string): WikiEntry[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return parseWikiContent(content, filePath);
  } catch {
    return [];
  }
}

export function parseWikiPageFile(filePath: string): WikiEntry | undefined {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lastVerified = fs.statSync(filePath).mtime.toISOString().slice(0, 10);
    return parseWikiPageContent(content, filePath, lastVerified);
  } catch {
    return undefined;
  }
}

export function parseWikiContent(content: string, filePath: string): WikiEntry[] {
  const entries: WikiEntry[] = [];
  const lines = content.split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Wiki entries start with ### (h3 heading)
    const headingMatch = line.match(/^###\s+(.+)$/);
    if (headingMatch && !isMetaHeading(headingMatch[1])) {
      const entryName = headingMatch[1].trim();
      const entryLineNumber = i + 1; // 1-indexed
      i++;

      // Collect all lines until next heading or end
      const entryLines: string[] = [];
      while (i < lines.length && !lines[i].match(/^###?\s/)) {
        entryLines.push(lines[i]);
        i++;
      }

      const entryBlock = entryLines.join('\n');
      const entry = parseEntryBlock(entryBlock, entryName, filePath, entryLineNumber);
      if (entry) {
        entries.push(entry);
      }
    } else {
      i++;
    }
  }

  return entries;
}

function isMetaHeading(heading: string): boolean {
  const meta = ['entries', 'example', 'template'];
  return meta.some(m => heading.toLowerCase().startsWith(m));
}

function parseEntryBlock(
  block: string,
  name: string,
  filePath: string,
  lineNumber: number
): WikiEntry | undefined {
  const rule = extractBulletField(block, 'Rule');
  const trigger = extractBulletField(block, 'Trigger');

  // Skip template/example entries
  if (!rule && !trigger) return undefined;

  return {
    filePath,
    lineNumber,
    name,
    rule: rule || '',
    trigger: trigger || '',
    evidence: extractBulletField(block, 'Evidence') || '',
    origin: extractBulletField(block, 'Origin') || '',
    valueScore: parseValueScore(extractBulletField(block, 'ValueScore')),
    confidence: extractBulletField(block, 'Confidence') || 'unknown',
    status: extractBulletField(block, 'Status') || 'unknown',
    lastVerified: extractBulletField(block, 'LastVerified') || '',
    kind: 'entry',
  };
}

export function parseWikiPageContent(
  content: string,
  filePath: string,
  lastVerified = ''
): WikiEntry {
  const lines = content.split('\n').map(line => line.trim());
  const titleLine = lines.find(line => line.startsWith('# '));
  const summaryLine = lines.find(line => line && !line.startsWith('#') && !line.startsWith('- ') && !line.startsWith('* '));

  return {
    filePath,
    lineNumber: 1,
    name: titleLine ? titleLine.replace(/^#\s+/, '').trim() : path.basename(filePath, path.extname(filePath)),
    rule: summaryLine || '',
    trigger: '',
    evidence: '',
    origin: 'wiki-page',
    valueScore: 0,
    confidence: 'page',
    status: 'active',
    lastVerified,
    kind: 'page',
  };
}

function extractBulletField(block: string, fieldName: string): string | undefined {
  // Match "- **FieldName:** value" or "- **FieldName**: value"
  const pattern = new RegExp(
    `^\\s*-\\s+\\*\\*${fieldName}:?\\*\\*:?\\s*(.+)$`,
    'im'
  );
  const match = block.match(pattern);
  return match ? match[1].trim() : undefined;
}

function parseValueScore(value: string | undefined): number {
  if (!value) return 0;
  const num = parseInt(value, 10);
  return isNaN(num) ? 0 : num;
}
