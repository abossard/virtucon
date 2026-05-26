#!/usr/bin/env node
// SessionStart hook for minime plugin.
// Injects a nudge + canonical paths into the session context so the agent
// knows minime skills are available and where state lives.
// Auto-bootstraps VIRTUCON_HQ if paths are missing (absorbs lab skill).
// Must NEVER fail. Always exits 0 with valid JSON.

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

function ensureBootstrap(orgRepo) {
  const assets = path.join(PLUGIN_ROOT, 'assets');
  const templateDir = path.join(VIRTUCON_HQ, 'templates');
  fs.mkdirSync(templateDir, { recursive: true });

  const copyIfMissing = (src, dst) => {
    if (!fs.existsSync(dst) && fs.existsSync(src)) {
      fs.copyFileSync(src, dst);
    }
  };

  copyIfMissing(path.join(assets, 'blueprint.template.md'), path.join(templateDir, 'blueprint.template.md'));
  copyIfMissing(path.join(assets, '.agent', 'wiki', '_TEMPLATE.md'), path.join(VIRTUCON_HQ, '_TEMPLATE.md'));

  if (orgRepo) {
    const repoDir = path.join(VIRTUCON_HQ, orgRepo.org, `_${orgRepo.repo}`, 'blueprints');
    fs.mkdirSync(repoDir, { recursive: true });
    const repoWiki = path.join(VIRTUCON_HQ, orgRepo.org, `_${orgRepo.repo}`, 'wiki.md');
    const orgWiki = path.join(VIRTUCON_HQ, orgRepo.org, 'wiki.md');
    copyIfMissing(path.join(assets, '.agent', 'wiki', '_TEMPLATE.md'), repoWiki);
    if (!fs.existsSync(orgWiki)) {
      fs.writeFileSync(orgWiki, `# Wiki: ${orgRepo.org} (org-level)\n\nShared cross-repo lessons for org "${orgRepo.org}".\n`);
    }
  }
}

function buildNudge(orgRepo) {
  const skills = [];
  const skillsDir = path.join(PLUGIN_ROOT, 'skills');
  try {
    for (const d of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (d.isDirectory()) {
        const skillFile = path.join(skillsDir, d.name, 'SKILL.md');
        if (fs.existsSync(skillFile)) {
          const content = fs.readFileSync(skillFile, 'utf8');
          const descMatch = content.match(/^description:\s*(.+)$/m);
          skills.push({
            name: d.name,
            desc: descMatch ? descMatch[1].trim() : '',
          });
        }
      }
    }
  } catch {
    // non-fatal
  }

  const skillList = skills
    .map((s) => `  - **minime:${s.name}**: ${s.desc}`)
    .join('\n');

  const org = orgRepo ? orgRepo.org : '<org>';
  const repo = orgRepo ? orgRepo.repo : '<repo>';

  return [
    '<minime-workflow-nudge>',
    'You have **minime** orchestration skills installed.',
    '',
    '**Minime paths (single source of truth. Do not hardcode; use these):**',
    `  VIRTUCON_HQ=${VIRTUCON_HQ}`,
    `  Templates: ${VIRTUCON_HQ}/templates/`,
    `  Blueprints: ${VIRTUCON_HQ}/${org}/_${repo}/blueprints/`,
    `  Repo wiki: ${VIRTUCON_HQ}/${org}/_${repo}/wiki.md`,
    `  Org wiki:  ${VIRTUCON_HQ}/${org}/wiki.md`,
    `  Template:  ${VIRTUCON_HQ}/_TEMPLATE.md`,
    '',
    'Available skills:',
    skillList,
    '',
    'Usage guidance:',
    '- For non-trivial tasks, invoke skill("blueprint") BEFORE starting implementation.',
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
  // Auto-bootstrap VIRTUCON_HQ if needed
  const orgRepo = deriveOrgRepo();
  try {
    ensureBootstrap(orgRepo);
  } catch {
    // non-fatal: bootstrap failure should never block session start
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
