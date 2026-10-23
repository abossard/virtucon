#!/usr/bin/env node
// SessionStart hook for minime plugin.
// Injects a nudge plus canonical paths into the session context.
// Auto-bootstraps VIRTUCON_HQ if paths are missing.
// Must never fail. Always exits 0 with valid JSON.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = process.env.PLUGIN_ROOT
  || process.env.CLAUDE_PLUGIN_ROOT
  || process.env.CLAUDE_SKILL_DIR && path.resolve(process.env.CLAUDE_SKILL_DIR, '..', '..')
  || path.resolve(__dirname, '..');
const VIRTUCON_HQ = process.env.VIRTUCON_HQ || path.join(process.env.HOME || '~', '.minime');

function readHookInput() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve({});
    let data = '';
    const finish = () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
      process.stdin.pause();
    };
    const timer = setTimeout(finish, 300);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => { clearTimeout(timer); finish(); });
    process.stdin.on('error', () => { clearTimeout(timer); finish(); });
  });
}

function deriveOrgRepo(cwd) {
  try {
    const origin = execSync('git remote get-url origin 2>/dev/null', { encoding: 'utf8', cwd }).trim();
    if (!origin) return null;
    const cleaned = origin
      .replace(/^https?:\/\/([^.]+)\.visualstudio\.com\/.+\/_git\/(.+)$/, '$1/$2')
      .replace(/^https?:\/\/dev\.azure\.com\/([^/]+)\/.+\/_git\/(.+)$/, '$1/$2')
      .replace(/^git@ssh\.dev\.azure\.com:v3\/([^/]+)\/[^/]+\/(.+)$/, '$1/$2')
      .replace(/^.*github\.com[:/]/, '')
      .replace(/^.*gitlab\.com[:/]/, '')
      .replace(/^.*bitbucket\.org[:/]/, '')
      .replace(/\.git$/, '');
    const parts = cleaned.split('/');
    const org = parts[0] || 'local';
    const repo = parts[1] || org;
    return { org, repo };
  } catch {
    return null;
  }
}

function copyIfMissing(src, dst) {
  if (!fs.existsSync(dst) && fs.existsSync(src)) {
    fs.copyFileSync(src, dst);
  }
}

function writeIfMissing(filePath, content) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, content);
  }
}

function buildIndex(label) {
  return [
    `# Wiki index: ${label}`,
    '',
    '## Repositories',
    '',
    '## Patterns',
  ].join('\n');
}

function buildLog(label) {
  return `# Wiki log: ${label}`;
}

function seedLegacyWiki(repoDir, repoRawDir) {
  const legacyWiki = path.join(repoDir, 'wiki.md');
  const rawLegacy = path.join(repoRawDir, 'legacy-wiki.md');
  if (fs.existsSync(legacyWiki) && !fs.existsSync(rawLegacy)) {
    fs.copyFileSync(legacyWiki, rawLegacy);
  }
}

function directoryHasContent(dirPath) {
  try {
    return fs.readdirSync(dirPath).length > 0;
  } catch {
    return false;
  }
}

function copyDirectoryContents(srcDir, dstDir) {
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(dstPath, { recursive: true });
      copyDirectoryContents(srcPath, dstPath);
      continue;
    }
    if (!fs.existsSync(dstPath)) {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

function migrateLegacyWiki(repoDir, repoWikiDir) {
  const legacyWikiDir = path.join(repoDir, 'wiki');
  if (!fs.existsSync(legacyWikiDir) || !fs.statSync(legacyWikiDir).isDirectory()) {
    return;
  }
  if (directoryHasContent(repoWikiDir)) {
    return;
  }
  copyDirectoryContents(legacyWikiDir, repoWikiDir);
}

function ensureGlobalKnowledgeRoot() {
  fs.mkdirSync(path.join(VIRTUCON_HQ, 'raw'), { recursive: true });
  fs.mkdirSync(path.join(VIRTUCON_HQ, 'wiki', 'orgs'), { recursive: true });
  fs.mkdirSync(path.join(VIRTUCON_HQ, 'wiki', 'patterns'), { recursive: true });
  copyIfMissing(path.join(PLUGIN_ROOT, 'assets', '.agent', 'wiki', 'schema.md'), path.join(VIRTUCON_HQ, 'schema.md'));
  writeIfMissing(path.join(VIRTUCON_HQ, 'wiki', 'index.md'), buildIndex('global'));
  writeIfMissing(path.join(VIRTUCON_HQ, 'wiki', 'log.md'), buildLog('global'));
}

function ensureBootstrap(orgRepo) {
  fs.mkdirSync(VIRTUCON_HQ, { recursive: true });
  copyIfMissing(path.join(PLUGIN_ROOT, 'assets', '.agent', 'wiki', '_TEMPLATE.md'), path.join(VIRTUCON_HQ, '_TEMPLATE.md'));
  ensureGlobalKnowledgeRoot();

  if (!orgRepo) {
    return;
  }

  const repoDir = path.join(VIRTUCON_HQ, orgRepo.org, `_${orgRepo.repo}`);
  const repoRawDir = path.join(VIRTUCON_HQ, 'raw', orgRepo.org, orgRepo.repo);
  const repoWikiDir = path.join(VIRTUCON_HQ, 'wiki', 'orgs', orgRepo.org, orgRepo.repo);

  fs.mkdirSync(path.join(repoDir, 'blueprints'), { recursive: true });
  fs.mkdirSync(repoRawDir, { recursive: true });
  fs.mkdirSync(repoWikiDir, { recursive: true });

  seedLegacyWiki(repoDir, repoRawDir);
  migrateLegacyWiki(repoDir, repoWikiDir);
}

function buildNudge(orgRepo) {
  const org = orgRepo ? orgRepo.org : '<org>';
  const repo = orgRepo ? orgRepo.repo : '<repo>';
  const tool = (...parts) => `node ${path.join(PLUGIN_ROOT, 'skills', ...parts)}`;

  return [
    '<minime-workflow-nudge>',
    'minime paths (use these, do not hardcode):',
    `  VIRTUCON_HQ=${VIRTUCON_HQ}`,
    `  Blueprints: ${VIRTUCON_HQ}/${org}/_${repo}/blueprints/`,
    `  Orchestration guide: ${path.join(PLUGIN_ROOT, 'assets', 'ORCHESTRATION.md')}`,
    `  Blueprint tool: ${tool('blueprint', 'scripts', 'blueprint.mjs')}`,
    `  Wiki lint tool: ${tool('extract', 'scripts', 'wiki-lint.mjs')}`,
    `  Wiki schema: ${VIRTUCON_HQ}/schema.md`,
    `  Repo wiki index: ${VIRTUCON_HQ}/wiki/orgs/${org}/${repo}/index.md`,
    `  Wiki index: ${VIRTUCON_HQ}/wiki/index.md`,
    `  Repo raw: ${VIRTUCON_HQ}/raw/${org}/${repo}/`,
    `  Topic template: ${VIRTUCON_HQ}/_TEMPLATE.md`,
    'Full flow: run the minime:dr-evil agent. Phase skills work standalone and return to their caller.',
    '</minime-workflow-nudge>',
  ].join('\n');
}

async function main() {
  // The host reports the session's working directory on stdin; the hook's own cwd can differ (-C, plugin dir, IDE launch).
  const input = await readHookInput();
  const cwd = typeof input.cwd === 'string' && fs.existsSync(input.cwd) ? input.cwd : process.cwd();
  const orgRepo = deriveOrgRepo(cwd);
  try {
    ensureBootstrap(orgRepo);
  } catch {
    // non-fatal
  }

  const nudge = buildNudge(orgRepo);
  const output = {
    additionalContext: nudge,
    additional_context: nudge,
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: nudge,
    },
  };

  process.stdout.write(JSON.stringify(output, null, 2) + '\n', () => process.exit(0));
}

main().catch(() => process.exit(0));
