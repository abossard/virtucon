import { execFileSync } from "node:child_process";
import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, resolve, sep } from "node:path";
import { repositoryRoots } from "./document-store.mjs";

const TERMINAL_STATUS = /^(?:complete|completed|done|implemented|extracted)\b/;

export function deriveRepository(cwd = process.cwd()) {
    const remote = execFileSync("git", ["remote", "get-url", "origin"], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const match =
        remote.match(/^[^@]+@[^:]+:([^/]+)\/(.+?)(?:\.git)?$/) ??
        remote.match(/^https?:\/\/[^/]+\/([^/]+)\/(.+?)(?:\.git)?$/);
    if (!match) throw new Error("Cannot derive repository identity from git origin.");
    return { org: match[1], repo: match[2], remote };
}

export function repositoryBlueprintRoot({ org, repo }) {
    return realpathSync(repositoryRoots({ org, repo }).blueprintRoot);
}

function section(markdown, heading) {
    const marker = `## ${heading}`;
    const start = markdown.indexOf(marker);
    if (start < 0) return "";
    const rest = markdown.slice(markdown.indexOf("\n", start) + 1);
    const next = rest.search(/^## /m);
    return (next < 0 ? rest : rest.slice(0, next)).trim();
}

export function parseBlueprint(markdown, filename, stats = {}, blueprintPath = null) {
    const title =
        markdown.match(/^# Blueprint:\s*(.+)$/m)?.[1]?.trim() ??
        filename.replace(/\.blueprint\.md$/, "");
    const status =
        markdown.match(/\bStatus:\s*([^|\n]+)/)?.[1]?.trim().toLowerCase() ??
        "unknown";
    const active = section(markdown, "Active criteria");
    const criteria = [...active.matchAll(/^- \[([ xX])\]\s+(.+)$/gm)].map(
        ([, mark, text]) => {
            const criterion = text.split(/\s+\|\s+VOI:/)[0].trim();
            const idMatch = criterion.match(/^([A-Za-z0-9]+-[0-9]+)\s+(.+)$/);
            return {
                complete: mark.toLowerCase() === "x",
                id: idMatch?.[1] ?? null,
                text: idMatch?.[2] ?? criterion,
            };
        },
    );
    const completed = criteria.filter((criterion) => criterion.complete).length;
    return {
        filename,
        path: blueprintPath,
        title,
        status,
        goal: section(markdown, "Goal"),
        criteria,
        progress: { completed, total: criteria.length },
        isOpen:
            criteria.some((criterion) => !criterion.complete) ||
            (criteria.length === 0 && !TERMINAL_STATUS.test(status)),
        updatedAt: stats.mtime?.toISOString?.() ?? null,
    };
}

function confinedPath(root, filename) {
    if (
        typeof filename !== "string" ||
        filename !== basename(filename) ||
        !filename.endsWith(".blueprint.md") ||
        filename.includes("\0")
    ) {
        throw Object.assign(new Error("Invalid blueprint name."), { status: 400 });
    }
    const candidate = resolve(root, filename);
    if (!candidate.startsWith(`${root}${sep}`)) throw Object.assign(new Error("Blueprint path is outside the repository root."), { status: 400 });
    if (!lstatSync(candidate).isFile()) throw Object.assign(new Error("Blueprint must be a regular file."), { status: 400 });
    const actual = realpathSync(candidate);
    if (!actual.startsWith(`${root}${sep}`)) throw Object.assign(new Error("Blueprint path is outside the repository root."), { status: 400 });
    return actual;
}

export function readBlueprint(root, filename) {
    const path = confinedPath(root, filename);
    const markdown = readFileSync(path, "utf8");
    return { path, markdown, model: parseBlueprint(markdown, filename, statSync(path), path) };
}

export function listOpenBlueprints(root) {
    return readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".blueprint.md"))
        .map((entry) => readBlueprint(root, entry.name).model)
        .filter((blueprint) => blueprint.isOpen)
        .sort((left, right) =>
            String(right.updatedAt).localeCompare(String(left.updatedAt)) ||
            left.filename.localeCompare(right.filename),
        );
}
