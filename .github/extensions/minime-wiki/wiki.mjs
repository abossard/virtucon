// wiki.mjs — minime wiki library.
//
// Split into two layers (Grokking Simplicity):
//   * CALCULATIONS — pure functions of their inputs (no disk, no clock). These
//     are exported and unit-tested directly.
//   * ACTIONS — thin disk/clock wrappers that load a corpus then delegate to the
//     calculations. Kept small so the interesting logic stays testable.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
    readDocument as sharedReadDocument,
    replaceDocument as sharedReplaceDocument,
    saveDraft as sharedSaveDraft,
} from "../minime-flow/lib/documents.mjs";
import {
    commitQueuedDocument as storeCommitQueuedDocument,
    queueDocumentApply as storeQueueDocumentApply,
    saveDocumentDraft as storeSaveDocumentDraft,
} from "../minime-flow/lib/document-store.mjs";

/* ─────────────────────────────── errors ────────────────────────────── */

function fail(code, message, status = 400, extra = {}) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    Object.assign(error, extra);
    return error;
}

function isConflictError(error) {
    const code = String(error?.code || "").toLowerCase();
    const message = String(error?.message || "").toLowerCase();
    return Number(error?.status) === 409 || code.includes("conflict") || message.includes("conflict");
}

/* ─────────────────────────────── paths ─────────────────────────────── */

/** Resolve the minime root. Honors VIRTUCON_HQ, then MINIME_HOME, else ~/.minime. */
export function resolveRoot(env = process.env) {
    const candidate = env.VIRTUCON_HQ || env.MINIME_HOME;
    if (candidate && candidate.trim()) return path.resolve(candidate.trim());
    return path.join(homedir(), ".minime");
}

export function normalizeRelPath(relPath) {
    if (typeof relPath !== "string") throw fail("bad_input", "path is required");
    const trimmed = relPath.trim();
    if (!trimmed) throw fail("bad_input", "path is required");
    if (trimmed.includes("\0")) throw fail("bad_input", "path contains invalid bytes");
    return trimmed.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Confine `relPath` to `root` and return the absolute path. Throws on any
 * attempt to escape the root. Pure: operates on strings only.
 */
export function safeResolve(root, relPath) {
    const normalized = normalizeRelPath(relPath);
    const rootResolved = path.resolve(root);
    const abs = path.resolve(rootResolved, normalized);
    const rel = path.relative(rootResolved, abs);
    if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
        throw fail("path_escape", `path escapes wiki root: ${relPath}`);
    }
    return abs;
}

function assertWithinRoot(rootReal, absolutePath, relPath, { allowRoot = false } = {}) {
    const rel = path.relative(rootReal, absolutePath);
    const hitsRoot = rel === "";
    if ((!allowRoot && hitsRoot) || rel.startsWith("..") || path.isAbsolute(rel)) {
        throw fail("path_escape", `path escapes wiki root: ${relPath}`, 400, { relPath });
    }
}

async function rootRealPath(root) {
    const resolved = path.resolve(root);
    try {
        return await fs.realpath(resolved);
    } catch (error) {
        if (error?.code === "ENOENT") throw fail("not_found", `wiki root does not exist: ${resolved}`, 404);
        throw error;
    }
}

async function resolveReadPath(root, relPath) {
    const normalized = normalizeRelPath(relPath);
    const rootReal = await rootRealPath(root);
    const lexical = safeResolve(rootReal, normalized);
    let real;
    try {
        real = await fs.realpath(lexical);
    } catch (error) {
        if (error?.code === "ENOENT") throw fail("not_found", `article not found: ${normalized}`, 404, { relPath: normalized });
        throw error;
    }
    assertWithinRoot(rootReal, real, normalized);
    const stat = await fs.lstat(real);
    if (!stat.isFile()) throw fail("bad_input", "path must point to a file", 400, { relPath: normalized });
    return { relPath: normalized, absPath: real, rootReal };
}

function isBlueprintFolderPath(relPath) {
    return /(^|\/)_[^/]+\/blueprints\//.test(String(relPath).replace(/\\/g, "/"));
}

export function isWritableWikiPath(relPath) {
    const normalized = normalizeRelPath(relPath);
    if (!normalized.toLowerCase().endsWith(".md")) return false;
    if (!normalized.startsWith("wiki/")) return false;
    if (normalized.startsWith("raw/")) return false;
    if (isBlueprintFolderPath(normalized)) return false;
    return true;
}

function assertWritablePath(relPath) {
    const normalized = normalizeRelPath(relPath);
    if (normalized.startsWith("raw/")) {
        throw fail("read_only", "raw sources are read-only", 403, { relPath: normalized });
    }
    if (isBlueprintFolderPath(normalized)) {
        throw fail("read_only", "blueprints are read-only in wiki canvas. open the blueprint canvas to apply corrections.", 403, { relPath: normalized });
    }
    if (!normalized.startsWith("wiki/")) {
        throw fail("read_only", "write path must be inside wiki/", 403, { relPath: normalized });
    }
    if (!normalized.toLowerCase().endsWith(".md")) {
        throw fail("bad_input", "only .md files may be written", 400, { relPath: normalized });
    }
    return normalized;
}

async function resolveCanonicalWikiRoot(rootReal, relPath) {
    const wikiLexical = path.join(rootReal, "wiki");
    try {
        const wikiStat = await fs.lstat(wikiLexical);
        if (wikiStat.isSymbolicLink()) {
            throw fail("path_escape", "wiki root symlink is not allowed for writes", 400, { relPath });
        }
        if (!wikiStat.isDirectory()) {
            throw fail("path_escape", "wiki root must be a directory", 400, { relPath });
        }
        const wikiReal = await fs.realpath(wikiLexical);
        assertWithinRoot(rootReal, wikiReal, relPath, { allowRoot: true });
        return { path: wikiReal, exists: true };
    } catch (error) {
        if (error?.status) throw error;
        if (error?.code === "ENOENT") return { path: wikiLexical, exists: false };
        throw error;
    }
}

async function resolveWritePath(root, relPath) {
    const normalized = assertWritablePath(relPath);
    const rootReal = await rootRealPath(root);
    const wikiRoot = await resolveCanonicalWikiRoot(rootReal, normalized);
    const lexical = safeResolve(rootReal, normalized);
    let probe = lexical;
    while (true) {
        try {
            const stat = await fs.lstat(probe);
            if (stat.isSymbolicLink()) {
                throw fail("path_escape", `symlink path is not allowed: ${normalized}`, 400, { relPath: normalized });
            }
            const probeReal = await fs.realpath(probe);
            assertWithinRoot(rootReal, probeReal, normalized, { allowRoot: probe !== lexical });
            if (!wikiRoot.exists && probe !== lexical && probeReal === rootReal) {
                return { relPath: normalized, absPath: lexical, existed: false, rootReal };
            }
            assertWithinRoot(wikiRoot.path, probeReal, normalized, { allowRoot: probe !== lexical });
            if (probe === lexical) {
                if (!stat.isFile()) throw fail("bad_input", "write path must be a file", 400, { relPath: normalized });
                return { relPath: normalized, absPath: probeReal, existed: true, rootReal };
            }
            return { relPath: normalized, absPath: lexical, existed: false, rootReal };
        } catch (error) {
            if (error?.status) throw error;
            if (error?.code !== "ENOENT") throw error;
            const parent = path.dirname(probe);
            if (parent === probe) throw fail("path_escape", `path escapes wiki root: ${normalized}`, 400, { relPath: normalized });
            probe = parent;
        }
    }
}

/* ──────────────────────────── classification ───────────────────────── */

/** Classify a wiki-root-relative path into {area, org, repo, name}. Pure. */
export function classify(relPath) {
    const parts = String(relPath).replace(/\\/g, "/").split("/");
    const name = parts[parts.length - 1].replace(/\.md$/i, "");
    if (parts[0] === "wiki" && parts[1] === "patterns") {
        return { area: "pattern", org: null, repo: null, name };
    }
    if (parts[0] === "wiki" && parts[1] === "orgs") {
        return { area: "wiki", org: parts[2] ?? null, repo: parts[3] ?? null, name };
    }
    if (parts[0] === "raw") {
        return { area: "raw", org: parts[1] ?? null, repo: parts[2] ?? null, name };
    }
    if (isBlueprintPath(relPath)) {
        return { area: "blueprint", org: parts[0] ?? null, repo: (parts[1] ?? "").replace(/^_/, ""), name };
    }
    return { area: "other", org: null, repo: null, name };
}

/* ─────────────────────────── repo identity ─────────────────────────── */

/** Best-effort current repo identity from git origin; returns null when missing. */
export function deriveCurrentRepository(cwd = process.cwd()) {
    try {
        const remote = execFileSync("git", ["remote", "get-url", "origin"], {
            cwd,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        }).trim();
        const match =
            remote.match(/^[^@]+@[^:]+:([^/]+)\/(.+?)(?:\.git)?$/) ??
            remote.match(/^https?:\/\/[^/]+\/([^/]+)\/(.+?)(?:\.git)?$/);
        if (!match) return null;
        return { org: match[1], repo: match[2] };
    } catch {
        return null;
    }
}

export function resolveScopeMode(mode, currentRepository) {
    if (mode === "all") return "all";
    if (mode === "current" && currentRepository) return "current";
    if (mode === "current" && !currentRepository) return "all";
    return currentRepository ? "current" : "all";
}

export function scopeCorpus(corpus, { mode = "all", currentRepository = null } = {}) {
    if (resolveScopeMode(mode, currentRepository) !== "current" || !currentRepository) return corpus;
    return corpus.filter((doc) => {
        if (doc.area === "pattern") return true;
        if (doc.area !== "wiki" && doc.area !== "raw") return false;
        return doc.org === currentRepository.org && doc.repo === currentRepository.repo;
    });
}

/* ──────────────────────────── metadata parse ───────────────────────── */

const FIELD_RE = /^\s*[-*]?\s*\*\*([A-Za-z ]+?):\*\*\s*(.*)$/;

/**
 * Parse an article's title, summary and `**Field:** value` metadata bullets.
 * Handles both the topic-page style (`**Summary:** … - **Scope:** …`) and the
 * template-entry style (`- **Rule:** … - **Confidence:** …`). Pure.
 */
export function parseMeta(text) {
    const lines = String(text).split(/\r?\n/);
    const fields = {};
    let title = null;
    for (const line of lines) {
        if (title === null) {
            const h = line.match(/^#{1,3}\s+(.*\S)\s*$/);
            if (h) title = h[1].trim();
        }
        const m = line.match(FIELD_RE);
        if (m) {
            const key = m[1].trim().toLowerCase();
            if (!(key in fields)) fields[key] = m[2].trim();
        }
    }
    const summary =
        fields.summary ||
        fields.rule ||
        firstParagraph(lines) ||
        "";
    return {
        title: title || "",
        summary,
        scope: fields.scope || "",
        lastVerified: fields.lastverified || "",
        status: fields.status || "",
        confidence: fields.confidence || "",
        valueScore: fields.valuescore || "",
        trigger: fields.trigger || "",
        origin: fields.origin || "",
        fields,
    };
}

function firstParagraph(lines) {
    for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        if (line.startsWith("#")) continue;
        if (FIELD_RE.test(raw)) continue;
        return line.slice(0, 240);
    }
    return "";
}

/**
 * Update `**Field:** value` lines in-place for the given fields. If a field is
 * absent, a bullet is inserted after the first metadata bullet (or after the
 * title). Returns the new text. Pure.
 */
export function patchMeta(text, updates) {
    const labelFor = {
        scope: "Scope",
        lastVerified: "LastVerified",
        status: "Status",
        confidence: "Confidence",
        valueScore: "ValueScore",
    };
    let lines = String(text).split(/\r?\n/);
    for (const [key, value] of Object.entries(updates)) {
        if (value == null || value === "") continue;
        const label = labelFor[key];
        if (!label) continue;
        const idx = lines.findIndex((l) => {
            const m = l.match(FIELD_RE);
            return m && m[1].trim().toLowerCase() === label.toLowerCase();
        });
        const bullet = `- **${label}:** ${value}`;
        if (idx >= 0) {
            const indent = lines[idx].match(/^(\s*)/)[1];
            lines[idx] = `${indent}${bullet.trim()}`;
        } else {
            const anchor = lines.findIndex((l) => FIELD_RE.test(l));
            const at = anchor >= 0 ? anchor + 1 : firstInsertAnchor(lines);
            lines.splice(at, 0, bullet);
        }
    }
    return lines.join("\n");
}

function firstInsertAnchor(lines) {
    const titleIdx = lines.findIndex((l) => /^#{1,3}\s+/.test(l));
    return titleIdx >= 0 ? titleIdx + 1 : 0;
}

/* ───────────────────────────────── tree ────────────────────────────── */

/** Build an orgs/repos/patterns catalog from a corpus. Pure. */
export function buildTree(corpus) {
    const orgMap = new Map();
    const patterns = [];
    let raw = 0;
    for (const doc of corpus) {
        if (doc.area === "pattern") {
            patterns.push({ name: doc.name, relPath: doc.relPath });
            continue;
        }
        if (doc.area === "raw") {
            raw++;
            continue;
        }
        if (doc.area !== "wiki") continue;
        const org = doc.org || "(unscoped)";
        const repo = doc.repo || "(root)";
        if (!orgMap.has(org)) orgMap.set(org, new Map());
        const repoMap = orgMap.get(org);
        if (!repoMap.has(repo)) repoMap.set(repo, []);
        repoMap.get(repo).push({ name: doc.name, relPath: doc.relPath, area: doc.area });
    }
    const orgs = [...orgMap.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([org, repoMap]) => ({
            org,
            repos: [...repoMap.entries()]
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([repo, articles]) => ({
                    repo,
                    count: articles.length,
                    articles: articles.sort((a, b) => a.name.localeCompare(b.name)),
                })),
        }));
    return {
        orgs,
        patterns: patterns.sort((a, b) => a.name.localeCompare(b.name)),
        counts: { total: corpus.length, patterns: patterns.length, raw },
    };
}

/**
 * Build a real nested folder/file tree (mirrors the filesystem) for an
 * Obsidian-style explorer. Returns the children of the synthetic root, with
 * directories sorted before files, each alphabetical. Pure.
 */
export function buildFileTree(corpus) {
    const root = { name: "", path: "", type: "dir", children: new Map() };
    for (const doc of corpus) {
        const segs = doc.relPath.split(path.sep).filter(Boolean);
        let node = root;
        let acc = "";
        for (let i = 0; i < segs.length; i++) {
            const seg = segs[i];
            acc = acc ? `${acc}/${seg}` : seg;
            const isFile = i === segs.length - 1;
            if (isFile) {
                node.children.set(seg, { name: seg, path: doc.relPath, type: "file", area: doc.area });
            } else {
                if (!node.children.has(seg)) {
                    node.children.set(seg, { name: seg, path: acc, type: "dir", children: new Map() });
                }
                node = node.children.get(seg);
            }
        }
    }
    return toSorted(root).children;
}

function toSorted(node) {
    if (node.type !== "dir") return node;
    const children = [...node.children.values()].map(toSorted);
    children.sort((a, b) => {
        if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
        return a.name.localeCompare(b.name);
    });
    return { ...node, children };
}

/* ──────────────────────────────── search ───────────────────────────── */

export function tokenize(s) {
    return String(s)
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .filter((t) => t.length > 1);
}

/**
 * Rank a corpus against a free-text query. Pure. Returns up to `limit` results
 * scored by name/summary/body matches with a small area weight.
 */
export function searchCorpus(corpus, query, { limit = 25 } = {}) {
    const terms = tokenize(query);
    if (terms.length === 0) return [];
    const results = [];
    for (const doc of corpus) {
        const haystackName = (doc.name + " " + (doc.title || "")).toLowerCase();
        const summary = (doc.summary || "").toLowerCase();
        const body = doc.text.toLowerCase();
        let score = 0;
        let matchedTerms = 0;
        for (const term of terms) {
            const inName = haystackName.includes(term);
            const inSummary = summary.includes(term);
            const bodyHits = countOccurrences(body, term);
            if (inName || inSummary || bodyHits > 0) matchedTerms++;
            if (inName) score += 40;
            if (inSummary) score += 18;
            score += Math.min(bodyHits, 12) * 2;
        }
        if (matchedTerms === 0) continue;
        if (matchedTerms === terms.length && terms.length > 1) score += 25;
        if (doc.area === "wiki" || doc.area === "pattern") score += 6;
        results.push({
            relPath: doc.relPath,
            area: doc.area,
            org: doc.org,
            repo: doc.repo,
            name: doc.name,
            title: doc.title || doc.name,
            score,
            snippet: makeSnippet(doc.text, terms),
        });
    }
    results.sort((a, b) => b.score - a.score || a.relPath.localeCompare(b.relPath));
    return results.slice(0, limit);
}

function countOccurrences(haystack, needle) {
    let count = 0;
    let i = haystack.indexOf(needle);
    while (i !== -1) {
        count++;
        i = haystack.indexOf(needle, i + needle.length);
    }
    return count;
}

export function makeSnippet(text, terms, radius = 90) {
    const lower = text.toLowerCase();
    let pos = -1;
    for (const term of terms) {
        const i = lower.indexOf(term);
        if (i !== -1 && (pos === -1 || i < pos)) pos = i;
    }
    if (pos === -1) return text.slice(0, radius * 2).replace(/\s+/g, " ").trim();
    const start = Math.max(0, pos - radius);
    const end = Math.min(text.length, pos + radius);
    return (start > 0 ? "…" : "") +
        text.slice(start, end).replace(/\s+/g, " ").trim() +
        (end < text.length ? "…" : "");
}

/* ──────────────────────────────── stats ────────────────────────────── */

/**
 * Maintenance signals over a corpus: counts, stale (dated past `staleDays`),
 * low-confidence, and duplicate candidates (title token Jaccard).
 * Pure — `today` is injected.
 */
export function computeStats(corpus, { today = new Date(), staleDays = 120, dupThreshold = 0.5 } = {}) {
    const byArea = {};
    const stale = [];
    const lowConfidence = [];
    const wikiDocs = [];
    for (const doc of corpus) {
        byArea[doc.area] = (byArea[doc.area] || 0) + 1;
        if (doc.area === "raw" || doc.area === "other") continue;
        wikiDocs.push(doc);
        const meta = doc.meta || parseMeta(doc.text);
        const days = ageInDays(meta.lastVerified, today);
        if (days != null && days > staleDays) {
            stale.push({ relPath: doc.relPath, name: doc.name, lastVerified: meta.lastVerified, ageDays: days });
        }
        const conf = (meta.confidence || "").toLowerCase();
        if (conf === "low") {
            lowConfidence.push({ relPath: doc.relPath, name: doc.name, confidence: meta.confidence });
        }
    }
    stale.sort((a, b) => b.ageDays - a.ageDays);
    return {
        total: corpus.length,
        byArea,
        stale,
        lowConfidence,
        duplicates: findDuplicates(wikiDocs, dupThreshold),
    };
}

function ageInDays(dateStr, today) {
    if (!dateStr) return null;
    const m = String(dateStr).match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    const then = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (Number.isNaN(then.getTime())) return null;
    return Math.floor((today.getTime() - then.getTime()) / 86400000);
}

/** Find article pairs whose title tokens overlap above `threshold`. Pure. */
export function findDuplicates(docs, threshold = 0.5) {
    const sets = docs.map((d) => ({
        relPath: d.relPath,
        name: d.name,
        org: d.org,
        repo: d.repo,
        tokens: new Set(tokenize((d.title || d.name).replace(/[-_]/g, " "))),
    }));
    const out = [];
    for (let i = 0; i < sets.length; i++) {
        for (let j = i + 1; j < sets.length; j++) {
            const score = jaccard(sets[i].tokens, sets[j].tokens);
            if (score >= threshold) {
                out.push({
                    a: sets[i].relPath,
                    b: sets[j].relPath,
                    score: Number(score.toFixed(2)),
                });
            }
        }
    }
    return out.sort((x, y) => y.score - x.score).slice(0, 50);
}

function jaccard(a, b) {
    if (a.size === 0 || b.size === 0) return 0;
    let inter = 0;
    for (const t of a) if (b.has(t)) inter++;
    return inter / (a.size + b.size - inter);
}

/* ─────────────────────────── markdown render ───────────────────────── */

export function escapeHtml(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function splitTableRow(line) {
    let s = line.trim();
    if (s.startsWith("|")) s = s.slice(1);
    if (s.endsWith("|")) s = s.slice(0, -1);
    return s.split("|").map((c) => c.trim());
}
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** Minimal, dependency-free, injection-safe markdown → HTML. */
export function renderMarkdown(md) {
    const lines = String(md).split(/\r?\n/);
    const html = [];
    let listType = null;
    const closeList = () => { if (listType) { html.push(`</${listType}>`); listType = null; } };
    let i = 0;
    while (i < lines.length) {
        const raw = lines[i];

        if (/^```/.test(raw)) {
            closeList();
            const buf = []; i++;
            while (i < lines.length && !/^```/.test(lines[i])) { buf.push(escapeHtml(lines[i])); i++; }
            i++;
            html.push("<pre><code>" + buf.join("\n") + "</code></pre>");
            continue;
        }

        if (/^\s*\|.*\|\s*$/.test(raw) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
            closeList();
            const head = splitTableRow(raw); i += 2;
            const body = [];
            while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { body.push(splitTableRow(lines[i])); i++; }
            let t = "<table><thead><tr>" + head.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>";
            for (const r of body) t += "<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>";
            html.push(t + "</tbody></table>");
            continue;
        }

        const heading = raw.match(/^(#{1,6})\s+(.*)$/);
        if (heading) { closeList(); html.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); i++; continue; }
        if (/^\s*([-*_])\1{2,}\s*$/.test(raw)) { closeList(); html.push("<hr/>"); i++; continue; }

        const task = raw.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/);
        if (task) {
            if (listType !== "ul") { closeList(); html.push('<ul class="tasklist">'); listType = "ul"; }
            const done = task[1].toLowerCase() === "x";
            html.push(`<li class="task ${done ? "done" : ""}"><span class="cb">${done ? "✓" : ""}</span><span>${inline(task[2])}</span></li>`);
            i++; continue;
        }
        const ol = raw.match(/^\s*\d+\.\s+(.*)$/);
        const ul = raw.match(/^\s*[-*]\s+(.*)$/);
        if (ol || ul) {
            const want = ol ? "ol" : "ul";
            if (listType !== want) { closeList(); html.push(`<${want}>`); listType = want; }
            html.push(`<li>${inline((ol || ul)[1])}</li>`);
            i++; continue;
        }

        if (raw.trim() === "") { closeList(); i++; continue; }
        closeList();
        html.push(`<p>${inline(raw)}</p>`);
        i++;
    }
    closeList();
    return html.join("\n");
}

/* ───────────────────────────── blueprints ──────────────────────────── */

const BLUEPRINT_RE = /(^|\/)_[^/]+\/blueprints\/[^/]+\.md$/;
export function isBlueprintPath(relPath) { return BLUEPRINT_RE.test(String(relPath).replace(/\\/g, "/")); }

/** Parse a blueprint's header + acceptance-criteria progress. Pure. */
export function parseBlueprintMeta(text) {
    const t = String(text);
    let title = (t.match(/^#\s*Task:\s*(.+)$/m) || [])[1] || (t.match(/^#\s+(.+)$/m) || [])[1] || "";
    title = title.trim();
    const created = (t.match(/Created:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/) || [])[1] || "";
    const status = ((t.match(/Status:\s*([^|\n]+)/) || [])[1] || "").trim();
    const repo = ((t.match(/Repo:\s*([^\s|\n]+)/) || [])[1] || "").trim();
    let goal = "";
    const lines = t.split(/\r?\n/);
    const gi = lines.findIndex((l) => /^##\s+Goal\b/i.test(l));
    if (gi >= 0) for (let k = gi + 1; k < lines.length; k++) { const s = lines[k].trim(); if (!s) continue; if (s.startsWith("#")) break; goal = s; break; }
    const acTotal = (t.match(/^\s*-\s*\[[ xX]\]/gm) || []).length;
    const acDone = (t.match(/^\s*-\s*\[[xX]\]/gm) || []).length;
    return { title, created, status, repo, goal, acTotal, acDone };
}

/** Group blueprints by org → repo, newest first. Pure. */
export function buildBlueprintTree(blueprints) {
    const orgMap = new Map();
    for (const bp of blueprints) {
        if (!orgMap.has(bp.org)) orgMap.set(bp.org, new Map());
        const rm = orgMap.get(bp.org);
        if (!rm.has(bp.repo)) rm.set(bp.repo, []);
        rm.get(bp.repo).push(bp);
    }
    const orgs = [...orgMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([org, rm]) => ({
        org,
        repos: [...rm.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([repo, items]) => ({
            repo,
            count: items.length,
            items: items.sort((a, b) => (b.created || "").localeCompare(a.created || "") || a.name.localeCompare(b.name)),
        })),
    }));
    return { orgs, count: blueprints.length };
}

function inline(s) {
    let out = escapeHtml(s);
    out = out.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
    out = out.replace(/\*\*([^*]+)\*\*/g, (_, c) => `<strong>${c}</strong>`);
    out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
        const safe = /^https?:\/\//i.test(href) ? href : "#";
        return `<a href="${escapeHtml(safe)}" target="_blank" rel="noreferrer">${label}</a>`;
    });
    return out;
}

/* ─────────────────────── shared document helper ────────────────────── */

function normalizeRevision(value) {
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    return null;
}

function normalizeDraftContent(value) {
    if (value == null) return null;
    if (typeof value === "string") return { content: value };
    if (typeof value === "object" && (typeof value.content === "string" || typeof value.markdown === "string")) {
        const content = typeof value.content === "string" ? value.content : value.markdown;
        return {
            content,
            updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
            baseRevision: normalizeRevision(value.baseRevision),
            revision: normalizeRevision(value.revision),
            status: typeof value.status === "string" ? value.status : null,
            requestId: typeof value.requestId === "string" ? value.requestId : null,
        };
    }
    return null;
}

function normalizeExpectedRevision(value, { allowNull = false } = {}) {
    const normalized = normalizeRevision(value);
    if (normalized === null && !allowNull) throw fail("expected_revision_required", "expectedRevision is required for writes", 422);
    return normalized;
}

function contentHash(content) {
    return createHash("sha256").update(content, "utf8").digest("hex");
}

function normalizeDraftSessionKey(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    return value.trim();
}

function normalizeSharedDraft(draft) {
    const normalized = normalizeDraftContent(draft);
    if (!normalized) return null;
    if (normalized.status === "applied" || normalized.status === "committed") return null;
    return normalized;
}

function mapConflict(error, relPath, expectedRevision = null) {
    const conflict = error?.conflict || {};
    return fail("conflict", error?.message || "document has changed since your last read", 409, {
        relPath,
        expectedRevision,
        currentRevision: normalizeRevision(error?.currentRevision ?? conflict.currentRevision),
        currentContent: typeof (error?.currentContent ?? conflict.currentContent) === "string"
            ? (error?.currentContent ?? conflict.currentContent)
            : null,
        currentDraftRevision: normalizeRevision(error?.currentDraftRevision ?? conflict.currentDraftRevision),
        retainedDraftPath: error?.retainedDraftPath ?? conflict.retainedDraftPath ?? null,
        currentRequestId:
            typeof (error?.currentRequestId ?? conflict.currentRequestId) === "string"
                ? (error?.currentRequestId ?? conflict.currentRequestId)
                : null,
        currentStatus:
            typeof (error?.currentStatus ?? conflict.currentStatus) === "string"
                ? (error?.currentStatus ?? conflict.currentStatus)
                : null,
    });
}

async function readDocumentState(root, relPath, { draftSessionKey = null } = {}) {
    const resolved = await resolveReadPath(root, relPath);
    const appliedMarkdown = await fs.readFile(resolved.absPath, "utf8");
    const writable = isWritableWikiPath(resolved.relPath);
    const key = normalizeDraftSessionKey(draftSessionKey);
    if (!writable || !key) {
        return {
            relPath: resolved.relPath,
            absPath: resolved.absPath,
            rootReal: resolved.rootReal,
            appliedMarkdown,
            markdown: appliedMarkdown,
            revision: contentHash(appliedMarkdown),
            draft: null,
            hasSharedDocumentsHelper: true,
        };
    }
    const helper = await sharedReadDocument({
        root: resolved.rootReal,
        relPath: resolved.relPath,
        path: resolved.absPath,
        draftSessionKey: key,
    });
    if (!helper || typeof helper !== "object" || typeof helper.content !== "string") {
        throw fail("helper_invalid", "shared document helper returned an invalid read result", 500, {
            relPath: resolved.relPath,
        });
    }
    const revision = normalizeRevision(helper.revision) ?? contentHash(helper.content);
    const draft = normalizeSharedDraft(helper.draft);
    return {
        relPath: resolved.relPath,
        absPath: resolved.absPath,
        rootReal: resolved.rootReal,
        appliedMarkdown: helper.content,
        markdown: draft?.content ?? helper.content,
        revision,
        draft,
        hasSharedDocumentsHelper: true,
    };
}

async function persistDraft(rootReal, absPath, relPath, draftSessionKey, draft, { expectedDraftRevision = null, createIfMissing = false } = {}) {
    const normalizedDraft = normalizeDraftContent(draft);
    if (!draftSessionKey || !normalizedDraft) return null;
    const baseRevision = normalizeRevision(normalizedDraft.baseRevision);
    if (baseRevision === null && !createIfMissing) {
        throw fail("bad_input", "baseRevision is required for draft saves", 422, { relPath });
    }
    const expected = normalizeRevision(expectedDraftRevision) ?? normalizeRevision(normalizedDraft.revision) ?? null;
    if (createIfMissing) {
        await fs.mkdir(path.dirname(absPath), { recursive: true });
    }
    try {
        const saved = createIfMissing
            ? await storeSaveDocumentDraft({
                draftRoot: rootReal,
                documentPath: absPath,
                sessionId: draftSessionKey,
                markdown: normalizedDraft.content,
                baseRevision,
                expectedDraftRevision: expected,
                createIfMissing: true,
            })
            : await sharedSaveDraft({
                root: rootReal,
                relPath,
                path: absPath,
                draftSessionKey,
                draft: {
                    content: normalizedDraft.content,
                    baseRevision,
                    revision: normalizeRevision(normalizedDraft.revision),
                },
                baseRevision,
                expectedDraftRevision: expected,
            });
        const savedDraft = createIfMissing ? saved?.draft : saved;
        const draftOut = normalizeSharedDraft(savedDraft) || normalizeDraftContent(savedDraft) || normalizedDraft;
        return draftOut;
    } catch (error) {
        if (Number(error?.status) === 409 || isConflictError(error)) {
            throw mapConflict(error, relPath, baseRevision);
        }
        throw error;
    }
}

/* ─────────────────────────────── actions ───────────────────────────── */

let _cache = null; // { root, at, corpus }
let _bpCache = null; // { root, at, list }
const CACHE_TTL_MS = 4000;

async function walkMarkdown(dir, acc) {
    let entries;
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
        return acc;
    }
    for (const ent of entries) {
        if (ent.name.startsWith(".") || ent.isSymbolicLink()) continue;
        const abs = path.join(dir, ent.name);
        if (ent.isDirectory()) {
            await walkMarkdown(abs, acc);
        } else if (ent.isFile() && ent.name.toLowerCase().endsWith(".md")) {
            acc.push(abs);
        }
    }
    return acc;
}

/** Load (and cache) the full wiki+raw corpus with parsed metadata. Action. */
export async function loadCorpus(root, { force = false } = {}) {
    if (!force && _cache && _cache.root === root && Date.now() - _cache.at < CACHE_TTL_MS) {
        return _cache.corpus;
    }
    const rootReal = await rootRealPath(root);
    const roots = ["wiki", "raw"].map((d) => path.join(rootReal, d));
    const files = [];
    for (const dir of roots) await walkMarkdown(dir, files);
    const corpus = [];
    for (const abs of files) {
        let text = "";
        try {
            text = await fs.readFile(abs, "utf8");
        } catch {
            continue;
        }
        const relPath = path.relative(rootReal, abs);
        const meta = parseMeta(text);
        corpus.push({ relPath, abs, ...classify(relPath), title: meta.title, summary: meta.summary, meta, text });
    }
    _cache = { root, at: Date.now(), corpus };
    return corpus;
}

export function invalidateCache() {
    _cache = null;
    _bpCache = null;
}

/** Read one article (raw + meta + rendered HTML + revision metadata). Action. */
export async function readArticle(root, relPath, { draftSessionKey = null } = {}) {
    const normalized = normalizeRelPath(relPath);
    const writable = isWritableWikiPath(normalized);
    const state = await readDocumentState(root, normalized, {
        draftSessionKey: writable ? normalizeDraftSessionKey(draftSessionKey) : null,
    });
    const meta = parseMeta(state.markdown);
    const out = {
        relPath: state.relPath,
        ...classify(state.relPath),
        meta,
        markdown: state.markdown,
        appliedMarkdown: state.appliedMarkdown,
        html: renderMarkdown(state.markdown),
        revision: state.revision,
        draft: state.draft,
        readOnly: !writable,
        writable,
        hasSharedDocumentsHelper: state.hasSharedDocumentsHelper,
    };
    if (isBlueprintPath(state.relPath)) out.blueprint = parseBlueprintMeta(state.markdown);
    return out;
}

/** Save/replace a draft for a writable wiki article. Action. */
export async function saveDraft(root, relPath, draft, {
    draftSessionKey,
    expectedDraftRevision = null,
} = {}) {
    const resolved = await resolveWritePath(root, relPath);
    const key = normalizeDraftSessionKey(draftSessionKey || draft?.sessionKey);
    if (!key) throw fail("bad_input", "draftSessionKey is required", 422, { relPath: resolved.relPath });
    const normalizedDraft = normalizeDraftContent(draft);
    if (!normalizedDraft) throw fail("bad_input", "draft content is required", 422, { relPath: resolved.relPath });
    const saved = await persistDraft(resolved.rootReal, resolved.absPath, resolved.relPath, key, normalizedDraft, {
        expectedDraftRevision,
        createIfMissing: !resolved.existed,
    });
    return {
        relPath: resolved.relPath,
        draft: saved || normalizedDraft,
        bytes: Buffer.byteLength((saved || normalizedDraft).content, "utf8"),
    };
}

/** Write an article via shared revision-aware helper. Action. */
export async function writeArticle(root, relPath, content, {
    expectedRevision,
    draftSessionKey = null,
    draft = null,
    expectedDraftRevision = null,
    createOnly = false,
} = {}) {
    if (typeof content !== "string") throw fail("bad_input", "content is required", 422);
    const hasExpectedRevision = arguments.length >= 4
        && arguments[3] != null
        && Object.prototype.hasOwnProperty.call(arguments[3], "expectedRevision");
    if (createOnly && !hasExpectedRevision) {
        throw fail("expected_revision_required", "expectedRevision is required for writes", 422);
    }
    const normalizedRevision = normalizeExpectedRevision(expectedRevision, { allowNull: createOnly === true });
    const resolved = await resolveWritePath(root, relPath);
    const key = normalizeDraftSessionKey(draftSessionKey || draft?.sessionKey);
    if (!key) throw fail("bad_input", "draftSessionKey is required", 422, { relPath: resolved.relPath });

    if (!resolved.existed && !createOnly) {
        throw fail("not_found", "article does not exist. use createOnly with expectedRevision set to null", 404, {
            relPath: resolved.relPath,
        });
    }
    if (resolved.existed && createOnly) {
        throw fail("conflict", "article already exists", 409, { relPath: resolved.relPath });
    }
    const createIfMissing = createOnly && !resolved.existed;
    if (createIfMissing) {
        await fs.mkdir(path.dirname(resolved.absPath), { recursive: true });
    }

    const draftPayload = normalizeDraftContent(draft) || (key ? {
        content,
        baseRevision: normalizedRevision,
        updatedAt: new Date().toISOString(),
    } : null);
    const draftBaseRevision = normalizeRevision(draftPayload?.baseRevision);
    if (createIfMissing && draftBaseRevision !== null && draftBaseRevision !== normalizedRevision) {
        throw fail("bad_input", "draft baseRevision must match expectedRevision for createOnly writes", 422, {
            relPath: resolved.relPath,
        });
    }
    const baseRevision = createIfMissing ? normalizedRevision : (draftBaseRevision ?? normalizedRevision);
    if (baseRevision === null && !createIfMissing) throw fail("expected_revision_required", "expectedRevision is required for writes", 422, {
        relPath: resolved.relPath,
    });
    const draftCas = normalizeRevision(expectedDraftRevision) ?? normalizeRevision(draftPayload?.revision) ?? null;
    try {
        if (createIfMissing) {
            const saved = await storeSaveDocumentDraft({
                draftRoot: resolved.rootReal,
                documentPath: resolved.absPath,
                sessionId: key,
                markdown: draftPayload.content,
                baseRevision,
                expectedDraftRevision: draftCas,
                createIfMissing: true,
            });
            const savedDraftRevision = normalizeRevision(saved?.draft?.revision);
            if (savedDraftRevision === null) {
                throw fail("helper_invalid", "shared helper did not return draft revision", 500, {
                    relPath: resolved.relPath,
                });
            }
            const queued = await storeQueueDocumentApply({
                draftRoot: resolved.rootReal,
                documentPath: resolved.absPath,
                sessionId: key,
                expectedDraftRevision: savedDraftRevision,
                createIfMissing: true,
            });
            const committed = await storeCommitQueuedDocument({
                draftRoot: resolved.rootReal,
                documentPath: resolved.absPath,
                sessionId: key,
                requestId: queued.requestId,
                expectedRevision: normalizedRevision,
                createIfMissing: true,
            });
            invalidateCache();
            return {
                relPath: resolved.relPath,
                bytes: Buffer.byteLength(content, "utf8"),
                revision: normalizeRevision(committed?.proof?.revision) ?? contentHash(content),
                created: true,
            };
        }

        const replaced = await sharedReplaceDocument({
            root: resolved.rootReal,
            relPath: resolved.relPath,
            path: resolved.absPath,
            expectedRevision: normalizedRevision,
            content,
            draftSessionKey: key,
            draft: {
                content: draftPayload.content,
                baseRevision,
                revision: draftCas,
            },
            expectedDraftRevision: draftCas,
        });
        if (replaced?.conflict) {
            throw fail("conflict", "document has changed since your last read", 409, {
                relPath: resolved.relPath,
                expectedRevision: normalizedRevision,
                currentRevision: normalizeRevision(replaced.currentRevision),
                currentContent: typeof replaced.currentContent === "string" ? replaced.currentContent : null,
            });
        }
        invalidateCache();
        return {
            relPath: resolved.relPath,
            bytes: Buffer.byteLength(content, "utf8"),
            revision: normalizeRevision(replaced?.revision) ?? contentHash(content),
            created: createIfMissing,
        };
    } catch (error) {
        if (isConflictError(error)) {
            const mapped = mapConflict(error, resolved.relPath, normalizedRevision);
            if (!mapped.currentContent) {
                mapped.currentContent = await fs.readFile(resolved.absPath, "utf8").catch(() => null);
            }
            throw mapped;
        }
        throw error;
    }
}

/** Patch an existing article's metadata fields using the same guarded write path. Action. */
export async function rateArticle(root, relPath, updates, {
    expectedRevision,
    draftSessionKey = null,
    draft = null,
    expectedDraftRevision = null,
} = {}) {
    const resolved = await resolveWritePath(root, relPath);
    const current = await readDocumentState(root, resolved.relPath, { draftSessionKey: null });
    if (draft && draft.content !== current.appliedMarkdown) {
        throw fail("unsaved_draft", "Save article text before changing properties.", 422);
    }
    const cleanUpdates = Object.fromEntries(
        Object.entries(updates || {}).filter(([, value]) => value != null && String(value).trim() !== ""),
    );
    const after = patchMeta(current.appliedMarkdown, cleanUpdates);
    const written = await writeArticle(root, resolved.relPath, after, {
        expectedRevision,
        draftSessionKey,
        draft: null,
        expectedDraftRevision,
    });
    return {
        relPath: resolved.relPath,
        updated: Object.keys(cleanUpdates),
        meta: parseMeta(after),
        revision: written.revision,
    };
}

/** Load (and cache) all blueprints under <org>/_<repo>/blueprints/. Action. */
export async function loadBlueprints(root, { force = false } = {}) {
    if (!force && _bpCache && _bpCache.root === root && Date.now() - _bpCache.at < CACHE_TTL_MS) return _bpCache.list;
    const rootReal = await rootRealPath(root);
    const skip = new Set(["wiki", "raw", "tasks", "templates"]);
    const out = [];
    let orgs = [];
    try { orgs = await fs.readdir(rootReal, { withFileTypes: true }); } catch { orgs = []; }
    for (const o of orgs) {
        if (!o.isDirectory() || o.isSymbolicLink() || o.name.startsWith(".") || o.name.startsWith("_") || skip.has(o.name)) continue;
        const orgDir = path.join(rootReal, o.name);
        let repos = [];
        try { repos = await fs.readdir(orgDir, { withFileTypes: true }); } catch { continue; }
        for (const r of repos) {
            if (!r.isDirectory() || r.isSymbolicLink() || !r.name.startsWith("_")) continue;
            const bpDir = path.join(orgDir, r.name, "blueprints");
            let files = [];
            try { files = await fs.readdir(bpDir, { withFileTypes: true }); } catch { continue; }
            for (const f of files) {
                if (!f.isFile() || f.isSymbolicLink() || !f.name.toLowerCase().endsWith(".md")) continue;
                const abs = path.join(bpDir, f.name);
                let text = "";
                try { text = await fs.readFile(abs, "utf8"); } catch { continue; }
                const relPath = path.relative(rootReal, abs);
                out.push({
                    relPath,
                    area: "blueprint",
                    org: o.name,
                    repo: r.name.replace(/^_/, ""),
                    name: f.name.replace(/\.md$/i, ""),
                    ...parseBlueprintMeta(text),
                });
            }
        }
    }
    _bpCache = { root, at: Date.now(), list: out };
    return out;
}
