import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { MinimeOrg, MinimeRepo, MinimeTask, WikiEntry } from '../models/types';
import { parseTaskFile } from '../parsers/taskParser';
import { parseWikiFile, parseWikiPageFile } from '../parsers/wikiParser';

export interface MinimeConfig {
  settingHome?: string;
}

export function resolveMinimeHome(config?: MinimeConfig): string {
  if (config?.settingHome) {
    return config.settingHome;
  }
  if (process.env.VIRTUCON_HQ) {
    return process.env.VIRTUCON_HQ;
  }
  return path.join(os.homedir(), '.minime');
}

export function scanMinimeHome(minimeHome: string): MinimeOrg[] {
  if (!fs.existsSync(minimeHome)) {
    return [];
  }

  const orgMap = new Map<string, MinimeOrg>();

  scanNewConvention(minimeHome, orgMap);
  scanLegacyTasks(minimeHome, orgMap);
  scanLegacyWikis(minimeHome, orgMap);

  return Array.from(orgMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function getOrCreateOrg(orgMap: Map<string, MinimeOrg>, orgName: string, orgPath: string): MinimeOrg {
  let org = orgMap.get(orgName);
  if (!org) {
    org = { name: orgName, path: orgPath, repos: [] };
    orgMap.set(orgName, org);
  }
  return org;
}

function getOrCreateRepo(org: MinimeOrg, repoName: string, repoPath: string): MinimeRepo {
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

/**
 * Scan new convention: <org>/_<repo>/blueprints/ (and legacy tasks/) plus wiki/ directories.
 */
function scanNewConvention(minimeHome: string, orgMap: Map<string, MinimeOrg>): void {
  const entries = safeReaddir(minimeHome);

  for (const entry of entries) {
    const orgPath = path.join(minimeHome, entry);
    if (!isDirectory(orgPath) || isSpecialDir(entry)) continue;

    const orgName = entry;
    const orgEntries = safeReaddir(orgPath);

    const orgWiki = scanWikiLocation(orgPath);

    for (const repoEntry of orgEntries) {
      if (!repoEntry.startsWith('_')) continue;
      const repoPath = path.join(orgPath, repoEntry);
      if (!isDirectory(repoPath)) continue;

      const repoName = repoEntry.slice(1); // remove leading _
      const org = getOrCreateOrg(orgMap, orgName, orgPath);
      const repo = getOrCreateRepo(org, repoName, repoPath);

      // Scan blueprints (new convention) and tasks (backward compat)
      for (const dirName of ['blueprints', 'tasks']) {
        const bpDir = path.join(repoPath, dirName);
        if (isDirectory(bpDir)) {
          const bpFiles = safeReaddir(bpDir).filter(f => f.endsWith('.md'));
          for (const bpFile of bpFiles) {
            const bpPath = path.join(bpDir, bpFile);
            const task = parseTaskFile(bpPath);
            if (task && !repo.tasks.find(t => t.shortName === task.shortName)) {
              repo.tasks.push(task);
            }
          }
        }
      }

      const wiki = scanWikiLocation(repoPath);
      if (wiki) {
        repo.wikiPath = wiki.wikiPath;
        repo.wikiEntries = wiki.entries;
      }
    }

    if (orgWiki) {
      const org = getOrCreateOrg(orgMap, orgName, orgPath);
      const orgWikiRepo = getOrCreateRepo(org, '(org wiki)', orgPath);
      orgWikiRepo.wikiPath = orgWiki.wikiPath;
      orgWikiRepo.wikiEntries = orgWiki.entries;
    }
  }
}

/**
 * Scan legacy: tasks/<org>__<repo>/*.task.md
 */
function scanLegacyTasks(minimeHome: string, orgMap: Map<string, MinimeOrg>): void {
  const tasksDir = path.join(minimeHome, 'tasks');
  if (!isDirectory(tasksDir)) return;

  const entries = safeReaddir(tasksDir);
  for (const entry of entries) {
    const parts = entry.split('__');
    if (parts.length !== 2) continue;

    const [orgName, repoName] = parts;
    const repoTasksDir = path.join(tasksDir, entry);
    if (!isDirectory(repoTasksDir)) continue;

    const org = getOrCreateOrg(orgMap, orgName, path.join(minimeHome, orgName));
    const repo = getOrCreateRepo(org, repoName, repoTasksDir);

    const taskFiles = safeReaddir(repoTasksDir).filter(f => f.endsWith('.md'));
    for (const taskFile of taskFiles) {
      const taskPath = path.join(repoTasksDir, taskFile);
      const task = parseTaskFile(taskPath);
      if (task && !repo.tasks.find(t => t.shortName === task.shortName)) {
        repo.tasks.push(task);
      }
    }
  }
}

/**
 * Scan legacy: wiki/repos/<org>__<repo>.md
 */
function scanLegacyWikis(minimeHome: string, orgMap: Map<string, MinimeOrg>): void {
  const wikiDir = path.join(minimeHome, 'wiki', 'repos');
  if (!isDirectory(wikiDir)) return;

  const entries = safeReaddir(wikiDir).filter(f => f.endsWith('.md'));
  for (const entry of entries) {
    const baseName = entry.replace(/\.md$/, '');
    const parts = baseName.split('__');
    if (parts.length !== 2) continue;

    const [orgName, repoName] = parts;
    const wikiPath = path.join(wikiDir, entry);

    const org = getOrCreateOrg(orgMap, orgName, path.join(minimeHome, orgName));
    const repo = getOrCreateRepo(org, repoName, path.join(minimeHome, orgName));

    if (!repo.wikiPath) {
      repo.wikiPath = wikiPath;
      repo.wikiEntries = parseWikiFile(wikiPath);
    }
  }
}

export function getTemplatePaths(minimeHome: string): string[] {
  const templatesDir = path.join(minimeHome, 'templates');
  if (!isDirectory(templatesDir)) return [];
  return safeReaddir(templatesDir)
    .filter(f => f.endsWith('.md'))
    .map(f => path.join(templatesDir, f));
}

export function findLatestTask(orgs: MinimeOrg[]): MinimeTask | undefined {
  const allTasks = orgs.flatMap(o => o.repos.flatMap(r => r.tasks));
  if (allTasks.length === 0) return undefined;
  return allTasks.sort((a, b) => b.date.localeCompare(a.date))[0];
}

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter(e => !e.startsWith('.'));
  } catch {
    return [];
  }
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function scanWikiLocation(basePath: string): { wikiPath: string; entries: WikiEntry[] } | undefined {
  const wikiDir = path.join(basePath, 'wiki');
  if (isDirectory(wikiDir)) {
    const entries = safeReaddir(wikiDir)
      .filter(file => file.endsWith('.md'))
      .map(file => parseWikiPageFile(path.join(wikiDir, file)))
      .filter((entry): entry is WikiEntry => Boolean(entry));
    return { wikiPath: wikiDir, entries };
  }

  const wikiFile = path.join(basePath, 'wiki.md');
  if (fs.existsSync(wikiFile)) {
    return { wikiPath: wikiFile, entries: parseWikiFile(wikiFile) };
  }

  return undefined;
}

function isSpecialDir(name: string): boolean {
  return ['templates', 'tasks', 'blueprints', 'wiki'].includes(name);
}
