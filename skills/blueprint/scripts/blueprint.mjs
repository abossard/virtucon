#!/usr/bin/env node
// Blueprint check and verify. No dependencies.
//   node blueprint.mjs check  <blueprint.md>
//   node blueprint.mjs verify <blueprint.md> [--cwd <repo>] [--only T1,T2] [--by <phase>] [--timeout <seconds>]
// Prints one JSON object. Exit 0 = ok, 1 = errors or failing checks, 2 = usage.

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SECTIONS = ["Inputs", "Criteria", "Boundaries", "Tests", "Decisions", "Constraints", "Out of scope"];
const SOURCE_KINDS = ["data", "research", "user"];
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

function tableRows(lines) {
    return lines
        .filter((l) => l.trim().startsWith("|") && !/^\|\s*:?-/.test(l.trim()))
        .map(splitRow)
        .filter((cells) => cells[0] !== "ID");
}

export function parse(text) {
    const sections = {};
    let current = null;
    for (const line of text.split("\n")) {
        const heading = line.match(/^## (.+?)\s*$/);
        if (heading) {
            current = heading[1];
            sections[current] = [];
        } else if (current) {
            sections[current].push(line);
        }
    }
    const lines = (name) => sections[name] ?? [];
    const bullets = (name, kind) =>
        lines(name)
            .map((l) => l.match(new RegExp(`^- \\*\\*(${kind}\\d+)\\*\\*\\s*(?:\\(([^)]*)\\))?\\s*:?\\s*(.*)$`)))
            .filter(Boolean);
    return {
        sections: Object.keys(sections),
        inputs: bullets("Inputs", "I").map((m) => ({ id: m[1] })),
        criteria: bullets("Criteria", "C").map((m) => ({ id: m[1], inputs: refs(m[2] ?? "", "I"), text: m[3] })),
        boundaries: tableRows(lines("Boundaries")).map((c) => ({ id: c[0], criteria: refs(c[4] ?? "", "C") })),
        tests: tableRows(lines("Tests")).map((c) => ({
            id: c[0], criteria: refs(c[1] ?? "", "C"), boundaries: refs(c[2] ?? "", "B"),
            cases: c[3] ?? "", check: c[4] ?? "", result: c[5] ?? "",
        })),
        decisions: tableRows(lines("Decisions")).map((c) => ({ id: c[0], question: c[1] ?? "", answer: c[2] ?? "", source: c[3] ?? "" })),
        tracedInputs: new Set(
            Object.entries(sections).filter(([name]) => name !== "Inputs").flatMap(([, ls]) => refs(ls.join("\n"), "I")),
        ),
    };
}

export const commandOf = (check) => check.match(/`([^`]+)`/)?.[1].replaceAll("\\|", "|") ?? null;
const isReview = (check) => /^review:\s*\S/i.test(check);
const isOpen = (d) => /^open\b/i.test(d.answer) || /^user:\s*pending\b/i.test(d.source);

export function placeholders(templateText) {
    return [...new Set([...templateText.matchAll(/<[^<>\n]+>/g)].map((m) => m[0]))];
}

export function check(text, templatePlaceholders = []) {
    const bp = parse(text);
    const errors = [];
    const has = (list, id) => list.some((x) => x.id === id);

    for (const name of SECTIONS) if (!bp.sections.includes(name)) errors.push(`missing section: ## ${name}`);
    for (const p of templatePlaceholders) if (text.includes(p)) errors.push(`template placeholder left: ${p}`);
    for (const [kind, list] of [["I", bp.inputs], ["C", bp.criteria], ["B", bp.boundaries], ["T", bp.tests], ["D", bp.decisions]]) {
        const seen = new Set();
        for (const { id } of list) {
            if (!new RegExp(`^${kind}\\d+$`).test(id)) errors.push(`bad id "${id}", expected ${kind}<n>`);
            else if (seen.has(id)) errors.push(`duplicate id ${id}`);
            seen.add(id);
        }
    }
    if (!bp.inputs.length) errors.push("no inputs: record the user's request verbatim as I1");
    if (!bp.criteria.length) errors.push("no criteria");
    for (const i of bp.inputs) if (!bp.tracedInputs.has(i.id)) errors.push(`${i.id} is not traced to any criterion, decision, constraint or out-of-scope item`);
    for (const c of bp.criteria) {
        if (!c.inputs.length) errors.push(`${c.id} names no input, write "${c.id} (I1): ..."`);
        for (const i of c.inputs) if (!has(bp.inputs, i)) errors.push(`${c.id} references unknown input ${i}`);
        if (!bp.tests.some((t) => t.criteria.includes(c.id))) errors.push(`${c.id} has no test`);
    }
    for (const b of bp.boundaries) for (const c of b.criteria) if (!has(bp.criteria, c)) errors.push(`${b.id} references unknown criterion ${c}`);
    for (const t of bp.tests) {
        if (!t.criteria.length) errors.push(`${t.id} names no criterion`);
        for (const c of t.criteria) if (!has(bp.criteria, c)) errors.push(`${t.id} references unknown criterion ${c}`);
        if (!t.boundaries.length) errors.push(`${t.id} names no boundary`);
        for (const b of t.boundaries) if (!has(bp.boundaries, b)) errors.push(`${t.id} references unknown boundary ${b}`);
        if (!t.cases.trim()) errors.push(`${t.id} has no cases`);
        if (!commandOf(t.check) && !isReview(t.check)) errors.push(`${t.id} check must be a \`command\` or "review: <what to inspect>"`);
        if (!/^(pending|pass|fail)\b/i.test(t.result)) errors.push(`${t.id} result must start with pending, pass or fail`);
    }
    for (const d of bp.decisions) {
        const m = d.source.match(/^(\w+)\s*:\s*(\S.*)$/);
        if (!m || !SOURCE_KINDS.includes(m[1].toLowerCase())) errors.push(`${d.id} source must be ${SOURCE_KINDS.join(", ")} followed by ": <reference>"`);
        if (!d.answer.trim()) errors.push(`${d.id} has no answer`);
    }

    const open = bp.decisions.filter(isOpen).map(({ id, question, answer }) => ({ id, question, answer }));
    const sources = { data: 0, research: 0, wiki: 0, user: 0 };
    for (const d of bp.decisions) {
        const kind = d.source.match(/^(\w+)\s*:/)?.[1]?.toLowerCase();
        if (kind in sources) sources[kind]++;
        if (kind === "research" && /^\w+\s*:\s*wiki\b/i.test(d.source)) sources.wiki++;
    }
    const results = bp.tests.map((t) => t.result.split(/\s/)[0].toLowerCase());
    const status = errors.length ? "invalid"
        : open.length ? "questions"
        : results.includes("fail") ? "failing"
        : results.includes("pending") ? "pending"
        : "verified";
    return {
        status, errors, open, sources,
        tests: { total: results.length, pass: results.filter((r) => r === "pass").length, fail: results.filter((r) => r === "fail").length, pending: results.filter((r) => r === "pending").length },
    };
}

export function setResults(text, results) {
    return text.split("\n").map((line) => {
        if (!line.trim().startsWith("|")) return line;
        const cells = splitRow(line);
        const result = results[cells[0]];
        if (!result || cells.length < 6) return line;
        cells[5] = result;
        return `| ${cells.join(" | ")} |`;
    }).join("\n");
}

/* ── actions ── */

function runCheck({ id, command }, { cwd, by, timeout, runsDir, runsRel }) {
    const started = new Date();
    const run = spawnSync(command, { cwd, shell: true, encoding: "utf8", timeout: timeout * 1000, maxBuffer: 16 * 1024 * 1024 });
    const exit = run.status ?? (run.signal ? `signal ${run.signal}` : "error");
    const stamp = started.toISOString().slice(0, 16).replace("T", " ");
    const log = `${id}.log`;
    writeFileSync(path.join(runsDir, log), [
        `$ ${command}`, `cwd: ${cwd}`, `by: ${by}`, `at: ${started.toISOString()}`, `exit: ${exit}`, "",
        run.stdout ?? "", run.stderr ?? "", run.error ? String(run.error) : "",
    ].join("\n"));
    const verdict = exit === 0 ? "pass" : "fail";
    return { exit, result: `${verdict} (${by} ${stamp}) [log](${runsRel}/${log})` };
}

// Rows that repeat one command share one run, so a single harness covers every criterion it asserts.
export function groupByCommand(tests) {
    const groups = new Map();
    for (const t of tests) {
        const command = commandOf(t.check);
        groups.set(command, [...(groups.get(command) ?? []), t.id]);
    }
    return [...groups].map(([command, ids]) => ({ command, ids, id: ids.join("+") }));
}

function verify(file, { cwd, only, by, timeout }) {
    const text = readFileSync(file, "utf8");
    const before = check(text, placeholders(readFileSync(TEMPLATE, "utf8")));
    if (before.errors.length) return { ...before, results: [] };
    const base = path.basename(file, ".md");
    const runsDir = path.join(path.dirname(file), `${base}.runs`);
    mkdirSync(runsDir, { recursive: true });
    const tests = parse(text).tests.filter((t) => commandOf(t.check) && (!only || only.includes(t.id)));
    const results = groupByCommand(tests).flatMap((group) => {
        const run = runCheck(group, { cwd, by, timeout, runsDir, runsRel: `${base}.runs` });
        return group.ids.map((id) => ({ id, ...run }));
    });
    const updated = setResults(text, Object.fromEntries(results.map((r) => [r.id, r.result])));
    writeFileSync(file, updated);
    return { ...check(updated), results };
}

function main(argv) {
    const [cmd, file, ...rest] = argv;
    const opt = (name, fallback) => {
        const i = rest.indexOf(`--${name}`);
        return i >= 0 ? rest[i + 1] : fallback;
    };
    if (!["check", "verify"].includes(cmd) || !file) {
        process.stderr.write("usage: blueprint.mjs check|verify <blueprint.md> [--cwd dir] [--only T1,T2] [--by phase] [--timeout s]\n");
        return 2;
    }
    const out = cmd === "check"
        ? check(readFileSync(file, "utf8"), placeholders(readFileSync(TEMPLATE, "utf8")))
        : verify(file, {
            cwd: path.resolve(opt("cwd", process.cwd())),
            only: opt("only")?.split(","),
            by: opt("by", "run"),
            timeout: Number(opt("timeout", 600)),
        });
    process.stdout.write(JSON.stringify({ file, ...out }, null, 2) + "\n");
    return out.errors.length || out.status === "failing" ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = main(process.argv.slice(2));
