import * as vscode from 'vscode';
import * as path from 'path';
import { MinimeOrg, MinimeRepo, MinimeTask, WikiEntry, TreeNodeType } from '../models/types';
import { scanMinimeHome, getTemplatePaths, resolveMinimeHome } from '../utils/paths';
import { getStatusIcon } from '../parsers/taskParser';
import { sortTasks, sortWikiEntries, sortRepos, sortOrgs } from '../utils/sorting';

interface TreeNodeData {
  type: TreeNodeType;
  label: string;
  filePath?: string;
  lineNumber?: number;
  org?: MinimeOrg;
  repo?: MinimeRepo;
  task?: MinimeTask;
  wikiEntry?: WikiEntry;
}

export class MinimeTreeProvider implements vscode.TreeDataProvider<TreeNodeData> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNodeData | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private orgs: MinimeOrg[] = [];
  private templatePaths: string[] = [];
  private minimeHome = '';

  constructor() {
    this.reload();
  }

  refresh(): void {
    this.reload();
    this._onDidChangeTreeData.fire(undefined);
  }

  private reload(): void {
    const config = vscode.workspace.getConfiguration('minime');
    const settingHome = config.get<string>('home') || undefined;
    this.minimeHome = resolveMinimeHome({ settingHome });
    this.orgs = scanMinimeHome(this.minimeHome);
    this.templatePaths = getTemplatePaths(this.minimeHome);
  }

  getTreeItem(element: TreeNodeData): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label);

    switch (element.type) {
      case 'org':
        item.iconPath = new vscode.ThemeIcon('organization');
        item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        break;

      case 'repo':
        item.iconPath = new vscode.ThemeIcon('repo');
        item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
        break;

      case 'tasksFolder':
        item.iconPath = new vscode.ThemeIcon('checklist');
        item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
        break;

      case 'wikiFolder':
        item.iconPath = new vscode.ThemeIcon('book');
        item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
        break;

      case 'task':
        item.iconPath = new vscode.ThemeIcon(this.taskThemeIcon(element.task!));
        item.collapsibleState = vscode.TreeItemCollapsibleState.None;
        item.description = this.taskDescription(element.task!);
        item.tooltip = this.taskTooltip(element.task!);
        item.command = {
          command: 'minime.openFile',
          title: 'Open Task',
          arguments: [element.filePath],
        };
        break;

      case 'wikiEntry':
        item.iconPath = new vscode.ThemeIcon(this.wikiThemeIcon(element.wikiEntry!));
        item.collapsibleState = vscode.TreeItemCollapsibleState.None;
        item.description = this.wikiDescription(element.wikiEntry!);
        item.tooltip = this.wikiTooltip(element.wikiEntry!);
        item.command = {
          command: 'minime.openFile',
          title: 'Open Wiki Entry',
          arguments: [element.filePath, element.lineNumber],
        };
        break;

      case 'templatesFolder':
        item.iconPath = new vscode.ThemeIcon('file-code');
        item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
        break;

      case 'template':
        item.iconPath = new vscode.ThemeIcon('file');
        item.collapsibleState = vscode.TreeItemCollapsibleState.None;
        item.command = {
          command: 'minime.openFile',
          title: 'Open Template',
          arguments: [element.filePath],
        };
        break;

      case 'empty':
        item.iconPath = new vscode.ThemeIcon('info');
        item.collapsibleState = vscode.TreeItemCollapsibleState.None;
        break;
    }

    return item;
  }

  getChildren(element?: TreeNodeData): TreeNodeData[] {
    if (!element) {
      return this.getRootChildren();
    }

    switch (element.type) {
      case 'org':
        return this.getOrgChildren(element.org!);
      case 'repo':
        return this.getRepoChildren(element.repo!);
      case 'tasksFolder':
        return this.getTaskChildren(element.repo!);
      case 'wikiFolder':
        return this.getWikiChildren(element.repo!);
      case 'templatesFolder':
        return this.getTemplateChildren();
      default:
        return [];
    }
  }

  getAllWikiEntries(): WikiEntry[] {
    return this.orgs.flatMap(o => o.repos.flatMap(r => r.wikiEntries));
  }

  getOrgs(): MinimeOrg[] {
    return this.orgs;
  }

  private getRootChildren(): TreeNodeData[] {
    const children: TreeNodeData[] = [];

    for (const org of sortOrgs(this.orgs)) {
      children.push({
        type: 'org',
        label: org.name,
        org,
      });
    }

    if (this.templatePaths.length > 0) {
      children.push({
        type: 'templatesFolder',
        label: 'Templates',
      });
    }

    if (children.length === 0) {
      children.push({
        type: 'empty',
        label: 'No minime data found. Run /minime:lab',
      });
    }

    return children;
  }

  private getOrgChildren(org: MinimeOrg): TreeNodeData[] {
    return sortRepos(org.repos)
      .map(repo => ({
        type: 'repo' as TreeNodeType,
        label: repo.name,
        repo,
      }));
  }

  private getRepoChildren(repo: MinimeRepo): TreeNodeData[] {
    const children: TreeNodeData[] = [];

    const taskCount = repo.tasks.length;
    children.push({
      type: 'tasksFolder',
      label: `Blueprints (${taskCount})`,
      repo,
    });

    const wikiCount = repo.wikiEntries.length;
    children.push({
      type: 'wikiFolder',
      label: `Wiki (${wikiCount})`,
      repo,
    });

    return children;
  }

  private getTaskChildren(repo: MinimeRepo): TreeNodeData[] {
    if (repo.tasks.length === 0) {
      return [{ type: 'empty', label: 'No tasks' }];
    }

    return sortTasks(repo.tasks)
      .map(task => ({
        type: 'task' as TreeNodeType,
        label: task.shortName,
        filePath: task.filePath,
        task,
      }));
  }

  private getWikiChildren(repo: MinimeRepo): TreeNodeData[] {
    if (repo.wikiEntries.length === 0) {
      return [{ type: 'empty', label: repo.wikiPath ? 'No entries' : 'No wiki data' }];
    }

    return sortWikiEntries(repo.wikiEntries).map(entry => ({
      type: 'wikiEntry' as TreeNodeType,
      label: entry.name,
      filePath: entry.filePath,
      lineNumber: entry.lineNumber,
      wikiEntry: entry,
    }));
  }

  private getTemplateChildren(): TreeNodeData[] {
    return this.templatePaths.map(p => ({
      type: 'template' as TreeNodeType,
      label: path.basename(p),
      filePath: p,
    }));
  }

  private taskThemeIcon(task: MinimeTask): string {
    const s = task.status.toLowerCase();
    if (s === 'done' || s === 'implemented' || s === 'merged') return 'pass-filled';
    if (s === 'planning') return 'edit';
    if (s === 'in_progress' || s === 'implementing') return 'loading~spin';
    if (s === 'blocked') return 'error';
    return 'circle-outline';
  }

  private taskDescription(task: MinimeTask): string {
    const parts: string[] = [];
    if (task.date) parts.push(task.date);
    if (task.totalCriteria > 0) {
      parts.push(`${task.checkedCriteria}/${task.totalCriteria}`);
    }
    parts.push(task.status);
    return parts.join(' | ');
  }

  private taskTooltip(task: MinimeTask): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${task.shortName}**\n\n`);
    md.appendMarkdown(`Status: ${getStatusIcon(task.status)} ${task.status}\n\n`);
    if (task.goal) md.appendMarkdown(`Goal: ${task.goal}\n\n`);
    if (task.totalCriteria > 0) {
      md.appendMarkdown(`Criteria: ${task.checkedCriteria}/${task.totalCriteria} done\n\n`);
    }
    md.appendMarkdown(`Date: ${task.date}\n\n`);
    md.appendMarkdown(`Repo: ${task.repo}`);
    return md;
  }

  private wikiThemeIcon(entry: WikiEntry): string {
    if (entry.kind === 'page') return 'file';
    if (entry.status === 'stale' || entry.status === 'superseded') return 'warning';
    if (entry.confidence === 'high') return 'verified-filled';
    if (entry.confidence === 'medium') return 'verified';
    return 'unverified';
  }

  private wikiDescription(entry: WikiEntry): string {
    if (entry.kind === 'page') {
      return path.basename(entry.filePath);
    }
    return entry.confidence;
  }

  private wikiTooltip(entry: WikiEntry): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${entry.name}**\n\n`);
    if (entry.kind === 'page') {
      if (entry.rule) md.appendMarkdown(`${entry.rule}\n\n`);
      md.appendMarkdown(`Kind: page`);
      if (entry.lastVerified) md.appendMarkdown(` | Updated: ${entry.lastVerified}`);
      return md;
    }

    if (entry.rule) md.appendMarkdown(`Rule: ${entry.rule}\n\n`);
    if (entry.trigger) md.appendMarkdown(`Trigger: ${entry.trigger}\n\n`);
    if (entry.evidence) md.appendMarkdown(`Evidence: \`${entry.evidence}\`\n\n`);
    md.appendMarkdown(`Confidence: ${entry.confidence} | Score: ${entry.valueScore}\n\n`);
    md.appendMarkdown(`Status: ${entry.status}`);
    if (entry.lastVerified) md.appendMarkdown(` | Verified: ${entry.lastVerified}`);
    return md;
  }
}
