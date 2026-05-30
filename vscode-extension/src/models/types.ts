export interface MinimeOrg {
  name: string;
  path: string;
  repos: MinimeRepo[];
}

export interface MinimeRepo {
  name: string;
  org: string;
  path: string;
  tasks: MinimeTask[];
  wikiPath: string | undefined;
  wikiEntries: WikiEntry[];
}

export interface MinimeTask {
  filePath: string;
  shortName: string;
  date: string;
  status: string;
  repo: string;
  goal: string;
  totalCriteria: number;
  checkedCriteria: number;
  modifiedAt: number;
}

export interface WikiEntry {
  filePath: string;
  lineNumber: number;
  name: string;
  rule: string;
  trigger: string;
  evidence: string;
  origin: string;
  valueScore: number;
  confidence: string;
  status: string;
  lastVerified: string;
  kind: 'entry' | 'page';
}

export type TreeNodeType =
  | 'org'
  | 'repo'
  | 'tasksFolder'
  | 'wikiFolder'
  | 'task'
  | 'wikiEntry'
  | 'templatesFolder'
  | 'template'
  | 'empty';
