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

// Blueprint files are `<YYYY-MM-DD>-<name>.md`; older ones end in `.blueprint.md`.
export const isBlueprintFilename = (name) => typeof name === "string" && name.endsWith(".md");

// Same cell splitting as skills/blueprint/scripts/blueprint.mjs, which blueprints.test.mjs cross-checks.
function splitRow(line) {
    const body = line.trim().replace(/^\|/, "").replace(/\|$/, "");
    const cells = [];
    let cell = "";
    let inCode = false;
    for (let i = 0; i < body.length; i++) {
        const ch = body[i];
        if (ch === "`") inCode = !inCode;
        if (ch === "|" && !inCode && body[i - 1] !== "\\") {
            cells.push(cell.trim());
            cell = "";
        } else {
            cell += ch;
        }
    }
    cells.push(cell.trim());
    return cells;
}

const refs = (text, kind) => [...String(text).matchAll(new RegExp(`\\b${kind}\\d+\\b`, "g"))].map((match) => match[0]);

function sectionLines(markdown) {
    const sections = new Map();
    let lines = null;
    for (const line of markdown.split("\n")) {
        const heading = line.match(/^## (.+?)\s*$/);
        if (heading) sections.set(heading[1], (lines = []));
        else lines?.push(line);
    }
    return (name) => sections.get(name) ?? [];
}

const tableRows = (lines) =>
    lines
        .filter((line) => line.trim().startsWith("|") && !/^\|\s*:?-/.test(line.trim()))
        .map(splitRow)
        .filter((cells) => cells[0] !== "ID");

// `## Criteria` marks the current format. The legacy one has `## Active criteria` and `## Criteria archive`.
const isCurrentFormat = (markdown) => /^## Criteria\s*$/m.test(markdown);

function inputText(lines, id) {
    const start = lines.findIndex((line) => line.startsWith(`- **${id}**`));
    if (start < 0) return "";
    const end = lines.findIndex((line, index) => index > start && /^- \*\*I\d+\*\*/.test(line));
    return lines
        .slice(start + 1, end < 0 ? undefined : end)
        .map((line) => line.replace(/^\s*>\s?/, ""))
        .join("\n")
        .trim();
}

// A criterion's origin reads `I1 "words from the input", D3`. Ids inside the quoted words are not references.
const originInputs = (origin) => [...origin.matchAll(/\b(I\d+)\b(?:\s*"[^"]*")?/g)].map((match) => match[1]);

function parseCurrent(markdown) {
    const lines = sectionLines(markdown);
    const criteria = lines("Criteria")
        .map((line) => line.match(/^- \*\*(C\d+)\*\*\s*(?:\(((?:[^()"]|"[^"]*")*)\))?\s*:?\s*(.*)$/))
        .filter(Boolean)
        .map(([, id, origin, text]) => ({ id, text, inputs: originInputs(origin ?? "") }));
    const openDecisions = tableRows(lines("Decisions"))
        .filter((cells) => /^open\b/i.test(cells[2] ?? "") || /^user:\s*pending\b/i.test(cells[3] ?? ""))
        .map(([id, question, answer]) => ({ id, question: question ?? "", answer: answer ?? "" }));
    // Extract closes a blueprint by appending "| Extracted: <date>" to the header.
    const extracted = markdown.match(/^Repo: .*\| Extracted: (\d{4}-\d{2}-\d{2})\s*$/m)?.[1] ?? null;
    const status = extracted ? "extracted" : openDecisions.length ? "questions" : "ready";
    return {
        format: "blueprint",
        status,
        goal: inputText(lines("Inputs"), "I1"),
        criteria,
        openDecisions,
        extracted,
        isOpen: !extracted,
    };
}

function parseLegacy(markdown) {
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
        format: "legacy",
        status,
        goal: section(markdown, "Goal"),
        criteria,
        openDecisions: [],
        progress: { completed, total: criteria.length },
        isOpen:
            criteria.some((criterion) => !criterion.complete) ||
            (criteria.length === 0 && !TERMINAL_STATUS.test(status)),
    };
}

export function parseBlueprint(markdown, filename, stats = {}, blueprintPath = null) {
    const title =
        markdown.match(/^# Blueprint:\s*(.+)$/m)?.[1]?.trim() ??
        filename.replace(/(?:\.blueprint)?\.md$/, "");
    return {
        filename,
        path: blueprintPath,
        title,
        ...(isCurrentFormat(markdown) ? parseCurrent(markdown) : parseLegacy(markdown)),
        updatedAt: stats.mtime?.toISOString?.() ?? null,
    };
}

// The owner reports progress. A current blueprint can add one thing without a report: the decision that waits for the user.
export function needsInputFromBlueprint(blueprint) {
    const decision = blueprint?.format === "blueprint" ? blueprint.openDecisions[0] : null;
    return decision ? { id: decision.id, question: decision.question } : null;
}

function confinedPath(root, filename) {
    if (
        typeof filename !== "string" ||
        filename !== basename(filename) ||
        !isBlueprintFilename(filename) ||
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
        .filter((entry) => entry.isFile() && isBlueprintFilename(entry.name))
        .map((entry) => readBlueprint(root, entry.name).model)
        .filter((blueprint) => blueprint.isOpen)
        .sort((left, right) =>
            String(right.updatedAt).localeCompare(String(left.updatedAt)) ||
            left.filename.localeCompare(right.filename),
        );
}
