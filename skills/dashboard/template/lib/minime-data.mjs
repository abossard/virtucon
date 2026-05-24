// minime-data.mjs — MINIME_HOME scanner + task/wiki parsers for the dashboard extension
// Ported from vscode-extension/src/{parsers,utils} (TypeScript → plain ESM JS)
// Supports both new convention (<org>/_<repo>/) and legacy (<org>__<repo>/) layouts

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename, resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';

// ── resolve MINIME_HOME ──────────────────────────────────────────────

export function resolveMinimeHome() {
  if (process.env.MINIME_HOME) return process.env.MINIME_HOME;
  return join(homedir(), '.minime');
}

// ── task parser ──────────────────────────────────────────────────────

export function parseTaskContent(content, filePath) {
  const ext = filePath.endsWith('.task.md') ? '.task.md' : '.md';
  const fileName = basename(filePath, ext);
  const dateMatch = fileName.match(/^(\d{4}-\d{2}-\d{2})-(.+)$/);

  const date = dateMatch ? dateMatch[1] : '';
  const shortName = dateMatch ? dateMatch[2] : fileName;

  const status = extractField(content, 'Status') || 'unknown';
  const repo = extractField(content, 'Repo') || '';
  const goal = extractGoal(content);
  const { total, checked } = countCriteria(content);

  return { filePath, shortName, date, status, repo, goal, totalCriteria: total, checkedCriteria: checked };
}

function extractField(content, fieldName) {
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

function extractGoal(content) {
  const goalSection = content.match(/## (?:Goal|Context)\s*\n([\s\S]*?)(?=\n## |\n---|$)/);
  if (!goalSection) return '';
  return goalSection[1].trim().split('\n')[0].trim();
}

export function countCriteria(content) {
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

export function getStatusIcon(status) {
  const s = status.toLowerCase();
  if (s === 'done' || s === 'implemented' || s === 'merged') return '\u2705';
  if (s === 'planning') return '\uD83D\uDCDD';
  if (s === 'in_progress' || s === 'implementing') return '\u23F3';
  if (s === 'blocked') return '\uD83D\uDEAB';
  return '\u2754';
}

// ── wiki parser ──────────────────────────────────────────────────────

export function parseWikiContent(content, filePath) {
  const entries = [];
  const lines = content.split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const headingMatch = line.match(/^###\s+(.+)$/);
    if (headingMatch && !isMetaHeading(headingMatch[1])) {
      const entryName = headingMatch[1].trim();
      const entryLineNumber = i + 1;
      i++;

      const entryLines = [];
      while (i < lines.length && !lines[i].match(/^###?\s/)) {
        entryLines.push(lines[i]);
        i++;
      }

      const entryBlock = entryLines.join('\n');
      const entry = parseEntryBlock(entryBlock, entryName, filePath, entryLineNumber);
      if (entry) entries.push(entry);
    } else {
      i++;
    }
  }

  return entries;
}

function isMetaHeading(heading) {
  const meta = ['entries', 'example', 'template'];
  return meta.some(m => heading.toLowerCase().startsWith(m));
}

function parseEntryBlock(block, name, filePath, lineNumber) {
  const rule = extractBulletField(block, 'Rule');
  const trigger = extractBulletField(block, 'Trigger');

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
  };
}

function extractBulletField(block, fieldName) {
  const pattern = new RegExp(
    `^\\s*-\\s+\\*\\*${fieldName}:?\\*\\*:?\\s*(.+)$`,
    'im'
  );
  const match = block.match(pattern);
  return match ? match[1].trim() : undefined;
}

function parseValueScore(value) {
  if (!value) return 0;
  const num = parseInt(value, 10);
  return isNaN(num) ? 0 : num;
}

// ── MINIME_HOME scanner ──────────────────────────────────────────────

export function scanMinimeHome(minimeHome) {
  if (!existsSync(minimeHome)) return [];

  const orgMap = new Map();

  scanNewConvention(minimeHome, orgMap);
  scanLegacyTasks(minimeHome, orgMap);
  scanLegacyWikis(minimeHome, orgMap);

  return Array.from(orgMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function getOrCreateOrg(orgMap, orgName, orgPath) {
  let org = orgMap.get(orgName);
  if (!org) {
    org = { name: orgName, path: orgPath, repos: [] };
    orgMap.set(orgName, org);
  }
  return org;
}

function getOrCreateRepo(org, repoName, repoPath) {
  let repo = org.repos.find(r => r.name === repoName);
  if (!repo) {
    repo = {
      name: repoName,
      org: org.name,
      path: repoPath,
      tasks: [],
      wikiPath: undefined,
      wikiEntries: [],
    };
    org.repos.push(repo);
  }
  return repo;
}

function scanNewConvention(minimeHome, orgMap) {
  const entries = safeReaddir(minimeHome);

  for (const entry of entries) {
    const orgPath = join(minimeHome, entry);
    if (!isDirectory(orgPath) || isSpecialDir(entry)) continue;

    const orgName = entry;
    const orgEntries = safeReaddir(orgPath);

    const orgWikiPath = join(orgPath, 'wiki.md');

    for (const repoEntry of orgEntries) {
      if (!repoEntry.startsWith('_')) continue;
      const repoPath = join(orgPath, repoEntry);
      if (!isDirectory(repoPath)) continue;

      const repoName = repoEntry.slice(1);
      const org = getOrCreateOrg(orgMap, orgName, orgPath);
      const repo = getOrCreateRepo(org, repoName, repoPath);

      const tasksDir = join(repoPath, 'tasks');
      if (isDirectory(tasksDir)) {
        const taskFiles = safeReaddir(tasksDir).filter(f => f.endsWith('.md'));
        for (const taskFile of taskFiles) {
          const taskPath = join(tasksDir, taskFile);
          const task = parseTaskFile(taskPath);
          if (task && !repo.tasks.find(t => t.shortName === task.shortName)) {
            repo.tasks.push(task);
          }
        }
      }

      const wikiPath = join(repoPath, 'wiki.md');
      if (existsSync(wikiPath)) {
        repo.wikiPath = wikiPath;
        repo.wikiEntries = parseWikiFile(wikiPath);
      }
    }

    if (existsSync(orgWikiPath)) {
      const org = getOrCreateOrg(orgMap, orgName, orgPath);
      const orgWikiRepo = getOrCreateRepo(org, '(org wiki)', orgPath);
      orgWikiRepo.wikiPath = orgWikiPath;
      orgWikiRepo.wikiEntries = parseWikiFile(orgWikiPath);
    }
  }
}

function scanLegacyTasks(minimeHome, orgMap) {
  const tasksDir = join(minimeHome, 'tasks');
  if (!isDirectory(tasksDir)) return;

  const entries = safeReaddir(tasksDir);
  for (const entry of entries) {
    const parts = entry.split('__');
    if (parts.length !== 2) continue;

    const [orgName, repoName] = parts;
    const repoTasksDir = join(tasksDir, entry);
    if (!isDirectory(repoTasksDir)) continue;

    const org = getOrCreateOrg(orgMap, orgName, join(minimeHome, orgName));
    const repo = getOrCreateRepo(org, repoName, repoTasksDir);

    const taskFiles = safeReaddir(repoTasksDir).filter(f => f.endsWith('.md'));
    for (const taskFile of taskFiles) {
      const taskPath = join(repoTasksDir, taskFile);
      const task = parseTaskFile(taskPath);
      if (task && !repo.tasks.find(t => t.shortName === task.shortName)) {
        repo.tasks.push(task);
      }
    }
  }
}

function scanLegacyWikis(minimeHome, orgMap) {
  const wikiDir = join(minimeHome, 'wiki', 'repos');
  if (!isDirectory(wikiDir)) return;

  const entries = safeReaddir(wikiDir).filter(f => f.endsWith('.md'));
  for (const entry of entries) {
    const baseName = entry.replace(/\.md$/, '');
    const parts = baseName.split('__');
    if (parts.length !== 2) continue;

    const [orgName, repoName] = parts;
    const wikiPath = join(wikiDir, entry);

    const org = getOrCreateOrg(orgMap, orgName, join(minimeHome, orgName));
    const repo = getOrCreateRepo(org, repoName, join(minimeHome, orgName));

    if (!repo.wikiPath) {
      repo.wikiPath = wikiPath;
      repo.wikiEntries = parseWikiFile(wikiPath);
    }
  }
}

function parseTaskFile(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return parseTaskContent(content, filePath);
  } catch {
    return undefined;
  }
}

function parseWikiFile(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return parseWikiContent(content, filePath);
  } catch {
    return [];
  }
}

function safeReaddir(dir) {
  try {
    return readdirSync(dir).filter(e => !e.startsWith('.'));
  } catch {
    return [];
  }
}

function isDirectory(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isSpecialDir(name) {
  return ['templates', 'tasks', 'wiki'].includes(name);
}

// ── dashboard.json config ────────────────────────────────────────────

export function loadDashboardConfig(minimeHome, org, repo) {
  const configPath = join(minimeHome, org, `_${repo}`, 'dashboard.json');
  try {
    const raw = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);
    return validateDashboardConfig(config);
  } catch {
    return defaultDashboardConfig();
  }
}

function defaultDashboardConfig() {
  return {
    allowedActions: [],
    pinnedActions: [],
    hiddenPanels: [],
    checkoutPath: null,
    actions: [],
  };
}

const VALID_ACTION_TYPES = ['script', 'url', 'command', 'clear'];

function validateDashboardConfig(config) {
  if (typeof config !== 'object' || config === null) return defaultDashboardConfig();

  return {
    allowedActions: Array.isArray(config.allowedActions) ? config.allowedActions.filter(a => typeof a === 'string') : [],
    pinnedActions: Array.isArray(config.pinnedActions) ? config.pinnedActions.filter(a => typeof a === 'string') : [],
    hiddenPanels: Array.isArray(config.hiddenPanels) ? config.hiddenPanels.filter(a => typeof a === 'string') : [],
    checkoutPath: typeof config.checkoutPath === 'string' ? config.checkoutPath : null,
    actions: validateActions(config.actions),
  };
}

function validateActions(actions) {
  if (!Array.isArray(actions)) return [];

  const seen = new Set();
  const validated = [];

  for (const action of actions) {
    if (typeof action !== 'object' || action === null) continue;
    if (typeof action.name !== 'string' || !action.name) continue;
    if (!VALID_ACTION_TYPES.includes(action.type)) continue;
    if (seen.has(action.name)) continue;

    // Type-specific validation
    if (action.type === 'command') {
      if (!Array.isArray(action.command) || action.command.length === 0) continue;
      if (!action.command.every(a => typeof a === 'string')) continue;
    }
    if (action.type === 'url') {
      if (typeof action.url !== 'string') continue;
    }
    if (action.type === 'clear') {
      if (!Array.isArray(action.paths) || action.paths.length === 0) continue;
      if (!action.paths.every(p => typeof p === 'string')) continue;
    }
    if (action.type === 'script') {
      if (typeof action.script !== 'string') continue;
    }

    seen.add(action.name);

    // Build clean action object (only known fields)
    const clean = { name: action.name, type: action.type };
    if (action.type === 'command') {
      clean.command = action.command;
      clean.background = action.background === true;
    }
    if (action.type === 'url') clean.url = action.url;
    if (action.type === 'clear') clean.paths = action.paths;
    if (action.type === 'script') clean.script = action.script;

    validated.push(clean);
  }

  return validated;
}

// ── URL validation (AC11) ────────────────────────────────────────────

export function validateUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  try {
    const parsed = new URL(urlStr);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// ── Path containment for clear actions (AC10) ────────────────────────

export function validateClearPaths(paths, checkoutPath) {
  if (!Array.isArray(paths)) return { valid: false, error: 'paths must be an array', resolvedPaths: [] };
  if (paths.length === 0) return { valid: true, resolvedPaths: [] };

  const resolvedCheckout = resolve(checkoutPath);
  // Reject if checkoutPath is root or home
  const home = homedir();
  if (resolvedCheckout === '/' || resolvedCheckout === home) {
    return { valid: false, error: `checkoutPath "${checkoutPath}" is root or home directory`, resolvedPaths: [] };
  }

  const resolvedPaths = [];

  for (const p of paths) {
    if (typeof p !== 'string' || !p) {
      return { valid: false, error: `invalid path: ${p}`, resolvedPaths: [] };
    }
    if (isAbsolute(p)) {
      return { valid: false, error: `absolute path not allowed: ${p}`, resolvedPaths: [] };
    }

    const resolved = resolve(resolvedCheckout, p);
    if (!resolved.startsWith(resolvedCheckout + '/') && resolved !== resolvedCheckout) {
      return { valid: false, error: `path "${p}" resolves outside checkoutPath`, resolvedPaths: [] };
    }

    resolvedPaths.push(resolved);
  }

  return { valid: true, resolvedPaths };
}

// ── project action discovery ─────────────────────────────────────────

export function discoverProjectActions(projectDir) {
  const actions = [];

  // package.json scripts
  const pkgPath = join(projectDir, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      if (pkg.scripts && typeof pkg.scripts === 'object') {
        for (const [name, cmd] of Object.entries(pkg.scripts)) {
          actions.push({ name, command: `npm run ${name}`, source: 'package.json', rawCommand: String(cmd) });
        }
      }
    } catch { /* ignore malformed package.json */ }
  }

  // Makefile targets
  const makefilePath = join(projectDir, 'Makefile');
  if (existsSync(makefilePath)) {
    try {
      const content = readFileSync(makefilePath, 'utf-8');
      const targetPattern = /^([a-zA-Z_][a-zA-Z0-9_-]*):/gm;
      let match;
      while ((match = targetPattern.exec(content)) !== null) {
        actions.push({ name: match[1], command: `make ${match[1]}`, source: 'Makefile', rawCommand: `make ${match[1]}` });
      }
    } catch { /* ignore */ }
  }

  return actions;
}

// ── utility: find latest task across all orgs ────────────────────────

export function findLatestTask(orgs) {
  const allTasks = orgs.flatMap(o => o.repos.flatMap(r => r.tasks));
  if (allTasks.length === 0) return undefined;
  return allTasks.sort((a, b) => b.date.localeCompare(a.date))[0];
}

// ── ring buffer for capped output ────────────────────────────────────

export function createRingBuffer(maxSize) {
  let buf = '';
  return {
    append(data) { buf += data; if (buf.length > maxSize) buf = buf.slice(-maxSize); },
    get value() { return buf; },
  };
}

// ── merge typed + discovered actions ─────────────────────────────────

export function mergeActions(config, discoveredActions) {
  const typed = config.actions || [];
  const seen = new Set(typed.map(a => a.name));

  const merged = [...typed];
  for (const d of discoveredActions) {
    if (!seen.has(d.name)) {
      merged.push({ ...d, type: 'script' });
      seen.add(d.name);
    }
  }

  return merged.map(a => ({
    ...a,
    allowed: config.allowedActions.includes(a.name),
    pinned: (config.pinnedActions || []).includes(a.name),
  }));
}
