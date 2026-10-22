#!/usr/bin/env node
// Wiki lint: checks a knowledge root against the page rules in its schema.md. No dependencies.
//   node wiki-lint.mjs <VIRTUCON_HQ> [wiki-relative path ...] [--repo <checkout>]
// Without paths it checks the whole wiki; a path selects one file or directory.
// With --repo it also checks that cited `path:line` locations still exist in that checkout.
// Prints one JSON object. Exit 0 = clean, 1 = violations, 2 = usage.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Numbers come from schema.md "Page rules" and "Navigation".
export const LIMITS = { bytes: 6144, lines: 80, rules: 8, logLines: 100, logWords: 20, citeWindow: 3 };
const ORIGINS = ["human-correction", "failed-approach", "observation"];
const FIELDS = ["Summary", "Read when", "Scope", "LastVerified"];
const MAX_REPORTED = 40;

const err = (rule, message) => ({ rule, message });
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ruleBlocks = (text) => text.split(/^### /m).slice(1);

/* ── calculations ── */

export function lintPage(text) {
    const errors = [];
    const bytes = Buffer.byteLength(text);
    const lines = text.split("\n").length;
    const rules = ruleBlocks(text);
    if (bytes > LIMITS.bytes) errors.push(err("size", `${bytes} bytes, limit ${LIMITS.bytes}: split by trigger`));
    if (lines > LIMITS.lines) errors.push(err("lines", `${lines} lines, limit ${LIMITS.lines}: split by trigger`));
    if (rules.length > LIMITS.rules) errors.push(err("rules", `${rules.length} rules, limit ${LIMITS.rules}: split by trigger`));
    for (const field of FIELDS) {
        const value = field === "LastVerified" ? "\\d{4}-\\d{2}-\\d{2}" : "\\S";
        if (!new RegExp(`^- \\*\\*${field}:\\*\\*\\s*${value}`, "m").test(text)) errors.push(err("header", `missing ${field}${field === "LastVerified" ? " (YYYY-MM-DD)" : ""}`));
    }
    for (const block of rules) {
        const title = block.split("\n", 1)[0].trim();
        if (!/^- \*\*Evidence:\*\*\s*\S/m.test(block)) errors.push(err("evidence", `rule "${title}" has no Evidence`));
        const origin = block.match(/^- \*\*Origin:\*\*\s*(\S+)/m)?.[1];
        if (!ORIGINS.includes(origin)) errors.push(err("origin", `rule "${title}" needs Origin: ${ORIGINS.join(" | ")}`));
        const status = block.match(/^- \*\*Status:\*\*\s*(.+)$/m)?.[1];
        if (status !== undefined && !/^(active|stale|superseded by \S.*)$/.test(status.trim())) errors.push(err("status", `rule "${title}" Status must be active, stale or "superseded by <rule>"`));
    }
    if (text.includes("—")) errors.push(err("em-dash", "the schema bans em dashes"));
    return errors;
}

export function lintLog(text) {
    const errors = [];
    const lines = text.replace(/\n$/, "").split("\n");
    if (lines.length >= LIMITS.logLines) errors.push(err("log-size", `${lines.length} lines, keep under ${LIMITS.logLines}: move older lines to log/archive.md`));
    let previous = "9999-99-99";
    for (const line of lines.filter((l) => l.startsWith("- "))) {
        const m = line.match(/^- (\d{4}-\d{2}-\d{2}) (extract|lint|reorg) (\S+): (.+)$/);
        if (!m) {
            errors.push(err("log-format", `entry must read "- YYYY-MM-DD <extract|lint|reorg> <org>/<repo>: <text>": ${line.slice(0, 70)}`));
            continue;
        }
        if (m[4].split(/\s+/).length > LIMITS.logWords) errors.push(err("log-words", `more than ${LIMITS.logWords} words: ${line.slice(0, 70)}`));
        if (m[1] > previous) errors.push(err("log-order", `${m[1]} is newer than the entry above, newest first`));
        previous = m[1];
    }
    return errors;
}

// A citation like `src/cli.js:22-24` (`main`) must point into the file and sit near its first named symbol.
export function lintCitations(text, readRepoFile) {
    const errors = [];
    for (const m of text.matchAll(/`([^`\s:]+\.\w+):(\d+)(?:-(\d+))?`(?:\s*\(`([^`]+)`[^)]*\))?/g)) {
        const [, file, from, to, symbol] = m;
        const cite = `${file}:${from}${to ? `-${to}` : ""}`;
        const body = readRepoFile(file);
        if (body === null) {
            errors.push(err("cite", `${file} does not exist in the checkout`));
            continue;
        }
        const lines = body.split("\n");
        const last = Number(to ?? from);
        if (last > lines.length) errors.push(err("cite", `${cite} is past the end of the file (${lines.length} lines)`));
        else if (symbol && !lines.slice(Math.max(0, Number(from) - 1 - LIMITS.citeWindow), last + LIMITS.citeWindow).join("\n").includes(symbol))
            errors.push(err("cite", `${symbol} is not within ${LIMITS.citeWindow} lines of ${cite}`));
    }
    return errors;
}

export const linksTo = (indexText, target) => new RegExp(`\\]\\((?:\\./)?${escapeRe(target)}(?:#[^)\\s]*)?\\)`).test(indexText);

/* ── actions ── */

const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith(".md") ? [path.join(dir, e.name)] : []));

export function lint(hq, paths = [], { repo } = {}) {
    const wiki = path.join(hq, "wiki");
    const files = walk(wiki).map((p) => path.relative(wiki, p).split(path.sep).join("/"));
    const selected = (rel) => !paths.length || paths.some((p) => rel === p || rel.startsWith(p.replace(/\/?$/, "/")));
    const read = (rel) => readFileSync(path.join(wiki, rel), "utf8");
    const globalIndex = files.includes("index.md") ? read("index.md") : "";
    const errors = [];
    const add = (file, list) => list.forEach((e) => errors.push({ file, ...e }));
    const readRepoFile = (rel) => {
        const full = path.resolve(repo, rel);
        return full.startsWith(path.resolve(repo) + path.sep) && existsSync(full) ? readFileSync(full, "utf8") : null;
    };
    let checked = 0;

    for (const rel of files.filter((f) => selected(f) && !f.startsWith("log/"))) {
        const text = read(rel);
        const parts = rel.split("/");
        const isIndex = parts.at(-1) === "index.md";
        checked++;
        if (rel === "log.md") add(rel, lintLog(text));
        else if (!isIndex) add(rel, lintPage(text));
        if (repo && !isIndex && rel !== "log.md") add(rel, lintCitations(text, readRepoFile));

        for (const m of text.matchAll(/\]\(([^)\s#]+\.md)(?:#[^)\s]*)?\)/g)) {
            if (!/^https?:/.test(m[1]) && !existsSync(path.resolve(wiki, path.dirname(rel), m[1]))) add(rel, [err("link", `broken link ${m[1]}`)]);
        }

        if (parts[0] === "patterns" && parts.length === 2 && !linksTo(globalIndex, rel)) add(rel, [err("index", "not listed in wiki/index.md")]);
        if (parts[0] === "orgs" && parts.length === 4) {
            const scope = parts.slice(0, 3).join("/");
            if (isIndex && !linksTo(globalIndex, rel)) add(rel, [err("index", "scope not listed in wiki/index.md")]);
            if (!isIndex && !files.includes(`${scope}/index.md`)) add(rel, [err("index", `${scope} has no index.md`)]);
            if (!isIndex && files.includes(`${scope}/index.md`) && !linksTo(read(`${scope}/index.md`), parts[3])) add(rel, [err("index", `not listed in ${scope}/index.md`)]);
        }
    }

    const byRule = {};
    for (const e of errors) byRule[e.rule] = (byRule[e.rule] ?? 0) + 1;
    return { checked, errors: errors.slice(0, MAX_REPORTED), truncated: Math.max(0, errors.length - MAX_REPORTED), byRule, total: errors.length };
}

function main(argv) {
    const flag = argv.indexOf("--repo");
    const repo = flag >= 0 ? argv[flag + 1] : undefined;
    const [hq, ...paths] = argv.filter((a, i) => i !== flag && i !== flag + 1 || flag < 0);
    if (!hq || !existsSync(path.join(hq, "wiki")) || (flag >= 0 && !(repo && existsSync(repo)))) {
        process.stderr.write("usage: wiki-lint.mjs <VIRTUCON_HQ> [wiki-relative path ...] [--repo <checkout>]\n");
        return 2;
    }
    const out = lint(hq, paths, { repo });
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
    return out.total ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = main(process.argv.slice(2));
