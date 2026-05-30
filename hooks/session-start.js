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

function deriveOrgRepo() {
  try {
    const origin = execSync('git remote get-url origin 2>/dev/null', { encoding: 'utf8' }).trim();
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

function buildSchema(label) {
  return [
    `# Wiki schema: ${label}`,
    '',
    'This root uses three layers:',
    '- `raw/` for immutable source documents.',
    '- `wiki/` for linked markdown pages derived from those sources.',
    '- `schema.md` for the conventions that govern the wiki.',
    '',
    'Allowed raw documents include curated findings, distilled results, user messages, general knowledge, and hard-won discoveries.',
    'Do not store logs or large outputs in `raw/`.',
  ].join('\n');
}

function buildIndex(label) {
  return [
    `# Wiki index: ${label}`,
    '',
    'Use this page as the catalog of topic pages and their backing raw sources.',
    '',
    '## Core pages',
    '- [Wiki log](./log.md)',
  ].join('\n');
}

function buildLog(label) {
  return [
    `# Wiki log: ${label}`,
    '',
    'Record compact dated ingest, query, and lint updates here.',
  ].join('\n');
}

function seedLegacyWiki(rootDir) {
  const legacyWiki = path.join(rootDir, 'wiki.md');
  const rawLegacy = path.join(rootDir, 'raw', 'legacy-wiki.md');
  if (fs.existsSync(legacyWiki) && !fs.existsSync(rawLegacy)) {
    fs.copyFileSync(legacyWiki, rawLegacy);
  }
}

function ensureKnowledgeRoot(rootDir, label) {
  fs.mkdirSync(path.join(rootDir, 'raw'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'wiki'), { recursive: true });
  writeIfMissing(path.join(rootDir, 'schema.md'), buildSchema(label));
  writeIfMissing(path.join(rootDir, 'wiki', 'index.md'), buildIndex(label));
  writeIfMissing(path.join(rootDir, 'wiki', 'log.md'), buildLog(label));
  seedLegacyWiki(rootDir);
}

function ensureBootstrap(orgRepo) {
  const assets = path.join(PLUGIN_ROOT, 'assets');
  const templateDir = path.join(VIRTUCON_HQ, 'templates');
  fs.mkdirSync(templateDir, { recursive: true });

  copyIfMissing(path.join(assets, 'blueprint.template.md'), path.join(templateDir, 'blueprint.template.md'));
  copyIfMissing(path.join(assets, '.agent', 'wiki', '_TEMPLATE.md'), path.join(VIRTUCON_HQ, '_TEMPLATE.md'));

  if (!orgRepo) {
    return;
  }

  const orgDir = path.join(VIRTUCON_HQ, orgRepo.org);
  const repoDir = path.join(orgDir, `_${orgRepo.repo}`);
  fs.mkdirSync(path.join(repoDir, 'blueprints'), { recursive: true });
  ensureKnowledgeRoot(orgDir, orgRepo.org);
  ensureKnowledgeRoot(repoDir, `${orgRepo.org}/${orgRepo.repo}`);
}

function buildNudge(orgRepo) {
  const skills = [];
  const skillsDir = path.join(PLUGIN_ROOT, 'skills');
  try {
    for (const d of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const skillFile = path.join(skillsDir, d.name, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;
      const content = fs.readFileSync(skillFile, 'utf8');
      const descMatch = content.match(/^description:\s*(.+)$/m);
      skills.push({
        name: d.name,
        desc: descMatch ? descMatch[1].trim() : '',
      });
    }
  } catch {
    // non-fatal
  }

  const skillList = skills
    .map((s) => `  - **minime:${s.name}**: ${s.desc}`)
    .join('\n');

  const org = orgRepo ? orgRepo.org : '<org>';
  const repo = orgRepo ? orgRepo.repo : '<repo>';
  const repoRoot = `${VIRTUCON_HQ}/${org}/_${repo}`;
  const orgRoot = `${VIRTUCON_HQ}/${org}`;

  return [
    '<minime-workflow-nudge>',
    'You have **minime** orchestration skills installed.',
    '',
    '**Minime paths (single source of truth. Do not hardcode; use these):**',
    `  VIRTUCON_HQ=${VIRTUCON_HQ}`,
    `  Templates: ${VIRTUCON_HQ}/templates/`,
    `  Blueprints: ${repoRoot}/blueprints/`,
    `  Repo raw: ${repoRoot}/raw/`,
    `  Repo wiki: ${repoRoot}/wiki/`,
    `  Repo schema: ${repoRoot}/schema.md`,
    `  Org raw: ${orgRoot}/raw/`,
    `  Org wiki: ${orgRoot}/wiki/`,
    `  Org schema: ${orgRoot}/schema.md`,
    `  Template: ${VIRTUCON_HQ}/_TEMPLATE.md`,
    '',
    'Available skills:',
    skillList,
    '',
    'Usage guidance:',
    '- For non-trivial tasks, invoke skill("blueprint") before starting implementation.',
    '- After implementation, invoke skill("inspect") to get an evidence-based review.',
    '- After merge or session end, invoke skill("extract") to capture lessons.',
    '- For the full autopilot flow, use the minime:dr-evil agent.',
    '- blueprint accepts inline context. No separate task file is required.',
    '',
    'Skill chaining: blueprint -> replicate -> inspect -> extract.',
    'Each skill will tell you which skill to invoke next.',
    '</minime-workflow-nudge>',
  ].join('\n');
}

function main() {
  const orgRepo = deriveOrgRepo();
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

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

main();
