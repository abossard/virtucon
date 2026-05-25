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
const VIRTUCON_HQ = process.env.VIRTUCON_HQ || path.join(process.env.HOME || '~', '.minime');

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
    `  VIRTUCON_HQ=${VIRTUCON_HQ}`,
    `  Templates: ${VIRTUCON_HQ}/templates/`,
    `  Tasks:     ${VIRTUCON_HQ}/<org>/_<repo>/tasks/`,
    `  Repo wiki: ${VIRTUCON_HQ}/<org>/_<repo>/wiki.md`,
    `  Org wiki:  ${VIRTUCON_HQ}/<org>/wiki.md`,
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
    '- plan accepts inline task descriptions. No task.md file is required.',
    '',
    'Skill chaining: plan -> implement -> review -> harvest.',
    'Each skill will tell you which skill to invoke next.',
    '</minime-workflow-nudge>',
  ].join('\n');
}

function main() {
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
