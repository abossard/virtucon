#!/usr/bin/env node
// Blueprint check, coverage and diff. No dependencies.
//   node blueprint.mjs check    <blueprint.md>
//   node blueprint.mjs coverage <blueprint.md> [--repo <dir>] [--files a,b]
//   node blueprint.mjs diff     [--repo <dir>]
// Prints one JSON object. Exit 0 = ok, 1 = errors or criteria without a test, 2 = usage.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SECTIONS = ["Inputs", "Criteria", "Boundaries"];
// What the plan decides, constrains or leaves out sits on the criterion line or in a Boundaries row, not in a section of its own.
const FORBIDDEN_SECTIONS = ["Decisions", "Flows", "Constraints", "Out of scope", "Tests"];
// Characters per item. The blueprint holds facts, references and values, so long cells are errors.
// `source` is one evidence bracket of a criterion, `open` the bracket that also holds the options of a question.
export const LIMITS = { criterion: 200, source: 120, open: 140, contract: 160, quoteMin: 3, quoteMax: 60, preferredBytesWithoutInputs: 2048 };
// Evidence ladder, strongest first. `default` is a recommendation the user accepted unchanged.
const SOURCE_KINDS = ["ran", "data", "research", "user", "default"];
// An `open` bracket is a question no source settled yet.
const BRACKET_KINDS = [...SOURCE_KINDS, "open"];
// A criterion cites a rule of the repo's process pages by a link in a bracket, bare or `[text](process-blueprint.md#anchor)`.
const PROCESS_PAGES = ["process-blueprint.md", "process-replicate.md", "process-inspect.md", "process-extract.md"];
const PROCESS_LINK = /(?<![\w-])process-[\w-]*\.md(?:#([\p{L}\p{N}_-]+))?/gu;
const CHANGES = ["new", "changed", "unchanged"];
const HEADER = /^Repo: (\S+) \| Created: (\d{4}-\d{2}-\d{2})(?: \| Parent: ([^\s|]+))?(?: \| Extracted: (\d{4}-\d{2}-\d{2}))?$/;
// A Boundaries row whose owner is a child blueprint, `<parent name>.<short-name>.md`, delegates its criteria to that file.
const CHILD_OWNER = /^`([^`/\s]+\.[^`/\s.]+\.md)`$/;
const TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "template.md");

/* ── calculations ── */

export function splitRow(line) {
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

const refs = (text, kind) => [...String(text).matchAll(new RegExp(`\\b${kind}\\d+\\b`, "g"))].map((m) => m[0]);

// A criterion's origin is `I1 "words from the input"`. Quoted words belong to the input id before them.
// A decision id (`D3`) is a leftover of the older format: check reports it.
export function criterionRefs(group) {
    const inputs = [];
    const decisions = [];
    for (const m of String(group).matchAll(/\b(I\d+)\b(?:\s*"([^"]*)")?|\b(D\d+)\b/g)) {
        if (m[1]) inputs.push({ id: m[1], quote: m[2] ?? null });
        else if (m[3]) decisions.push(m[3]);
    }
    return { inputs, decisions };
}

// `[<source>: <reference>]`, read for its source. A bracket whose source is not on the ladder has `kind` null.
function bracket(raw) {
    const body = raw.slice(1, -1).trim();
    const kind = body.match(/^(\w+)\s*:\s*\S/)?.[1].toLowerCase();
    return { raw, body, kind: BRACKET_KINDS.includes(kind) ? kind : null };
}

// A criterion line ends in evidence brackets. A bracket may hold brackets of its own (a markdown link, an index in a
// command) and brackets in code spans don't count. Reading from the end keeps a stray bracket in the sentence from
// swallowing the evidence. Returns the sentence before the brackets and the brackets in order.
export function evidenceOf(line) {
    const text = String(line);
    const found = [];
    let end = text.length;
    for (;;) {
        const close = text.slice(0, end).trimEnd().length;
        if (text[close - 1] !== "]") break;
        let depth = 0;
        let code = false;
        let start = close - 1;
        for (; start >= 0; start--) {
            const ch = text[start];
            if (ch === "`") code = !code;
            else if (code) continue;
            else if (ch === "]") depth++;
            else if (ch === "[" && --depth === 0) break;
        }
        if (start < 0) break;
        found.unshift(text.slice(start, close));
        end = start;
    }
    return { text: text.slice(0, end).trim(), evidence: found.map(bracket) };
}

const squash = (text) => String(text).replace(/\s+/g, " ").trim().toLowerCase();
const isRow = (l) => l.trim().startsWith("|");
const isRule = (l) => /^\|\s*:?-/.test(l.trim());

export function parse(text) {
    const headings = [];
    const sections = {};
    const preamble = [];
    let current = null;
    text.split("\n").forEach((line, index) => {
        const heading = line.match(/^## (.+?)\s*$/);
        if (heading) {
            current = heading[1];
            headings.push(current);
            sections[current] = sections[current] ?? [];
        } else {
            (current ? sections[current] : preamble).push({ n: index + 1, text: line });
        }
    });
    const lines = (name) => (sections[name] ?? []).map((l) => l.text);
    const rows = (name) => (sections[name] ?? []).filter((l) => isRow(l.text) && !isRule(l.text)).map((l) => ({ n: l.n, cells: splitRow(l.text) })).filter((r) => r.cells[0] !== "ID");
    const bullets = (name, kind) =>
        lines(name)
            .map((l) => l.match(new RegExp(`^- \\*\\*(${kind}\\d+)\\*\\*\\s*(?:\\(((?:[^()"]|"[^"]*")*)\\))?\\s*:?\\s*(.*)$`)))
            .filter(Boolean);
    const inputTexts = {};
    const inputBodies = {};
    let currentInput = null;
    for (const line of lines("Inputs")) {
        const m = line.match(/^- \*\*(I\d+)\*\*/);
        if (m) {
            currentInput = m[1];
            inputTexts[currentInput] = line;
            inputBodies[currentInput] = "";
        } else if (currentInput) {
            inputTexts[currentInput] += `\n${line}`;
            inputBodies[currentInput] += `\n${line.replace(/^\s*>\s?/, "")}`;
        }
    }
    const header = preamble.map((l) => l.text.match(HEADER)).find(Boolean) ?? null;
    return {
        headings,
        sections,
        preamble,
        header: header && { repo: header[1], created: header[2], parent: header[3] ?? null, extracted: header[4] ?? null },
        inputs: bullets("Inputs", "I").map((m) => ({ id: m[1], text: inputTexts[m[1]] ?? "", body: inputBodies[m[1]] ?? "" })),
        criteria: bullets("Criteria", "C").map((m) => ({ id: m[1], ...criterionRefs(m[2] ?? ""), ...evidenceOf(m[3]) })),
        boundaries: rows("Boundaries").map(({ n, cells: c }) => ({ n, id: c[0], owner: c[1] ?? "", contract: c[2] ?? "", change: c[3] ?? "", criteria: refs(c[4] ?? "", "C"), cells: c.length, child: (c[1] ?? "").match(CHILD_OWNER)?.[1] ?? null })),
        tracedInputs: new Set(
            Object.entries(sections).filter(([name]) => name !== "Inputs").flatMap(([, ls]) => refs(ls.map((l) => l.text).join("\n"), "I")),
        ),
    };
}

const processLinks = (text) => [...String(text).matchAll(PROCESS_LINK)].map((m) => ({ page: m[0].split("#")[0], anchor: m[1] }));

// The questions a blueprint still asks: one per `open` bracket, named by its criterion. The answer is the bracket's
// own text, `open: a) <option> b) <option>; recommend a`.
const openOf = (bp) => bp.criteria.flatMap((c) => c.evidence.filter((e) => e.kind === "open").map((e) => ({ id: c.id, question: c.text, answer: e.body })));
export const open = (text) => openOf(parse(text));

export function placeholders(templateText) {
    return [...new Set([...templateText.matchAll(/<[^<>\n]+>/g)].map((m) => m[0]))];
}

// A line that is not a heading, list item, table row or quoted input is prose.
function proseErrors(bp) {
    const errors = [];
    const prose = (n, where) => errors.push(`line ${n} is prose${where ? ` in ${where}` : ""}: write a list item or a table row of facts, references and values`);
    const allowed = {
        Inputs: (l) => /^- \*\*I\d+\*\*/.test(l) || /^\s*>/.test(l),
        Criteria: (l) => /^- \*\*C\d+\*\*/.test(l),
        Boundaries: (l) => isRow(l),
    };
    const title = bp.preamble.filter((l) => l.text.trim());
    title.forEach((l, i) => {
        if (i === 0 && /^# Blueprint: \S/.test(l.text)) return;
        if (!HEADER.test(l.text)) prose(l.n, "the header");
    });
    for (const [name, ls] of Object.entries(bp.sections)) {
        if (!allowed[name]) continue;
        let fence = false;
        for (const l of ls) {
            if (name === "Boundaries" && /^```/.test(l.text)) {
                fence = !fence;
                continue;
            }
            if (fence || !l.text.trim() || allowed[name](l.text)) continue;
            prose(l.n, `## ${name}`);
        }
        if (fence) errors.push(`## ${name} has an unclosed code block`);
    }
    return errors;
}

// `siblings` are the file names next to the blueprint: given, a child file that a row names must be among them.
export function check(text, templatePlaceholders = [], siblings = null) {
    const bp = parse(text);
    const errors = [];
    const has = (list, id) => list.some((x) => x.id === id);
    const tooLong = (id, what, value, limit) => value.length > limit && errors.push(`${id} ${what} is ${value.length} characters, max ${limit}: keep the value and its reference, drop the explanation`);

    if (!bp.preamble.some((l) => /^# Blueprint: \S/.test(l.text))) errors.push("missing title: # Blueprint: <short-name>");
    if (!bp.header) errors.push("missing header: Repo: <org>/<repo> | Created: <YYYY-MM-DD>");
    for (const name of SECTIONS) if (!bp.headings.includes(name)) errors.push(`missing section: ## ${name}`);
    for (const name of new Set(bp.headings)) {
        if (FORBIDDEN_SECTIONS.includes(name)) errors.push(`section ## ${name} is not allowed: fold its facts into the criterion or boundary row that needs them`);
        else if (!SECTIONS.includes(name)) errors.push(`unknown section: ## ${name}, allowed: ${SECTIONS.join(", ")}`);
    }
    for (const name of new Set(bp.headings.filter((h, i) => bp.headings.indexOf(h) !== i))) errors.push(`duplicate section: ## ${name}`);
    for (const p of templatePlaceholders) if (text.includes(p)) errors.push(`template placeholder left: ${p}`);
    errors.push(...proseErrors(bp));
    const bytes = Buffer.byteLength(text) - Buffer.byteLength((bp.sections.Inputs ?? []).map((l) => `${l.text}\n`).join(""));
    // A size goal, not a gate: a blueprint that passes it is easier to keep in view, but cutting content to pass it is worse.
    const warnings = [];
    if (bytes > LIMITS.preferredBytesWithoutInputs) warnings.push(`blueprint is ${bytes} bytes without its inputs, aim for ${LIMITS.preferredBytesWithoutInputs} or less: replace superseded text instead of keeping history (the old version goes to raw), drop explanations, or split the task`);

    for (const [kind, list] of [["I", bp.inputs], ["C", bp.criteria], ["B", bp.boundaries]]) {
        const seen = new Set();
        for (const { id } of list) {
            if (!new RegExp(`^${kind}\\d+$`).test(id)) errors.push(`bad id "${id}", expected ${kind}<n>`);
            else if (seen.has(id)) errors.push(`duplicate id ${id}`);
            seen.add(id);
        }
    }
    if (!bp.inputs.length) errors.push("no inputs: record the user's request verbatim as I1");
    if (!bp.criteria.length) errors.push("no criteria");
    for (const i of bp.inputs) {
        if (/Use the minime \w+ skill|Return: status \(/i.test(i.text)) errors.push(`${i.id} contains the dispatcher's prompt: record only the user's words`);
        // A child copies all of its parent's inputs, and the parent traces the ones the child's criteria don't use.
        if (!bp.header?.parent && !bp.tracedInputs.has(i.id)) errors.push(`${i.id} is not traced to any criterion or boundary`);
    }
    for (const c of bp.criteria) {
        if (!c.inputs.length) errors.push(`${c.id} names no origin, write ${c.id} (I1 "words from the input")`);
        for (const { id, quote } of c.inputs) {
            const input = bp.inputs.find((i) => i.id === id);
            if (!input) errors.push(`${c.id} references unknown input ${id}`);
            else if (quote === null) errors.push(`${c.id} cites ${id} without its words, write ${id} "words from the input"`);
            else if (quote.length < LIMITS.quoteMin || quote.length > LIMITS.quoteMax) errors.push(`${c.id} quote is ${quote.length} characters, use ${LIMITS.quoteMin} to ${LIMITS.quoteMax}`);
            else if (!squash(input.body).includes(squash(quote))) errors.push(`${c.id} quotes "${quote}" but ${id} does not contain those words`);
        }
        // A decision id in the origin or the sentence points at a row that no longer exists.
        for (const d of new Set([...c.decisions, ...refs(c.text.replace(/`[^`]*`/g, ""), "D")])) errors.push(`${c.id} cites ${d}, decisions are brackets now`);
        if (!/\bshall\b/.test(c.text)) errors.push(`${c.id} is not EARS: "When <trigger>, <owner> shall <response>."`);
        tooLong(c.id, "text", c.text, LIMITS.criterion);
        if (!bp.boundaries.some((b) => b.criteria.includes(c.id))) errors.push(`${c.id} is in no boundary`);
        if (!c.evidence.length) errors.push(`${c.id} has no evidence: end it with [ran: …], [data: …], [research: …], [user: I1] or [default: I1]`);
        for (const e of c.evidence) {
            if (!e.kind) errors.push(`${c.id} evidence "${e.raw.slice(0, 40)}" must be ran, data, research, user, default or open followed by ": <reference>"`);
            tooLong(c.id, "evidence", e.body, e.kind === "open" ? LIMITS.open : LIMITS.source);
            for (const { page, anchor } of processLinks(e.body)) {
                if (!PROCESS_PAGES.includes(page)) errors.push(`${c.id} links ${page}, which is not a process page: ${PROCESS_PAGES.join(", ")}`);
                else if (!anchor) errors.push(`${c.id} links ${page} without an anchor: write ${page}#<the rule's heading slug>`);
            }
        }
    }
    for (const b of bp.boundaries) {
        if (b.cells !== 5) errors.push(`${b.id} (line ${b.n}) has ${b.cells} cells, expected 5: write | inside a cell as \\|`);
        if (!CHANGES.includes(b.change)) errors.push(`${b.id} change must be ${CHANGES.join(", ")}`);
        if (!b.criteria.length) errors.push(`${b.id} names no criterion`);
        for (const c of b.criteria) if (!has(bp.criteria, c)) errors.push(`${b.id} references unknown criterion ${c}`);
        tooLong(b.id, "contract", b.contract, LIMITS.contract);
        if (b.child && siblings && !siblings.includes(b.child)) errors.push(`${b.id} delegates to ${b.child}, which does not exist next to the blueprint`);
    }

    const questions = openOf(bp);
    const sources = { ran: 0, data: 0, research: 0, wiki: 0, user: 0, default: 0, surprise: 0 };
    const brackets = bp.criteria.flatMap((c) => c.evidence);
    for (const { kind, body } of brackets) {
        if (kind in sources) sources[kind]++;
        if (kind === "research" && /^\w+\s*:\s*wiki\b/i.test(body)) sources.wiki++;
        // A run that contradicted its prediction: the most valuable thing to learn from.
        if (kind === "ran" && /\bsurprise\b/i.test(body)) sources.surprise++;
    }
    return {
        status: errors.length ? "invalid" : questions.length ? "questions" : "ready",
        errors,
        warnings,
        open: questions,
        sources,
        processCited: brackets.filter((e) => processLinks(e.body).length).length,
        counts: { inputs: bp.inputs.length, criteria: bp.criteria.length, boundaries: bp.boundaries.length },
        extracted: bp.header?.extracted ?? null,
        parent: bp.header?.parent ?? null,
        children: [...new Set(bp.boundaries.filter((b) => b.child).map((b) => b.child))],
    };
}

// check() on a file, with the file names next to it for the child files its rows name.
export function checkFile(file, templatePlaceholders = []) {
    return check(readFileSync(file, "utf8"), templatePlaceholders, readdirSync(path.dirname(path.resolve(file))));
}

// `|` splits a cell unless it sits in a code span or is escaped, as in splitRow.
function cellText(value) {
    let out = "";
    let inCode = false;
    for (const ch of String(value ?? "").replace(/\s+/g, " ").trim()) {
        if (ch === "`") inCode = !inCode;
        out += ch === "|" && !inCode && !out.endsWith("\\") ? "\\|" : ch;
    }
    return out;
}

const table = (head, rows) => [`| ${head.join(" | ")} |`, `|${head.map((h) => "-".repeat(h.length + 2)).join("|")}|`, ...rows.map((r) => `| ${r.map(cellText).join(" | ")} |`)];
const headingAt = (lines, name) => lines.findIndex((l) => l.match(/^## (.+?)\s*$/)?.[1] === name);

// Swaps the table rows of one section, keeping anything else in it (a Mermaid block). No rows and nothing else removes the section.
function withTable(text, section, rows) {
    const lines = text.split("\n");
    const at = headingAt(lines, section);
    if (at < 0) {
        if (!rows.length) return text;
        lines.splice(lines.length, 0, `## ${section}`, "", ...rows, "");
        return lines.join("\n");
    }
    const found = lines.findIndex((l, i) => i > at && /^## /.test(l));
    const end = found < 0 ? lines.length : found;
    const extra = lines.slice(at + 1, end).filter((l) => !isRow(l)).join("\n").trim();
    const block = rows.length || extra ? [lines[at], ...(rows.length ? ["", ...rows] : []), ...(extra ? ["", extra] : []), ""] : [];
    lines.splice(at, end - at, ...block);
    return lines.join("\n");
}

// Rewrites the Boundaries table from an edit. An edit that adds a check error is refused, and the
// blueprint loses its Extracted date because the extracted lessons no longer match it.
export function applyEdit(text, { boundaries = [] }) {
    const rows = (Array.isArray(boundaries) ? boundaries : []).map((b) => [b.id, b.owner, b.contract, b.change, [].concat(b.criteria ?? []).join(", ")]);
    const next = withTable(text, "Boundaries", rows.length ? table(["ID", "Owner", "Contract", "Change", "Criteria"], rows) : [])
        .replace(/^(Repo: \S+ \| Created: \d{4}-\d{2}-\d{2}(?: \| Parent: [^\s|]+)?) \| Extracted: \d{4}-\d{2}-\d{2}$/m, "$1");
    const before = new Set(check(text).errors);
    const errors = check(next).errors.filter((e) => !before.has(e));
    return errors.length ? { ok: false, errors } : { ok: true, text: next };
}

// A criterion has a test when a test file names its ID, as in `C1_rounds_up` or `// C1`, but not `C10`.
export const idPattern = (id) => `(^|[^A-Za-z0-9])${id}([^0-9]|$)`;
// A test sits in a directory named for tests or has a test file name (`test_x.py`, `x_test.go`, `x.test.js`, `XTest.java`).
// Matching the path as a whole would take `latest.py` and `inspect.py` for tests.
const TEST_DIRS = new Set(["test", "tests", "testing", "__tests__", "spec", "specs"]);
const TEST_NAME = /^(test_.*|.*_test\..*|.*\.test\..*|.*_spec\..*|.*\.spec\..*|tests\.py|conftest\.py)$/i;
const CAMEL_TEST_NAME = /^.*[a-z0-9]Tests?\.[^.]+$/;
export const isTestPath = (file) => {
    const parts = String(file).split("/");
    const name = parts.at(-1);
    return parts.slice(0, -1).some((dir) => TEST_DIRS.has(dir.toLowerCase())) || TEST_NAME.test(name) || CAMEL_TEST_NAME.test(name);
};

/* ── actions ── */

function filesNaming(id, { repo, files }) {
    const run = spawnSync("git", ["-C", repo, "grep", "--untracked", "-I", "-l", "-E", idPattern(id), "--", ...(files ?? [])], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    if (run.status > 1 || run.error) throw new Error(`git grep failed in ${repo}: ${(run.stderr || String(run.error)).trim()}`);
    return run.stdout.split("\n").filter((f) => f && isTestPath(f)).sort();
}

export function coverage(text, options) {
    const covered = parse(text).criteria.map(({ id }) => ({ id, files: filesNaming(id, options) }));
    const missing = covered.filter((c) => !c.files.length).map((c) => c.id);
    return { status: missing.length ? "missing" : "covered", missing, covered };
}

const git = (repo, ...args) => {
    const run = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    if (run.status !== 0 || run.error) throw new Error(`git ${args[0]} failed in ${repo}: ${String(run.stderr || run.error).trim()}`);
    return run.stdout;
};

// Lines that carry no structure of their own: blank, braces, imports. Duplicates made of them are noise.
const isFiller = (line) => !line || /^[\s{}()[\];,]*$/.test(line) || /^(import|from|#include|using|require)\b/.test(line);

// Added-line numbers per file from a zero-context diff.
export function addedLines(unifiedDiff) {
    const added = {};
    let file = null;
    let line = 0;
    for (const text of unifiedDiff.split("\n")) {
        if (text.startsWith("+++ ")) file = text.startsWith("+++ b/") ? text.slice(6) : null;
        else if (text.startsWith("@@")) line = Number(text.match(/\+(\d+)/)?.[1] ?? 0);
        else if (file && text.startsWith("+")) (added[file] ??= new Set()).add(line++);
        else if (file && !text.startsWith("-") && !text.startsWith("\\")) line++;
    }
    return added;
}

// Blocks of `size` significant lines that the change added and that also appear elsewhere in the changed files.
export function duplicates(contents, added, size = 4) {
    const windows = new Map();
    const significant = {};
    for (const [file, text] of Object.entries(contents)) {
        significant[file] = text.split("\n").map((t, i) => ({ n: i + 1, t: t.trim() })).filter((l) => !isFiller(l.t));
        const lines = significant[file];
        for (let i = 0; i + size <= lines.length; i++) {
            const key = lines.slice(i, i + size).map((l) => l.t).join("\n");
            (windows.get(key) ?? windows.set(key, []).get(key)).push({ file, n: lines[i].n, i });
        }
    }
    const found = [];
    for (const [file, lines] of Object.entries(significant)) {
        for (let i = 0; i + size <= lines.length; i++) {
            const block = lines.slice(i, i + size);
            if (!block.every((l) => added[file]?.has(l.n))) continue;
            const key = block.map((l) => l.t).join("\n");
            const others = windows.get(key).filter((w) => w.file !== file || Math.abs(w.i - i) >= size);
            if (!others.length) continue;
            found.push({ at: [`${file}:${block[0].n}`, ...others.map((w) => `${w.file}:${w.n}`)] });
            i += size - 1;
        }
    }
    return found;
}

// What the change adds and removes against HEAD, untracked files included. Read-only.
export function diff(repo) {
    const files = git(repo, "diff", "HEAD", "--numstat").split("\n").filter(Boolean).map((l) => l.split("\t"))
        .filter(([a]) => a !== "-").map(([a, r, file]) => ({ file, added: Number(a), removed: Number(r) }));
    const added = addedLines(git(repo, "diff", "HEAD", "-U0", "--no-color"));
    for (const file of git(repo, "ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean)) {
        const text = readFileSync(path.join(repo, file), "utf8");
        if (text.includes("\0")) continue;
        const count = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
        files.push({ file, added: count, removed: 0 });
        added[file] = new Set(Array.from({ length: count }, (_, i) => i + 1));
    }
    // Copies of existing code count too, so index the tracked files that share an extension with the change.
    const extensions = new Set(Object.keys(added).map((f) => path.extname(f)).filter(Boolean));
    const tracked = git(repo, "ls-files").split("\n").filter((f) => f && extensions.has(path.extname(f))).slice(0, 5000);
    const contents = {};
    for (const file of new Set([...Object.keys(added), ...tracked])) {
        try {
            const text = readFileSync(path.join(repo, file), "utf8");
            if (text.length <= 256 * 1024 && !text.includes("\0")) contents[file] = text;
        } catch { /* deleted in the working tree */ }
    }
    files.sort((a, b) => a.file.localeCompare(b.file));
    const testsCut = files.filter((f) => isTestPath(f.file) && f.removed > 0);
    return {
        added: files.reduce((n, f) => n + f.added, 0),
        removed: files.reduce((n, f) => n + f.removed, 0),
        testLinesRemoved: testsCut.reduce((n, f) => n + f.removed, 0),
        testFiles: testsCut.map((f) => f.file),
        files,
        duplicates: duplicates(contents, added),
    };
}

function main(argv) {
    const [cmd, file, ...rest] = argv;
    const opt = (name, fallback) => {
        const i = rest.indexOf(`--${name}`);
        return i >= 0 ? rest[i + 1] : fallback;
    };
    if (cmd === "diff") {
        const at = argv.indexOf("--repo");
        try {
            process.stdout.write(JSON.stringify(diff(path.resolve(at >= 0 ? argv[at + 1] : process.cwd())), null, 2) + "\n");
            return 0;
        } catch (error) {
            process.stdout.write(JSON.stringify({ status: "error", error: error.message }, null, 2) + "\n");
            return 2;
        }
    }
    if (!["check", "coverage"].includes(cmd) || !file) {
        process.stderr.write("usage: blueprint.mjs check <blueprint.md> | coverage <blueprint.md> [--repo dir] [--files a,b] | diff [--repo dir]\n");
        return 2;
    }
    if (cmd === "check") {
        const out = checkFile(file, placeholders(readFileSync(TEMPLATE, "utf8")));
        process.stdout.write(JSON.stringify({ file, ...out }, null, 2) + "\n");
        return out.errors.length ? 1 : 0;
    }
    const text = readFileSync(file, "utf8");
    try {
        const out = coverage(text, { repo: path.resolve(opt("repo", process.cwd())), files: opt("files")?.split(",") });
        process.stdout.write(JSON.stringify({ file, ...out }, null, 2) + "\n");
        return out.missing.length ? 1 : 0;
    } catch (error) {
        process.stdout.write(JSON.stringify({ file, status: "error", error: error.message }, null, 2) + "\n");
        return 2;
    }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = main(process.argv.slice(2));
