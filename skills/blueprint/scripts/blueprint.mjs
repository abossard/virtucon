#!/usr/bin/env node
// Blueprint check, coverage and working-tree fingerprint. No dependencies.
//   node blueprint.mjs check       <blueprint.md>
//   node blueprint.mjs coverage    <blueprint.md> [--repo <dir>] [--files a,b]
//   node blueprint.mjs fingerprint [--repo <dir>]
// Prints one JSON object. Exit 0 = ok, 1 = errors or criteria without a test, 2 = usage.

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SECTIONS = ["Inputs", "Criteria", "Boundaries", "Decisions", "Constraints", "Out of scope"];
// Characters per item. The blueprint holds facts, references and values, so long cells are errors.
export const LIMITS = { criterion: 200, question: 100, answer: 140, source: 120, contract: 160, bullet: 140, quoteMin: 3, quoteMax: 60 };
const SOURCE_KINDS = ["data", "research", "user"];
const CHANGES = ["new", "changed", "unchanged"];
const HEADER = /^Repo: (\S+) \| Created: (\d{4}-\d{2}-\d{2})(?: \| Extracted: (\d{4}-\d{2}-\d{2}))?$/;
const BULLET_SOURCE = /\((?:I\d+(?:,\s*I\d+)*|(?:data|research|user):\s*[^()]+)\)$/;
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

// A criterion's origin is `I1 "words from the input", D3`. Quoted words belong to the input id before them.
export function criterionRefs(group) {
    const inputs = [];
    const decisions = [];
    for (const m of String(group).matchAll(/\b(I\d+)\b(?:\s*"([^"]*)")?|\b(D\d+)\b/g)) {
        if (m[1]) inputs.push({ id: m[1], quote: m[2] ?? null });
        else if (m[3]) decisions.push(m[3]);
    }
    return { inputs, decisions };
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
        header: header && { repo: header[1], created: header[2], extracted: header[3] ?? null },
        inputs: bullets("Inputs", "I").map((m) => ({ id: m[1], text: inputTexts[m[1]] ?? "", body: inputBodies[m[1]] ?? "" })),
        criteria: bullets("Criteria", "C").map((m) => ({ id: m[1], ...criterionRefs(m[2] ?? ""), text: m[3] })),
        boundaries: rows("Boundaries").map(({ n, cells: c }) => ({ n, id: c[0], owner: c[1] ?? "", contract: c[2] ?? "", change: c[3] ?? "", criteria: refs(c[4] ?? "", "C"), cells: c.length })),
        decisions: rows("Decisions").map(({ n, cells: c }) => ({ n, id: c[0], question: c[1] ?? "", answer: c[2] ?? "", source: c[3] ?? "", cells: c.length })),
        constraints: lines("Constraints").filter((l) => l.startsWith("- ")),
        outOfScope: lines("Out of scope").filter((l) => l.startsWith("- ")),
        tracedInputs: new Set(
            Object.entries(sections).filter(([name]) => name !== "Inputs").flatMap(([, ls]) => refs(ls.map((l) => l.text).join("\n"), "I")),
        ),
    };
}

const isOpen = (d) => /^open\b/i.test(d.answer) || /^user:\s*pending\b/i.test(d.source);

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
        Decisions: (l) => isRow(l),
        Constraints: (l) => l.startsWith("- ") || l.trim() === "None.",
        "Out of scope": (l) => l.startsWith("- ") || l.trim() === "None.",
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

export function check(text, templatePlaceholders = []) {
    const bp = parse(text);
    const errors = [];
    const has = (list, id) => list.some((x) => x.id === id);
    const tooLong = (id, what, value, limit) => value.length > limit && errors.push(`${id} ${what} is ${value.length} characters, max ${limit}: keep the value and its reference, drop the explanation`);

    if (!bp.preamble.some((l) => /^# Blueprint: \S/.test(l.text))) errors.push("missing title: # Blueprint: <short-name>");
    if (!bp.header) errors.push("missing header: Repo: <org>/<repo> | Created: <YYYY-MM-DD>");
    for (const name of SECTIONS) if (!bp.headings.includes(name)) errors.push(`missing section: ## ${name}`);
    for (const name of bp.headings) {
        if (name === "Tests") errors.push("section ## Tests is not allowed: tests live in the code and name their criterion ID");
        else if (!SECTIONS.includes(name)) errors.push(`unknown section: ## ${name}, allowed: ${SECTIONS.join(", ")}`);
    }
    for (const name of new Set(bp.headings.filter((h, i) => bp.headings.indexOf(h) !== i))) errors.push(`duplicate section: ## ${name}`);
    for (const p of templatePlaceholders) if (text.includes(p)) errors.push(`template placeholder left: ${p}`);
    errors.push(...proseErrors(bp));

    for (const [kind, list] of [["I", bp.inputs], ["C", bp.criteria], ["B", bp.boundaries], ["D", bp.decisions]]) {
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
        if (!bp.tracedInputs.has(i.id)) errors.push(`${i.id} is not traced to any criterion, decision, constraint or out-of-scope item`);
    }
    for (const c of bp.criteria) {
        if (!c.inputs.length && !c.decisions.length) errors.push(`${c.id} names no origin, write ${c.id} (I1 "words from the input")`);
        for (const { id, quote } of c.inputs) {
            const input = bp.inputs.find((i) => i.id === id);
            if (!input) errors.push(`${c.id} references unknown input ${id}`);
            else if (quote === null) errors.push(`${c.id} cites ${id} without its words, write ${id} "words from the input"`);
            else if (quote.length < LIMITS.quoteMin || quote.length > LIMITS.quoteMax) errors.push(`${c.id} quote is ${quote.length} characters, use ${LIMITS.quoteMin} to ${LIMITS.quoteMax}`);
            else if (!squash(input.body).includes(squash(quote))) errors.push(`${c.id} quotes "${quote}" but ${id} does not contain those words`);
        }
        for (const d of c.decisions) if (!has(bp.decisions, d)) errors.push(`${c.id} references unknown decision ${d}`);
        if (!/\bshall\b/.test(c.text)) errors.push(`${c.id} is not EARS: "When <trigger>, <owner> shall <response>."`);
        tooLong(c.id, "text", c.text, LIMITS.criterion);
        if (!bp.boundaries.some((b) => b.criteria.includes(c.id))) errors.push(`${c.id} is in no boundary`);
    }
    for (const b of bp.boundaries) {
        if (b.cells !== 5) errors.push(`${b.id} (line ${b.n}) has ${b.cells} cells, expected 5: write | inside a cell as \\|`);
        if (!CHANGES.includes(b.change)) errors.push(`${b.id} change must be ${CHANGES.join(", ")}`);
        if (!b.criteria.length) errors.push(`${b.id} names no criterion`);
        for (const c of b.criteria) if (!has(bp.criteria, c)) errors.push(`${b.id} references unknown criterion ${c}`);
        tooLong(b.id, "contract", b.contract, LIMITS.contract);
    }
    for (const d of bp.decisions) {
        if (d.cells !== 4) errors.push(`${d.id} (line ${d.n}) has ${d.cells} cells, expected 4: write | inside a cell as \\|`);
        const m = d.source.match(/^(\w+)\s*:\s*(\S.*)$/);
        if (!m || !SOURCE_KINDS.includes(m[1].toLowerCase())) errors.push(`${d.id} source must be ${SOURCE_KINDS.join(", ")} followed by ": <reference>"`);
        if (!d.answer.trim()) errors.push(`${d.id} has no answer`);
        tooLong(d.id, "question", d.question, LIMITS.question);
        tooLong(d.id, "answer", d.answer, LIMITS.answer);
        tooLong(d.id, "source", d.source, LIMITS.source);
    }
    for (const [name, list] of [["Constraints", bp.constraints], ["Out of scope", bp.outOfScope]]) {
        for (const item of list) {
            if (!BULLET_SOURCE.test(item)) errors.push(`${name}: "${item.slice(0, 40)}" must end with its source: (I1) or (data: path:line)`);
            tooLong(name, `item "${item.slice(2, 22)}"`, item.slice(2), LIMITS.bullet);
        }
    }

    const open = bp.decisions.filter(isOpen).map(({ id, question, answer }) => ({ id, question, answer }));
    const sources = { data: 0, research: 0, wiki: 0, user: 0 };
    for (const d of bp.decisions) {
        const kind = d.source.match(/^(\w+)\s*:/)?.[1]?.toLowerCase();
        if (kind in sources) sources[kind]++;
        if (kind === "research" && /^\w+\s*:\s*wiki\b/i.test(d.source)) sources.wiki++;
    }
    return {
        status: errors.length ? "invalid" : open.length ? "questions" : "ready",
        errors,
        open,
        sources,
        counts: { inputs: bp.inputs.length, criteria: bp.criteria.length, boundaries: bp.boundaries.length, decisions: bp.decisions.length },
        // Criteria that quote no input come from a decision: the scope the user did not word themselves.
        derived: bp.criteria.filter((c) => !c.inputs.length).map((c) => c.id),
        extracted: bp.header?.extracted ?? null,
    };
}

// A criterion has a test when a test file names its ID, as in `C1_rounds_up` or `// C1`, but not `C10`.
export const idPattern = (id) => `(^|[^A-Za-z0-9])${id}([^0-9]|$)`;
export const isTestPath = (file) => /test|spec/i.test(file);

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

// Same output before and after a probe means the working tree is back to the builder's bytes.
export function fingerprint(repo) {
    const git = (...args) => {
        const run = spawnSync("git", ["-C", repo, ...args], { maxBuffer: 256 * 1024 * 1024 });
        if (run.status !== 0 || run.error) throw new Error(`git ${args[0]} failed in ${repo}: ${String(run.stderr || run.error).trim()}`);
        return run.stdout;
    };
    const hash = createHash("sha256");
    hash.update(git("diff", "HEAD", "--binary"));
    const untracked = git("ls-files", "--others", "--exclude-standard", "-z").toString("utf8").split("\0").filter(Boolean).sort();
    for (const file of untracked) hash.update(`\0${file}\0`).update(readFileSync(path.join(repo, file)));
    return { fingerprint: hash.digest("hex"), untracked: untracked.length };
}

function main(argv) {
    const [cmd, file, ...rest] = argv;
    const opt = (name, fallback) => {
        const i = rest.indexOf(`--${name}`);
        return i >= 0 ? rest[i + 1] : fallback;
    };
    if (cmd === "fingerprint") {
        const at = argv.indexOf("--repo");
        try {
            process.stdout.write(JSON.stringify(fingerprint(path.resolve(at >= 0 ? argv[at + 1] : process.cwd())), null, 2) + "\n");
            return 0;
        } catch (error) {
            process.stdout.write(JSON.stringify({ status: "error", error: error.message }, null, 2) + "\n");
            return 2;
        }
    }
    if (!["check", "coverage"].includes(cmd) || !file) {
        process.stderr.write("usage: blueprint.mjs check <blueprint.md> | coverage <blueprint.md> [--repo dir] [--files a,b] | fingerprint [--repo dir]\n");
        return 2;
    }
    const text = readFileSync(file, "utf8");
    if (cmd === "check") {
        const out = check(text, placeholders(readFileSync(TEMPLATE, "utf8")));
        process.stdout.write(JSON.stringify({ file, ...out }, null, 2) + "\n");
        return out.errors.length ? 1 : 0;
    }
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
