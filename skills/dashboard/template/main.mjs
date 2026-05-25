// main.mjs — Minime Dashboard extension entry point
// Registers callbacks, tools, slash command, and hooks with the Copilot CLI session.
//
// Provenance: built on the copilot-webview-creator pattern by Steve Sanderson
// (commit d71e09015be3f1f0c93f9f7665f5b7d51a800d00)

import { joinSession } from "@github/copilot-sdk/extension";
import { join } from "node:path";
import { spawn, execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { platform } from "node:os";
import { CopilotWebview } from "./lib/copilot-webview.js";
import {
  resolveMinimeHome, scanMinimeHome, findLatestTask,
  loadDashboardConfig, discoverProjectActions, getStatusIcon,
  validateUrl, validateClearPaths, createRingBuffer, mergeActions,
  scanSessions,
} from "./lib/minime-data.mjs";

const CWD = process.cwd();
const MINIME_HOME = resolveMinimeHome();
const OUTPUT_CAP = 65536; // 64KB ring buffer per process

function enrichTask(task) {
  return { ...task, statusIcon: getStatusIcon(task.status) };
}

// ── Background process manager ───────────────────────────────────────

const backgroundProcesses = new Map(); // id -> { name, child, output, exitCode }

function startBackgroundProcess(id, cmd, args, cwd) {
  const output = createRingBuffer(OUTPUT_CAP);
  const child = spawn(cmd, args, {
    cwd,
    shell: false,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const entry = { name: id, child, output, pid: child.pid, exitCode: null, startTime: Date.now() };

  child.stdout.on('data', (d) => output.append(d.toString()));
  child.stderr.on('data', (d) => output.append(d.toString()));
  child.on('close', (code) => { entry.exitCode = code; });
  child.on('error', (err) => { output.append(`\nERROR: ${err.message}\n`); entry.exitCode = -1; });
  child.unref();

  backgroundProcesses.set(id, entry);
  return { success: true, pid: child.pid, id };
}

function stopBackgroundProcess(id) {
  const entry = backgroundProcesses.get(id);
  if (!entry) return { success: false, error: `No process "${id}"` };
  if (entry.exitCode !== null) return { success: true, alreadyExited: true, exitCode: entry.exitCode };

  try {
    process.kill(-entry.child.pid, 'SIGTERM');
  } catch {
    try { entry.child.kill('SIGTERM'); } catch { /* best effort */ }
  }
  return { success: true };
}

function getBackgroundProcesses() {
  return Array.from(backgroundProcesses.entries()).map(([id, e]) => ({
    id, pid: e.pid, exitCode: e.exitCode, running: e.exitCode === null,
    outputTail: e.output.value.slice(-2048),
    startTime: e.startTime,
  }));
}

function getProcessOutput(id) {
  const entry = backgroundProcesses.get(id);
  if (!entry) return { error: `No process "${id}"` };
  return { output: entry.output.value, exitCode: entry.exitCode, running: entry.exitCode === null };
}

function cleanupAllProcesses() {
  for (const [, entry] of backgroundProcesses) {
    if (entry.exitCode === null) {
      try { process.kill(-entry.child.pid, 'SIGTERM'); } catch {
        try { entry.child.kill('SIGTERM'); } catch { /* best effort */ }
      }
    }
  }
  backgroundProcesses.clear();
}

// ── Action resolvers ─────────────────────────────────────────────────

function resolveProjectDir(config) {
  return config.checkoutPath || CWD;
}

function mergeProjectActions(config, projectDir) {
  const discovered = discoverProjectActions(projectDir);
  return mergeActions(config, discovered);
}

// ── Callbacks: functions the page can call via copilot.<method>(...) ──

function getProjects() {
  const orgs = scanMinimeHome(MINIME_HOME);
  return orgs.flatMap(org =>
    org.repos.map(repo => ({
      org: org.name,
      repo: repo.name,
      taskCount: repo.tasks.length,
      wikiCount: repo.wikiEntries.length,
      path: repo.path,
    }))
  );
}

function getProjectData(org, repo) {
  const orgs = scanMinimeHome(MINIME_HOME);
  const orgData = orgs.find(o => o.name === org);
  if (!orgData) return { tasks: [], wikiEntries: [], actions: [], config: null };

  const repoData = orgData.repos.find(r => r.name === repo);
  if (!repoData) return { tasks: [], wikiEntries: [], actions: [], config: null };

  const config = loadDashboardConfig(MINIME_HOME, org, repo);
  const projectDir = resolveProjectDir(config);
  const actions = mergeProjectActions(config, projectDir);

  return {
    tasks: repoData.tasks.map(enrichTask),
    wikiEntries: repoData.wikiEntries,
    actions,
    config,
  };
}

function getAllData() {
  const orgs = scanMinimeHome(MINIME_HOME);
  const allTasks = orgs.flatMap(o => o.repos.flatMap(r =>
    r.tasks.map(t => enrichTask({ ...t, org: o.name, repo: r.name }))
  ));
  const allWiki = orgs.flatMap(o => o.repos.flatMap(r =>
    r.wikiEntries.map(e => ({ ...e, org: o.name, repo: r.name }))
  ));
  const latest = findLatestTask(orgs);
  return { tasks: allTasks, wikiEntries: allWiki, latestTask: latest };
}

function getProjectActions(org, repo) {
  const config = loadDashboardConfig(MINIME_HOME, org, repo);
  const projectDir = resolveProjectDir(config);
  return mergeProjectActions(config, projectDir);
}

async function runAction(org, repo, actionName) {
  const config = loadDashboardConfig(MINIME_HOME, org, repo);

  if (!config.allowedActions.includes(actionName)) {
    return { success: false, error: `Action "${actionName}" is not in the allowedActions list. Add it to dashboard.json to enable execution.` };
  }

  const projectDir = resolveProjectDir(config);
  const allActions = mergeProjectActions(config, projectDir);
  const action = allActions.find(a => a.name === actionName);

  if (!action) {
    return { success: false, error: `Action "${actionName}" not found.` };
  }

  switch (action.type) {
    case 'url': return runUrlAction(action);
    case 'clear': return runClearAction(action, projectDir);
    case 'command': return runCommandAction(action, projectDir);
    case 'script': return runScriptAction(action, projectDir);
    default: return { success: false, error: `Unknown action type: ${action.type}` };
  }
}

function runUrlAction(action) {
  if (!validateUrl(action.url)) {
    return { success: false, error: `Invalid or disallowed URL: ${action.url}. Only http/https allowed.` };
  }

  const opener = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'cmd' : 'xdg-open';
  const openerArgs = platform() === 'win32' ? ['/c', 'start', '', action.url] : [action.url];

  return new Promise((resolve) => {
    execFile(opener, openerArgs, { timeout: 10_000 }, (err) => {
      if (err) resolve({ success: false, error: err.message });
      else resolve({ success: true, message: `Opened ${action.url}` });
    });
  });
}

async function runClearAction(action, projectDir) {
  const validation = validateClearPaths(action.paths, projectDir);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const results = [];
  for (const resolvedPath of validation.resolvedPaths) {
    try {
      await rm(resolvedPath, { recursive: true, force: true });
      results.push({ path: resolvedPath, deleted: true });
    } catch (err) {
      results.push({ path: resolvedPath, deleted: false, error: err.message });
    }
  }

  const allOk = results.every(r => r.deleted);
  return { success: allOk, results };
}

function runCommandAction(action, projectDir) {
  const [cmd, ...args] = action.command;

  if (action.background) {
    const id = `${action.name}-${Date.now()}`;
    return startBackgroundProcess(id, cmd, args, projectDir);
  }

  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: projectDir,
      shell: false,
      timeout: 60_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      const maxLen = 4096;
      resolve({ success: code === 0, exitCode: code, stdout: stdout.slice(0, maxLen), stderr: stderr.slice(0, maxLen) });
    });
    child.on('error', (err) => { resolve({ success: false, error: err.message }); });
  });
}

function runScriptAction(action, projectDir) {
  // Determine if npm or make based on source
  let cmd, args;
  if (action.source === 'Makefile') {
    cmd = 'make';
    args = [action.script || action.name];
  } else {
    cmd = 'npm';
    args = ['run', action.script || action.name];
  }

  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: projectDir,
      shell: false,
      timeout: 60_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      const maxLen = 4096;
      resolve({ success: code === 0, exitCode: code, stdout: stdout.slice(0, maxLen), stderr: stderr.slice(0, maxLen) });
    });
    child.on('error', (err) => { resolve({ success: false, error: err.message }); });
  });
}

function getOnboardingInfo() {
  return {
    minimeHome: MINIME_HOME,
    cwd: CWD,
    message: 'No minime data found. Run /minime:init-orchestration to set up this project.',
  };
}

const SESSION_STATE_DIR = join(process.env.HOME || process.env.USERPROFILE || '', '.copilot', 'session-state');

function getSessions({ limit, repo } = {}) {
  return scanSessions(SESSION_STATE_DIR, { limit: limit || 50, repo: repo || null });
}

// ── Webview setup ──

const webview = new CopilotWebview({
  extensionName: "copilot_dashboard",
  contentDir: join(import.meta.dirname, "content"),
  title: "Minime Dashboard",
  width: 1100,
  height: 750,
  callbacks: {
    getProjects,
    getProjectData,
    getAllData,
    getProjectActions,
    runAction,
    getOnboardingInfo,
    getSessions,
    getBackgroundProcesses,
    getProcessOutput,
    stopProcess: stopBackgroundProcess,
    log: (msg, opts) => session.log(msg, opts),
  },
});

const session = await joinSession({
  tools: webview.tools,
  commands: [{
    name: "dashboard",
    description: "Open the Minime Dashboard — view tasks, wiki, sessions, and project actions",
    handler: webview.show,
  }],
  hooks: {
    onSessionEnd: () => {
      cleanupAllProcesses();
      webview.close();
    },
  },
});
