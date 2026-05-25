import { MinimeTask, MinimeRepo, MinimeOrg, WikiEntry } from '../models/types';

export function sortTasks(tasks: MinimeTask[]): MinimeTask[] {
  return [...tasks].sort((a, b) =>
    (b.modifiedAt - a.modifiedAt) ||
    b.date.localeCompare(a.date) ||
    a.shortName.localeCompare(b.shortName)
  );
}

export function sortWikiEntries(entries: WikiEntry[]): WikiEntry[] {
  return [...entries].sort((a, b) => {
    if (!a.lastVerified && !b.lastVerified) return a.name.localeCompare(b.name);
    if (!a.lastVerified) return 1;
    if (!b.lastVerified) return -1;
    return b.lastVerified.localeCompare(a.lastVerified) || a.name.localeCompare(b.name);
  });
}

export function repoRecentActivity(repo: MinimeRepo): number {
  const taskDates = repo.tasks.map(t => t.modifiedAt);
  const wikiDates = repo.wikiEntries.map(e => {
    if (!e.lastVerified) return 0;
    const time = Date.parse(e.lastVerified);
    return Number.isFinite(time) ? time : 0;
  });
  return Math.max(0, ...taskDates, ...wikiDates);
}

export function sortRepos(repos: MinimeRepo[]): MinimeRepo[] {
  return [...repos].sort((a, b) =>
    repoRecentActivity(b) - repoRecentActivity(a) ||
    a.name.localeCompare(b.name)
  );
}

export function orgRecentActivity(org: MinimeOrg): number {
  return Math.max(0, ...org.repos.map(repoRecentActivity));
}

export function sortOrgs(orgs: MinimeOrg[]): MinimeOrg[] {
  return [...orgs].sort((a, b) =>
    orgRecentActivity(b) - orgRecentActivity(a) ||
    a.name.localeCompare(b.name)
  );
}
