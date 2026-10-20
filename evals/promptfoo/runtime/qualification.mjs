import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parseJsonObject, parseJsonlRecords, phaseForWorker } from "./launch.mjs";

// Where the retained HQ is mounted for the agent (launch.mjs HQ_MOUNT).
const HQ_MOUNT = "/work/hq";
const NATIVE_EVENT_TYPE = /^(session|assistant|user|tool|subagent|skill|hook|model)\.[a-z_]+$/;

const RESULT_FIELDS = ["status", "blueprint_path", "changed_files", "blocking_issue", "evidence_excerpts"];
const NULLISH = /^(null|none|n\/a|""|''|`{0,2}|\[\s*\])$/i;
const TOPIC_FILE = /(^|\/)wiki\/.+\.md$/i;
const NAVIGATION_FILE = /(^|\/)(index|log|readme)\.md$/i;
const OK_WORKER_STATUS = new Set(["completed", "idle", "done", "success", "succeeded"]);
const BOOTSTRAP_FILE = /(^|\/)(templates?|schema|blueprints?|_[^/]+)(\/|$)|(^|\/)(readme|index|log|schema)(\.[a-z]+)?$|(^|\/)\.gitkeep$/i;
const ABSTENTION = /(no\b.{0,40}(material|reusable|retain|lesson)|nothing\b.{0,40}(retain|reusable)|abstain)/i;

function stripTicks(value) {
    return String(value ?? "").trim().replace(/^[`"'\s]+|[`"'\s,]+$/g, "");
}

// Balanced, string-aware object slices; braces inside JSON strings do not end an object.
function jsonObjectSlices(source) {
    const slices = [];
    for (let start = source.indexOf("{"); start !== -1; start = source.indexOf("{", start + 1)) {
        let depth = 0;
        let inString = false;
        for (let i = start; i < source.length; i++) {
            const char = source[i];
            if (inString) {
                if (char === "\\") i++;
                else if (char === '"') inString = false;
            } else if (char === '"') inString = true;
            else if (char === "{") depth++;
            else if (char === "}" && --depth === 0) {
                slices.push({ start, end: i + 1, text: source.slice(start, i + 1) });
                break;
            }
        }
    }
    return slices;
}

const flat = (value) => (Array.isArray(value) ? value.join(" ") : String(value ?? ""));

// Reads the five-field phase result from JSON, `field: value` lines or a `| field | value |` table.
export function parsePhaseResult(text) {
    const source = String(text ?? "");
    const slices = jsonObjectSlices(source).map((slice) => ({ ...slice, value: parseJsonObject(slice.text) }));
    const candidates = [parseJsonObject(source.trim()), ...slices.map((slice) => slice.value)];
    const jsonResults = candidates.filter((value) => value && RESULT_FIELDS.every((field) => field in value));
    // Legacy key-value/table results are read only outside parsed JSON objects, so quoted evidence stays data.
    let outside = source;
    for (const slice of slices.filter((item) => item.value).sort((a, b) => b.start - a.start)) outside = `${outside.slice(0, slice.start)} ${outside.slice(slice.end)}`;
    const lineFound = {};
    let invalid = new Set(jsonResults.map((value) => JSON.stringify(RESULT_FIELDS.map((field) => value[field])))).size > 1;
    for (const field of RESULT_FIELDS) {
        const matches = [
            ...outside.matchAll(new RegExp(`^[\\s>*-]*\`?${field}\`?\\s*[:=]\\s*(.*)$`, "gim")),
            ...outside.matchAll(new RegExp(`\\|\\s*\`?${field}\`?\\s*\\|\\s*(.*?)\\s*\\|`, "gi")),
        ];
        if (field !== "evidence_excerpts" && new Set(matches.map((match) => stripTicks(match[1]).toLowerCase())).size > 1) invalid = true;
        if (matches.length > 0) lineFound[field] = matches[0][1];
    }
    const lineComplete = RESULT_FIELDS.every((field) => field in lineFound);
    // Every complete representation must agree on all five fields (paths are case-sensitive) before one is chosen.
    const loose = (value) => flat(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
    // File paths keep their case; only list syntax is normalized.
    const files = (value) => (flat(value).match(/[A-Za-z0-9./_-]+/g) ?? []).join("|");
    const decision = (value) => JSON.stringify([
        loose(value.status),
        (NULLISH.test(stripTicks(flat(value.blueprint_path))) ? "" : stripTicks(flat(value.blueprint_path))),
        loose(NULLISH.test(stripTicks(flat(value.blocking_issue))) ? "" : value.blocking_issue),
        files(value.changed_files),
        loose(value.evidence_excerpts),
    ]);
    const representations = [...jsonResults, ...(lineComplete ? [lineFound] : [])];
    if (new Set(representations.map(decision)).size > 1) invalid = true;
    const found = representations[0] ?? lineFound;
    const complete = !invalid && RESULT_FIELDS.every((field) => field in found);
    const status = complete ? stripTicks(typeof found.status === "string" ? found.status : "").toLowerCase() : null;
    const blueprint = complete && typeof found.blueprint_path === "string" ? stripTicks(found.blueprint_path) : null;
    const blocking = complete ? found.blocking_issue : null;
    return {
        complete,
        invalid,
        status: ["done", "blocked", "failed"].includes(status) ? status : null,
        blueprintPath: blueprint && !NULLISH.test(blueprint) ? blueprint : null,
        blockingIssue: blocking === null || blocking === undefined || NULLISH.test(stripTicks(blocking)) ? null : String(blocking),
        changedFiles: complete ? flat(found.changed_files).replace(/[^A-Za-z0-9./_-]+/g, "|") : "",
        evidenceText: complete ? String(Array.isArray(found.evidence_excerpts) ? found.evidence_excerpts.join(" ") : found.evidence_excerpts) : "",
    };
}

// Risk tier is uncertainty, not a verdict. Acceptance needs positive accepted criterion IDs and no explicit unresolved requirement.
export function parseAcceptance(text) {
    // Native results are JSON text, so line breaks inside strings arrive as a literal backslash-n.
    const source = String(text ?? "").replace(/\\n/g, "\n");
    const listed = source.match(/accepted[ _-]*criteri(?:on|a)(?:[ _-]*ids?)?[ \t:=*"'`]*(?:\[([^\]]*)\]|([^\n]*))/i);
    const acceptedIds = listed ? (`${listed[1] ?? listed[2] ?? ""}`.match(/[A-Za-z][A-Za-z0-9]*-[A-Za-z0-9.-]*\d/g) ?? []) : [];
    // Affirmative archive statement: criteria listed as moved to / archived in the Criteria archive (the accepted-criteria store).
    const archivedPattern = /([A-Za-z][A-Za-z0-9]*-\d+(?:(?:\.\.|\s*,\s*|\s+and\s+)(?:[A-Za-z][A-Za-z0-9]*-)?\d+)*)\s+(?:(?:were|was|are|have been)\s+)?(?:moved to|archived (?:in|to))\s+(?:the\s+)?criteria archive/gi;
    for (const archived of source.matchAll(archivedPattern)) {
        const clause = source.slice(0, archived.index).split(/[.;\n]/).pop();
        if (/\b(neither|nor|not|never|no|if|would|could|should|example|e\.g|hypothetical|suppose|once|when)\b/i.test(clause)) continue;
        for (const part of archived[1].split(/\s*,\s*|\s+and\s+/i)) {
            const range = part.match(/^([A-Za-z][A-Za-z0-9]*-)(\d+)\.\.(?:[A-Za-z][A-Za-z0-9]*-)?(\d+)$/);
            if (range) for (let n = Number(range[2]); n <= Number(range[3]); n++) acceptedIds.push(`${range[1]}${n}`);
            else acceptedIds.push(part);
        }
    }
    const affirmed = source.replace(/\b(?:no|none|zero|without)\s+(?:[\w-]+\s+){0,2}?(?:remain(?:s|ing)?\s+)?(?=unresolved|failed|open|incomplete|active|unfinished)\w+/gi, "");
    const unresolved = /(?<!\b(?:no|zero|without|0)\s)(?<!\bnot\s)\b(unresolved|remains?\s+(?:failed|open|incomplete|active)|remaining\s+active|still\s+active|unfinished|not\s+(?:yet\s+)?(?:accepted|archived|moved)|criteri(?:on|a)\s+(?:failed|not met))\b/i.test(affirmed);
    return { acceptedIds: [...new Set(acceptedIds)], unresolved };
}

export function parseRiskTier(text) {
    const match = String(text ?? "").match(/risk[ _-]*tier[^A-Za-z]{0,40}(low|medium|high)\b/i);
    return match ? match[1].toLowerCase() : null;
}

function resultParts(data = {}) {
    const result = parseJsonObject(data.result) ?? parseJsonObject(data.output) ?? {};
    const parts = [result.content, result.detailedContent].filter((value) => typeof value === "string");
    if (parts.length === 0 && typeof data.result === "string") parts.push(data.result);
    return parts;
}

function resultText(data = {}) {
    return resultParts(data).join("\n");
}

// Each channel or source is parsed alone; any invalid parse or disagreement between complete results is terminal, never a fallback to the first.
export function mergePhaseResults(texts) {
    const results = texts.map(parsePhaseResult);
    const complete = results.filter((result) => result.complete);
    const signature = (result) => JSON.stringify([result.status, result.blueprintPath, result.blockingIssue, result.changedFiles, result.evidenceText]);
    const conflicting = results.some((result) => result.invalid) || new Set(complete.map(signature)).size > 1;
    return { ...(conflicting ? parsePhaseResult("") : complete[0] ?? parsePhaseResult("")), invalid: conflicting };
}

function collectWorkers(jsonRecords) {
    const workers = new Map();
    jsonRecords.forEach((record, index) => {
        const type = String(record?.type ?? "").toLowerCase();
        const data = record?.data ?? {};
        const toolCallId = typeof data.toolCallId === "string" ? data.toolCallId : null;
        if (!toolCallId) return;
        if (type === "tool.execution_start" && data.toolName === "task") {
            const args = parseJsonObject(data.arguments) ?? parseJsonObject(data.argumentsJson) ?? {};
            const agentType = typeof args.agent_type === "string" ? args.agent_type.trim() : null;
            const name = typeof args.name === "string" ? args.name.trim() : null;
            const phase = phaseForWorker({ name, agentType });
            if (phase && !workers.has(toolCallId)) {
                workers.set(toolCallId, {
                    phase,
                    toolCallId,
                    agentType,
                    background: String(args.mode ?? "").toLowerCase() === "background",
                    startAt: index,
                    completeAt: null,
                    success: null,
                    workerStatus: null,
                    domain: null,
                });
            }
        } else if (type === "tool.execution_complete" && workers.has(toolCallId)) {
            const worker = workers.get(toolCallId);
            const text = resultText(data);
            const structured = parseJsonObject(data.result) ?? parseJsonObject(data.output) ?? {};
            const harnessStatus = structured.status ?? text.match(/(?:^|\n)\s*agent_status:\s*([a-z_ -]+)/i)?.[1];
            worker.completeAt = index;
            worker.success = data.success !== false;
            worker.workerStatus = typeof harnessStatus === "string" ? harnessStatus.trim().toLowerCase() : null;
            worker.domain = mergePhaseResults(resultParts(data));
            worker.riskTier = parseRiskTier(text);
            worker.acceptance = parseAcceptance(text);
        }
    });
    return [...workers.values()].sort((a, b) => a.startAt - b.startAt);
}

// Observes completion boundaries only. It never dispatches, retries or fakes a phase.
export function auditQualification({ jsonRecords }) {
    const workers = collectWorkers(jsonRecords);
    const violations = [];
    const flag = (code, worker, detail = null) => violations.push({ code, phase: worker?.phase ?? null, toolCallId: worker?.toolCallId ?? null, detail });
    if (workers.length === 0) flag("no-native-phase-workers", null, "No native task dispatch for a phase was observed.");

    const blueprintPaths = new Set();
    let state = "start";
    let correctionLoops = 0;
    let previous = null;
    for (const worker of workers) {
        const terminal = worker.completeAt !== null;
        if (!terminal) flag("worker-not-completed", worker);
        else if (!worker.success) flag("worker-failed", worker);
        if (worker.workerStatus === "running") flag("worker-running", worker, worker.workerStatus);
        else if (worker.workerStatus && !OK_WORKER_STATUS.has(worker.workerStatus)) flag("worker-unsuccessful-status", worker, worker.workerStatus);
        if (previous && (previous.completeAt === null || worker.startAt < previous.completeAt)) {
            flag("overlap", worker, `started before ${previous.phase} completed`);
        }
        previous = worker;
        if (worker.phase === "inspect" && !/(^|:)frau$/i.test(worker.agentType ?? "")) flag("inspect-not-frau", worker, worker.agentType);

        const domain = worker.domain;
        const settled = terminal && worker.success && (!worker.workerStatus || OK_WORKER_STATUS.has(worker.workerStatus));
        const domainDone = Boolean(domain?.complete && domain.status === "done" && !domain.blockingIssue);
        if (settled) {
            if (!domain?.complete || !domain.status) flag("domain-result-missing", worker);
            else if (domain.status === "done" && domain.blockingIssue) flag("unresolved-blocker", worker, domain.blockingIssue);
            if (domain?.blueprintPath) blueprintPaths.add(domain.blueprintPath);
            else if (domain?.complete) flag("blueprint-path-missing", worker);
        }

        if (worker.phase === "blueprint") {
            if (state !== "start") flag("repeated-blueprint", worker);
            state = domainDone && settled ? "blueprinted" : "invalid";
        } else if (worker.phase === "replicate") {
            if (state !== "blueprinted" && state !== "rejected") flag("replicate-out-of-order", worker, state);
            else if (state === "rejected") correctionLoops += 1;
            state = domainDone && settled ? "replicated" : "invalid";
        } else if (worker.phase === "inspect") {
            if (state !== "replicated") flag("inspect-out-of-order", worker, state);
            const proof = worker.acceptance ?? { acceptedIds: [], unresolved: false };
            const accepted = domainDone && settled && worker.riskTier !== "high" && proof.acceptedIds.length > 0 && !proof.unresolved;
            if (domainDone && settled && !accepted && proof.acceptedIds.length === 0 && !proof.unresolved) flag("inspection-acceptance-unproven", worker, "no accepted criterion IDs in the returned package; left for coordinator verification");
            if (accepted) state = "accepted";
            else state = settled && domain?.complete ? "rejected" : "invalid";
        } else if (worker.phase === "extract") {
            if (state === "rejected") flag("extract-after-unaccepted-inspection", worker);
            else if (state !== "accepted") flag("premature-extract", worker, state);
            state = domainDone && settled ? "extracted" : "invalid";
        }
        if (settled && domain?.complete && !domainDone && worker.phase !== "inspect") {
            flag("phase-not-done", worker, domain.status ?? "unparsed");
        }
    }
    if (workers.length > 0 && state !== "extracted") {
        flag("missing-or-unaccepted-phase", null, `final state ${state}`);
    }
    if (blueprintPaths.size > 1) flag("blueprint-mismatch", null, [...blueprintPaths].join(" | "));

    const extract = workers.find((worker) => worker.phase === "extract" && worker.domain?.status === "done") ?? null;
    return {
        ok: violations.length === 0,
        violations,
        correctionLoops,
        finalState: state,
        extractEvidenceText: extract?.domain?.evidenceText ?? "",
        workers: workers.map((worker) => ({
            phase: worker.phase,
            toolCallId: worker.toolCallId,
            agentType: worker.agentType,
            startAt: worker.startAt,
            completeAt: worker.completeAt,
            workerStatus: worker.workerStatus,
            domainStatus: worker.domain?.status ?? null,
            riskTier: worker.riskTier ?? null,
            acceptedCriterionIds: worker.acceptance?.acceptedIds ?? [],
            blueprintPath: worker.domain?.blueprintPath ?? null,
        })),
        source: "native-task-events",
    };
}

// Direct-blueprint control: the standalone blueprint skill on a default agent, no automatic successors.
export function auditDirectBlueprint({ jsonRecords }) {
    const violations = [];
    const calls = new Map();
    let skillStarted = false;
    let finalText = "";
    const terminalSummaries = new Map();
    const completedTerminal = [];
    for (const record of jsonRecords) {
        const type = String(record?.type ?? "").toLowerCase();
        const data = record?.data ?? {};
        if (type === "session.task_complete" && data.success === true && typeof data.summary === "string") completedTerminal.push(data.summary);
        if (type === "assistant.message" && typeof data.content === "string" && data.content.trim()) finalText = data.content;
        if (type === "tool.execution_start") {
            const args = parseJsonObject(data.arguments) ?? parseJsonObject(data.argumentsJson) ?? {};
            if (data.toolName === "task_complete" && typeof args.summary === "string") terminalSummaries.set(data.toolCallId, args.summary);
            if (data.toolName === "skill") {
                const name = String(args.skill ?? args.name ?? "").replace(/^minime:/, "").toLowerCase();
                if (name === "blueprint") {
                    skillStarted = true;
                    calls.set(data.toolCallId, "blueprint");
                } else if (["replicate", "inspect", "extract"].includes(name)) {
                    violations.push({ code: "unexpected-successor-phase", detail: name });
                }
            } else if (data.toolName === "task") {
                const phase = phaseForWorker({ name: args.name ?? null, agentType: args.agent_type ?? null });
                if (phase && phase !== "blueprint") violations.push({ code: "unexpected-successor-phase", detail: phase });
            }
        } else if (type === "tool.execution_complete" && terminalSummaries.has(data.toolCallId)) {
            if (data.success === true) completedTerminal.push(terminalSummaries.get(data.toolCallId));
        } else if (type === "tool.execution_complete" && calls.has(data.toolCallId)) {
            if (data.success === false) violations.push({ code: "blueprint-skill-failed", detail: "tool success:false" });
        }
    }
    if (!skillStarted) violations.push({ code: "blueprint-skill-not-invoked", detail: "no native skill invocation of blueprint" });
    // The result may be the final assistant text or a successfully completed task_complete summary; complete results must agree.
    const domain = mergePhaseResults([finalText, ...completedTerminal]);
    if (domain.invalid) violations.push({ code: "conflicting-domain-results", detail: null });
    else if (!domain.complete || !domain.status) violations.push({ code: "domain-result-missing", detail: null });
    else if (domain.status !== "done") violations.push({ code: "phase-not-done", detail: domain.status });
    else if (domain.blockingIssue) violations.push({ code: "unresolved-blocker", detail: domain.blockingIssue });
    if (domain.complete && !domain.blueprintPath) violations.push({ code: "blueprint-path-missing", detail: null });
    return { ok: violations.length === 0, violations, domain: { status: domain.status, blueprintPath: domain.blueprintPath }, source: "native-events" };
}

export async function manifestDirectory(root) {
    const files = {};
    async function walk(absolute, relative) {
        let stats;
        try {
            stats = await lstat(absolute);
        } catch (error) {
            if (relative && error?.code === "ENOENT") return;
            throw error;
        }
        if (stats.isDirectory()) {
            const entries = await readdir(absolute);
            entries.sort();
            for (const entry of entries) await walk(path.join(absolute, entry), relative ? `${relative}/${entry}` : entry);
        } else if (stats.isFile()) {
            files[relative] = createHash("sha256").update(await readFile(absolute)).digest("hex");
        }
    }
    await walk(root, "");
    return files;
}

// Observation never throws: an unreadable HQ is reported as an error, never as an empty inventory.
export async function observeHq(root, { manifest = manifestDirectory, now = () => new Date() } = {}) {
    if (!root) return { status: "not-applicable", reason: "no-hq-root" };
    const at = now().toISOString();
    try {
        const files = await manifest(root);
        const inventorySha256 = createHash("sha256").update(Object.keys(files).sort().map((file) => `${file}\0${files[file]}\n`).join("")).digest("hex");
        return { status: "observed", at, fileCount: Object.keys(files).length, inventorySha256, files };
    } catch (error) {
        return { status: "error", at, error: String(error?.message ?? error).slice(0, 300) };
    }
}

// Learning evidence is separate from code and phase fidelity. Bootstrap, navigation, templates and
// blueprint artifacts are not learning, so a fresh HQ cannot turn an honest abstention into a failure.
export function classifyLearning({ hqBefore = {}, hqAfter = {}, auditResult }) {
    const changed = Object.keys(hqAfter).filter((file) => hqBefore[file] !== hqAfter[file]).sort();
    const learning = changed.filter((file) => !BOOTSTRAP_FILE.test(file));
    const raw = learning.filter((file) => /(^|\/)raw\//.test(file));
    const topics = learning.filter((file) => TOPIC_FILE.test(file));
    const extractDone = Boolean(auditResult?.workers?.some((worker) => worker.phase === "extract" && worker.domainStatus === "done"));
    let status;
    if (!extractDone) status = "not-attributable";
    else if (raw.length > 0 && topics.length > 0) status = "captured";
    else if (raw.length > 0 || topics.length > 0) status = "partial-capture";
    else if (ABSTENTION.test(auditResult?.extractEvidenceText ?? "")) status = "honest-abstention";
    else status = "absent-unattributed";
    return {
        status,
        ok: status === "captured" || status === "honest-abstention",
        demonstrated: status === "captured",
        changed,
        raw,
        topics,
    };
}

export function eligiblePriorTopics(files = {}) {
    return Object.keys(files)
        .filter((file) => TOPIC_FILE.test(file) && !NAVIGATION_FILE.test(file) && !BOOTSTRAP_FILE.test(file))
        .sort();
}

// A read counts only when its tool start has a matching successful completion; starts alone stay unproven.
// Targets must be absolute paths under the retained HQ mount; suffix matches elsewhere are different files.
// Path read is distinct from version proof: only completion content whose sha256 equals the pre-launch hash proves the retained version.
export function auditKnowledgeReads({ topicPaths = [], topicHashes = {}, jsonRecords = [], hqMount = HQ_MOUNT }) {
    const topics = topicPaths.filter((file) => TOPIC_FILE.test(file) && !NAVIGATION_FILE.test(file));
    const retained = new Map(topics.map((topic) => [path.posix.normalize(`${hqMount}/${topic}`), topic]));
    const pending = new Map();
    const pathRead = new Set();
    const versionProven = new Set();
    const attempted = new Set();
    const failed = new Set();
    for (const record of jsonRecords) {
        const data = record?.data ?? {};
        const type = String(record?.type ?? "").toLowerCase();
        if (type === "tool.execution_start") {
            if (!/^(view|read|read_file|cat)$/i.test(String(data.toolName ?? ""))) continue;
            const args = parseJsonObject(data.arguments) ?? parseJsonObject(data.argumentsJson) ?? {};
            const target = String(args.path ?? args.file ?? args.filePath ?? "");
            const topic = target.startsWith("/") ? retained.get(path.posix.normalize(target)) : undefined;
            if (!topic) continue;
            attempted.add(topic);
            if (data.toolCallId !== undefined) pending.set(data.toolCallId, topic);
        } else if (type === "tool.execution_complete" && pending.has(data.toolCallId)) {
            const topic = pending.get(data.toolCallId);
            pending.delete(data.toolCallId);
            if (data.success !== true) {
                failed.add(topic);
                continue;
            }
            pathRead.add(topic);
            const content = data.result?.content;
            if (typeof content === "string" && topicHashes[topic] && createHash("sha256").update(content).digest("hex") === topicHashes[topic]) versionProven.add(topic);
        }
    }
    const unproven = [...attempted].filter((topic) => !pathRead.has(topic));
    const status = topics.length === 0
        ? "not-applicable"
        : versionProven.size > 0 ? "read" : pathRead.size > 0 ? "path-read" : unproven.length > 0 ? "unproven" : "not-read";
    return {
        status,
        reason: topics.length === 0 ? "no-eligible-prior-topic" : null,
        eligible: topics.length,
        read: versionProven.size,
        pathReads: pathRead.size,
        unproven: unproven.length,
        failed: failed.size,
        ratio: topics.length === 0 ? null : versionProven.size / topics.length,
        readTopics: [...versionProven].sort(),
        pathReadTopics: [...pathRead].sort(),
        unprovenTopics: unproven.sort(),
        eligibleTopics: topics.map((topic) => ({ path: topic, sha256: topicHashes[topic] ?? null })).sort((a, b) => a.path.localeCompare(b.path)),
    };
}

const BOUND = 20;
const bounded = (list) => ({ count: list.length, sample: list.slice(0, BOUND) });

// Combines the measured pre-launch and post-run HQ states with native reads. Observes only; never alters the run outcome.
export function summarizeKnowledge({ arm, before, after, records = [], phaseAudit = null, lineage = null, nativeTrace = { status: "observed" } }) {
    if (arm !== "MINIME") {
        const state = { status: "not-applicable", reason: "arm-has-no-knowledge-store" };
        return { arm, generation: state, retrieval: state };
    }
    const observed = before?.status === "observed" && after?.status === "observed";
    if (!observed) {
        const reason = !before || before.status === "not-observed" ? "pre-state-not-observed" : `hq-observation-${before.status === "observed" ? after?.status ?? "missing" : before.status}`;
        const state = { status: "unavailable", reason };
        return { arm, before: stripFiles(before), after: stripFiles(after), generation: state, retrieval: state };
    }
    const learning = classifyLearning({ hqBefore: before.files, hqAfter: after.files, auditResult: phaseAudit });
    const generationStatus = learning.raw.length > 0 && learning.topics.length > 0
        ? "raw-and-topic"
        : learning.raw.length > 0 || learning.topics.length > 0
            ? "partial"
            : "none-observed";
    const topicPaths = eligiblePriorTopics(before.files);
    const reads = auditKnowledgeReads({ topicPaths, topicHashes: before.files, jsonRecords: records });
    const traceObserved = nativeTrace?.status === "observed";
    const changedDuringRun = topicPaths.filter((topic) => after.files[topic] !== before.files[topic]);
    return {
        arm,
        before: stripFiles(before),
        after: stripFiles(after),
        lineage,
        generation: {
            status: generationStatus,
            attribution: learning.status,
            changed: bounded(learning.changed),
            raw: bounded(learning.raw),
            topics: bounded(learning.topics),
        },
        retrieval: {
            status: reads.status === "not-applicable" ? "no-eligible-prior-topic" : !traceObserved ? "unavailable" : reads.status,
            ...(traceObserved ? {} : { reason: "native-trace-unavailable", error: nativeTrace?.error ?? null }),
            eligible: reads.eligible,
            confirmedReads: reads.read,
            pathReads: reads.pathReads,
            unproven: reads.unproven,
            failed: reads.failed,
            readTopics: bounded(reads.readTopics),
            changedDuringRun: bounded(changedDuringRun),
        },
        fullDetail: { learning, reads },
    };
}

// Per-task fields for ordinary summaries; snapshot promotion stays snapshot state, never proof of a lesson.
export function knowledgeFields(task, arm) {
    const lineage = task.runtimeOutcome?.receipt?.lineage ?? {};
    const snapshot = task.runtimeOutcome?.snapshot ?? {};
    const snapshotState = snapshot.promoted ? "promoted" : snapshot.quarantined ? "quarantined" : "none";
    const knowledge = task.knowledge ?? null;
    if (arm !== "MINIME") {
        return { snapshotState, knowledgeGeneration: "not_applicable", knowledgeRetrieval: "not_applicable", knowledgeRetrievalReason: "not_applicable", knowledgeReceipt: null };
    }
    if (!knowledge) {
        return {
            snapshotState,
            knowledgeGeneration: "not_observed",
            knowledgeRetrieval: lineage.inputSnapshotMissing ? "unavailable" : "not_observed",
            knowledgeRetrievalReason: lineage.inputSnapshotMissing ? "required-input-snapshot-missing" : "pre-state-not-observed",
            knowledgeReceipt: null,
        };
    }
    return {
        snapshotState,
        knowledgeGeneration: knowledge.generation?.status ?? "unavailable",
        knowledgeGenerationAttribution: knowledge.generation?.attribution ?? null,
        knowledgeGenerationCounts: knowledge.generation ? { raw: knowledge.generation.raw?.count ?? 0, topics: knowledge.generation.topics?.count ?? 0 } : null,
        knowledgeRetrieval: lineage.inputSnapshotMissing ? "unavailable" : knowledge.retrieval?.status ?? "unavailable",
        knowledgeRetrievalReason: lineage.inputSnapshotMissing ? "required-input-snapshot-missing" : knowledge.retrieval?.reason ?? knowledge.generation?.reason ?? null,
        knowledgeRetrievalCounts: knowledge.retrieval
            ? { eligible: knowledge.retrieval.eligible ?? 0, confirmedReads: knowledge.retrieval.confirmedReads ?? 0, pathReads: knowledge.retrieval.pathReads ?? 0, unproven: knowledge.retrieval.unproven ?? 0, failed: knowledge.retrieval.failed ?? 0 }
            : null,
        knowledgeReceipt: knowledge.receipt ?? null,
    };
}

function stripFiles(observation) {
    if (!observation) return { status: "not-observed" };
    const { files, ...rest } = observation;
    return rest;
}

// Reports whether the native trace could be read at all, so a missing trace is never mistaken for a run with no reads.
export async function observeNativeRecords(runtimeRoot) {
    let text = "";
    let readable = 0;
    const errors = [];
    const take = async (file) => {
        try {
            text += `\n${await readFile(file, "utf8")}`;
            readable += 1;
        } catch (error) {
            if (error?.code !== "ENOENT") errors.push(String(error?.message ?? error).slice(0, 200));
        }
    };
    for (const name of ["stdout.full.log", "stderr.full.log"]) await take(path.join(runtimeRoot, name));
    try {
        const logsRoot = path.join(runtimeRoot, "logs");
        for (const file of await readdir(logsRoot)) if (file.endsWith(".jsonl")) await take(path.join(logsRoot, file));
    } catch (error) {
        if (error?.code !== "ENOENT") errors.push(String(error?.message ?? error).slice(0, 200));
    }
    const records = parseJsonlRecords(text);
    // Authority needs an SDK event family seen in saved native traces plus an object `data`; readable bytes or arbitrary JSON prove nothing.
    const native = records.some((record) => typeof record?.type === "string" && NATIVE_EVENT_TYPE.test(record.type) && record.data && typeof record.data === "object" && !Array.isArray(record.data));
    const trace = readable > 0 && native && errors.length === 0 ? { status: "observed" } : { status: "unavailable", error: errors[0] ?? (readable > 0 ? "no-native-events" : "no-native-stream") };
    return { records, trace };
}

export async function readNativeRecords(runtimeRoot) {
    return (await observeNativeRecords(runtimeRoot)).records;
}
