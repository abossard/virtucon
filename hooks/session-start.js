#!/usr/bin/env node
// SessionStart hook for minime plugin.
// Injects a nudge + canonical paths into the session context so the agent
// knows minime skills are available and where state lives.
// Must NEVER fail. Always exits 0 with valid JSON.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = process.env.PLUGIN_ROOT
  || process.env.CLAUDE_PLUGIN_ROOT
  || process.env.CLAUDE_SKILL_DIR && path.resolve(process.env.CLAUDE_SKILL_DIR, '..', '..')
  || path.resolve(__dirname, '..');
const MINIME_HOME = process.env.MINIME_HOME || path.join(process.env.HOME || '~', '.minime');

function buildNudge() {
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

  return [
    '<minime-workflow-nudge>',
    'You have **minime** orchestration skills installed.',
    '',
    '**Minime paths (single source of truth. Do not hardcode; use these):**',
    `  MINIME_HOME=${MINIME_HOME}`,
    `  Templates: ${MINIME_HOME}/templates/`,
    `  Tasks:     ${MINIME_HOME}/<org>/_<repo>/tasks/`,
    `  Repo wiki: ${MINIME_HOME}/<org>/_<repo>/wiki.md`,
    `  Org wiki:  ${MINIME_HOME}/<org>/wiki.md`,
    `  Template:  ${MINIME_HOME}/_TEMPLATE.md`,
    '',
    'Available skills:',
    skillList,
    '',
    'Usage guidance:',
    '- For non-trivial tasks, invoke skill("plan") BEFORE starting implementation.',
    '- After implementation, invoke skill("review") to get an evidence-based review.',
    '- After merge or session end, invoke skill("harvest") to capture lessons.',
    '- For the full autopilot flow, use the minime:director agent.',
    '- plan accepts inline task descriptions. No task.md file is required.',
    '',
    'Skill chaining: plan -> implement -> review -> harvest.',
    'Each skill will tell you which skill to invoke next.',
    '</minime-workflow-nudge>',
  ].join('\n');
}

function ensureDashboardSymlink() {
  // Symlink the minime dashboard as `copilot-dashboard` so it takes over
  // the generic dashboard's tool names (copilot_dashboard_show/eval/close)
  // and the /dashboard slash command.
  const userExtDir = path.join(process.env.HOME || '~', '.copilot', 'extensions');
  const linkPath = path.join(userExtDir, 'copilot-dashboard');
  const target = path.join(PLUGIN_ROOT, 'skills', 'dashboard', 'template');
  const sentinel = path.join(target, 'lib', 'minime-data.mjs');

  try {
    // Verify target exists AND contains our sentinel file
    if (!fs.existsSync(target) || !fs.existsSync(sentinel)) return;

    // Ensure ~/.copilot/extensions/ exists
    fs.mkdirSync(userExtDir, { recursive: true });

    // Clean up old minime-dashboard symlink if present
    const oldLink = path.join(userExtDir, 'minime-dashboard');
    try {
      const oldTarget = fs.readlinkSync(oldLink);
      if (oldTarget === target) fs.unlinkSync(oldLink);
    } catch { /* doesn't exist or not a symlink */ }

    try {
      const existing = fs.readlinkSync(linkPath);
      if (existing === target) return; // already correct
      // Points elsewhere — replace it (we're taking over copilot-dashboard)
      fs.unlinkSync(linkPath);
    } catch {
      // readlinkSync throws if linkPath doesn't exist or isn't a symlink
      if (fs.existsSync(linkPath)) {
        // Regular dir/file — rename it out of the way
        const backup = linkPath + '.backup-' + Date.now();
        fs.renameSync(linkPath, backup);
        process.stderr.write(`[minime] Backed up existing ${linkPath} to ${backup}\n`);
      }
    }

    fs.symlinkSync(target, linkPath, 'dir');
  } catch {
    // Non-fatal — dashboard just won't auto-register
  }
}

function main() {
  ensureDashboardSymlink();

  const nudge = buildNudge();

  // Output format varies by platform:
  // - Copilot CLI: reads `additionalContext` at top level
  // - Claude Code: reads `hookSpecificOutput.additionalContext`
  // - Cursor: reads `additional_context`
  // - VS Code Copilot: reads `additionalContext` at top level
  // We emit all formats so the nudge works everywhere.
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
