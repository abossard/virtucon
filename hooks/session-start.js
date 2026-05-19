#!/usr/bin/env node
// SessionStart hook for minime plugin.
// Injects a nudge into the session context so the agent knows minime skills
// are available and should be used for non-trivial tasks.
// Must NEVER fail — always exits 0 with valid JSON.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, '..');

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
    .map((s) => `  - **minime:${s.name}** — ${s.desc}`)
    .join('\n');

  return [
    '<minime-workflow-nudge>',
    'You have **minime** orchestration skills installed.',
    '',
    'Available skills:',
    skillList,
    '',
    'Usage guidance:',
    '- For non-trivial tasks, invoke skill("plan") BEFORE starting implementation.',
    '- After implementation, invoke skill("review") to get an evidence-based review.',
    '- After merge or session end, invoke skill("harvest") to capture lessons.',
    '- For the full autopilot flow, use the minime:director agent.',
    '- plan accepts inline task descriptions — no task.md file required.',
    '',
    'Skill chaining: plan → implement → review → harvest.',
    'Each skill will tell you which skill to invoke next.',
    '</minime-workflow-nudge>',
  ].join('\n');
}

function main() {
  const nudge = buildNudge();
  const output = {};

  if (process.env.CURSOR_PLUGIN_ROOT) {
    output.additional_context = nudge;
  } else if (process.env.CLAUDE_PLUGIN_ROOT && !process.env.COPILOT_CLI) {
    output.hookSpecificOutput = {
      hookEventName: 'SessionStart',
      additionalContext: nudge,
    };
  } else {
    output.additionalContext = nudge;
  }

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

main();
