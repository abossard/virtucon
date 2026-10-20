import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { RUNTIME_PAYLOAD_COMMIT, RUNTIME_ARMS } from "../runtime/contracts.mjs";
import {
    candidateIdentity,
    loadVerifiedCandidate,
    payloadDigest,
    prepareCandidate,
    resolveCandidateSelection,
} from "../runtime/candidate.mjs";
import { runQualification, runEpisode, observeKnowledge } from "../episode.mjs";
import { loadSuiteManifest, writeRunManifest } from "../cli.mjs";
import {
    auditDirectBlueprint,
    auditKnowledgeReads,
    auditQualification,
    classifyLearning,
    parseAcceptance,
    knowledgeFields,
    observeHq,
    parsePhaseResult,
    summarizeKnowledge,
} from "../runtime/qualification.mjs";
import { buildLocalRuntimeImages, buildRuntimeArmSpecs } from "../runtime/launch.mjs";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

// Fixtures below are synthetic. They are NOT native model compliance proof.

const sha = (value) => createHash("sha256").update(value).digest("hex");
const HEX = "a".repeat(64);

async function makeCandidate(root, { mutate = null } = {}) {
    const files = [
        { path: "agents/dr-evil.md", mode: "100644", bytes: "base agent\n", origin: "base" },
        { path: "hooks/session-start.js", mode: "100644", bytes: "delta hook\n", origin: "delta" },
    ].map((file) => ({ ...file, sha256: sha(file.bytes) }));
    const listed = files.map(({ path: p, mode, sha256, origin }) => ({ path: p, mode, sha256, origin }));
    const payloadSha256 = payloadDigest(listed);
    const directory = path.join(root, payloadSha256);
    for (const file of files) {
        const target = path.join(directory, "payload", file.path);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, file.bytes);
    }
    const patch = "diff fixture\n";
    await writeFile(path.join(directory, "patch.diff"), patch);
    const manifest = {
        schemaVersion: 1,
        kind: "minime-candidate",
        baseCommit: RUNTIME_PAYLOAD_COMMIT,
        baselineSha256: HEX,
        patchSha256: sha(patch),
        payloadSha256,
        reviewedPaths: ["hooks/session-start.js"],
        files: listed,
    };
    if (mutate) await mutate({ manifest, directory });
    const manifestPath = path.join(directory, "manifest.json");
    const text = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(manifestPath, text);
    return { manifestPath, manifestSha256: sha(text), directory };
}

async function scratch(t) {
    const root = await mkdtemp(path.join(tmpdir(), "candidate-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    return root;
}

test("a manifest matching the approved hash loads with full identity", async (t) => {
    const fixture = await makeCandidate(await scratch(t));
    const verified = await loadVerifiedCandidate({
        candidateManifestPath: fixture.manifestPath,
        approvedCandidateManifestSha256: fixture.manifestSha256,
    });
    assert.equal(verified.manifestSha256, fixture.manifestSha256);
    assert.deepEqual(verified.reviewedPaths, ["hooks/session-start.js"]);
    assert.equal(verified.fileCount, 2);
});

for (const [label, mutate, expected] of [
    ["unapproved reviewed path", ({ manifest }) => {
        manifest.reviewedPaths = ["hooks/other.js"];
        manifest.files[1].path = "hooks/other.js";
        manifest.payloadSha256 = payloadDigest(manifest.files);
    }, /./],
    ["wrong base commit", ({ manifest }) => { manifest.baseCommit = "0".repeat(40); }, /pinned/],
    ["unexpected mode", ({ manifest }) => { manifest.files[1].mode = "100777"; }, /mode/],
    ["traversal path", ({ manifest }) => { manifest.files[1].path = "../evil.js"; }, /./],
    ["tampered patch", async ({ directory }) => { await writeFile(path.join(directory, "patch.diff"), "tampered\n"); }, /patch/],
    ["tampered payload bytes", async ({ directory }) => { await writeFile(path.join(directory, "payload/hooks/session-start.js"), "evil\n"); }, /drifted/],
    ["extra payload file", async ({ directory }) => { await writeFile(path.join(directory, "payload/hooks/extra.js"), "x\n"); }, /differs/],
    ["symlink in payload", async ({ directory }) => {
        await rm(path.join(directory, "payload/hooks/session-start.js"));
        await symlink("/etc/hosts", path.join(directory, "payload/hooks/session-start.js"));
    }, /Symlink/],
]) {
    test(`candidate verification rejects ${label}`, async (t) => {
        const fixture = await makeCandidate(await scratch(t), { mutate });
        await assert.rejects(
            loadVerifiedCandidate({
                candidateManifestPath: fixture.manifestPath,
                approvedCandidateManifestSha256: fixture.manifestSha256,
            }),
            expected,
        );
    });
}

test("candidate bytes cannot change after approval", async (t) => {
    const fixture = await makeCandidate(await scratch(t));
    await writeFile(fixture.manifestPath, `${await readFile(fixture.manifestPath, "utf8")} `);
    await assert.rejects(
        loadVerifiedCandidate({
            candidateManifestPath: fixture.manifestPath,
            approvedCandidateManifestSha256: fixture.manifestSha256,
        }),
        /does not match the approved hash/,
    );
});

for (const [label, input, outcome] of [
    ["both absent", {}, null],
    ["path without hash", { candidateManifestPath: "/x/manifest.json" }, "throw"],
    ["hash without path", { approvedCandidateManifestSha256: HEX }, "throw"],
    ["relative path", { candidateManifestPath: "x/manifest.json", approvedCandidateManifestSha256: HEX }, "throw"],
    ["non-hex hash", { candidateManifestPath: "/x/m.json", approvedCandidateManifestSha256: "z".repeat(64) }, "throw"],
    ["valid", { candidateManifestPath: "/x/m.json", approvedCandidateManifestSha256: HEX }, "ok"],
]) {
    test(`candidate selection: ${label}`, () => {
        if (outcome === "throw") assert.throws(() => resolveCandidateSelection(input));
        else if (outcome === "ok") assert.equal(resolveCandidateSelection(input).approvedCandidateManifestSha256, HEX);
        else assert.equal(resolveCandidateSelection(input), null);
    });
}

for (const [label, reviewedPath] of [
    ["absolute path", "/etc/passwd"],
    ["traversal", "../etc/passwd"],
    ["unapproved production path", "skills/blueprint/SKILL.md"],
    ["backslash path", "hooks\\session-start.js"],
]) {
    test(`prepareCandidate rejects ${label} before touching git`, async (t) => {
        const root = await scratch(t);
        await assert.rejects(
            prepareCandidate({
                projectRoot: root,
                baselinePath: path.join(root, "none.json"),
                paths: [reviewedPath],
                candidatesRoot: path.join(root, "out"),
                materializeBase: async () => assert.fail("base must not be materialized"),
            }),
        );
    });
}

test("qualification requires an explicit approved candidate and never launches without one", async () => {
    const suite = await loadSuiteManifest("ahm-parser-smoke@1");
    let launches = 0;
    const result = await runQualification({
        suite,
        taskKey: "AHM-P1@1",
        candidate: { candidateManifestPath: null, approvedCandidateManifestSha256: null },
        runtimeProfile: { model: "gpt-5.3-codex", reasoningEffort: "high", taskTimeoutSeconds: 900 },
        attempt: async () => { launches += 1; },
        env: { COPILOT_GITHUB_TOKEN: "present" },
    });
    assert.equal(launches, 0);
    assert.equal(result.output.runtimeInfra.code, "candidate-required");
});

test("an invalid explicit candidate fails before readiness and any model launch", async (t) => {
    const suite = await loadSuiteManifest("ahm-parser-smoke@1");
    const fixture = await makeCandidate(await scratch(t));
    let ready = 0;
    let launches = 0;
    const result = await runQualification({
        suite,
        taskKey: "AHM-P1@1",
        candidate: { candidateManifestPath: fixture.manifestPath, approvedCandidateManifestSha256: HEX },
        runtimeProfile: { model: "gpt-5.3-codex", reasoningEffort: "high", taskTimeoutSeconds: 900 },
        runtimeReadiness: async () => { ready += 1; },
        attempt: async () => { launches += 1; },
        env: { COPILOT_GITHUB_TOKEN: "present" },
    });
    assert.equal(ready + launches, 0);
    assert.equal(result.output.runtimeInfra.code, "candidate-invalid");
});

test("runEpisode rejects an invalid explicit candidate before readiness", async () => {
    const suite = await loadSuiteManifest("ahm-parser-smoke@1");
    let ready = 0;
    const result = await runEpisode({
        suite,
        runtimeProfile: { model: "gpt-5.3-codex", reasoningEffort: "high", taskTimeoutSeconds: 900 },
        candidate: { candidateManifestPath: "/nonexistent/manifest.json", approvedCandidateManifestSha256: HEX },
        runtimeReadiness: async () => { ready += 1; },
    });
    assert.equal(ready, 0);
    assert.equal(result.output.runtimeInfra.code, "candidate-invalid");
});

for (const directPhase of [null, "blueprint"]) {
    test(`qualify public entry performs exactly one model launch (direct=${directPhase})`, async (t) => {
        const suite = await loadSuiteManifest("ahm-parser-smoke@1");
        const fixture = await makeCandidate(await scratch(t));
        const calls = [];
        const compatibilityCalls = [];
        const result = await runQualification({
            suite,
            taskKey: "AHM-P1@1",
            candidate: { candidateManifestPath: fixture.manifestPath, approvedCandidateManifestSha256: fixture.manifestSha256 },
            runtimeProfile: { model: "gpt-5.3-codex", reasoningEffort: "high", taskTimeoutSeconds: 900 },
            directPhase,
            runtimeReadiness: async ({ candidate }) => {
                compatibilityCalls.push(candidate.approvedCandidateManifestSha256);
                return { kind: "runtime_image_ready", ok: true, images: { defaultImage: "d", minimeImage: "m", probe: "p", payloadHash: "h", candidate: { manifestSha256: fixture.manifestSha256 } }, defaultImageId: "sha256:x" };
            },
            attempt: async (args) => {
                calls.push(args);
                return { context: { paths: { runtimeRoot: path.join(path.dirname(fixture.manifestPath), "no-logs"), hqRoot: null } }, runtimeOutcome: { status: "completed" }, verification: null };
            },
            env: { COPILOT_GITHUB_TOKEN: "present" },
        });
        assert.equal(calls.length, 1);
        assert.deepEqual(compatibilityCalls, [fixture.manifestSha256]);
        assert.equal(calls[0].arm, RUNTIME_ARMS.MINIME);
        assert.equal(result.output.candidate.manifestSha256, fixture.manifestSha256);
        assert.equal(calls[0].grade, directPhase === null);
        assert.equal(calls[0].armSpecs.MINIME.copilotArgs("s").includes("minime:dr-evil"), directPhase === null);
        assert.equal(/standalone blueprint skill/.test(calls[0].prompt), directPhase === "blueprint");
    });
}

test("omitAgent drops the custom agent while the default arm stays payload-free", () => {
    const images = { defaultImage: "d", minimeImage: "m", probe: "p", payloadHash: "h" };
    const withAgent = buildRuntimeArmSpecs({ images, model: "gpt-5.3-codex", reasoningEffort: "high" });
    const without = buildRuntimeArmSpecs({ images, model: "gpt-5.3-codex", reasoningEffort: "high", omitAgent: true });
    assert.ok(withAgent.MINIME.copilotArgs("s").includes("minime:dr-evil"));
    assert.ok(!without.MINIME.copilotArgs("s").includes("minime:dr-evil"));
    assert.deepEqual(without.DEFAULT.copilotArgs("s"), withAgent.DEFAULT.copilotArgs("s"));
    assert.equal(without.DEFAULT.image, withAgent.DEFAULT.image);
});

function domain(status, { blocking = "null", blueprint = "/hq/bp.md" } = {}) {
    return `status: ${status}\nblueprint_path: ${blueprint}\nchanged_files: []\nblocking_issue: ${blocking}\nevidence_excerpts: ok`;
}

function phaseRecords(steps, { overlapAt = null } = {}) {
    const records = [];
    steps.forEach((step, index) => {
        const id = `call-${index}`;
        const start = { type: "tool.execution_start", data: { toolName: "task", toolCallId: id, arguments: { name: step.phase, agent_type: step.phase === "inspect" ? (step.agent ?? "minime:frau") : "general-purpose" } } };
        const done = { type: "tool.execution_complete", data: { toolCallId: id, success: step.success ?? true, result: { content: step.text ?? (domain(step.status ?? "done") + (step.phase === "inspect" ? `\nAccepted criterion IDs: [C3-1]\n## Risk tier\n**${step.risk ?? "LOW"}**` : "")), ...(step.outer === null ? {} : { status: step.outer ?? "completed" }) } } };
        if (overlapAt === index && records.length) records.splice(records.length - 1, 0, start);
        else records.push(start);
        records.push(done);
    });
    return records;
}

const happy = [{ phase: "blueprint" }, { phase: "replicate" }, { phase: "inspect" }, { phase: "extract" }];

test("audit accepts the full flow", () => {
    const result = auditQualification({ jsonRecords: phaseRecords(happy) });
    assert.deepEqual(result.violations, []);
    assert.equal(result.finalState, "extracted");
});

test("audit allows replicate-inspect correction loops", () => {
    const steps = [{ phase: "blueprint" }, { phase: "replicate" }, { phase: "inspect", status: "blocked", text: domain("blocked", { blocking: "tests fail" }) }, { phase: "replicate" }, { phase: "inspect" }, { phase: "extract" }];
    const result = auditQualification({ jsonRecords: phaseRecords(steps) });
    assert.equal(result.correctionLoops, 1);
    assert.deepEqual(result.violations, []);
});

for (const [label, steps, code] of [
    ["premature extract", [{ phase: "blueprint" }, { phase: "extract" }], "premature-extract"],
    ["extract after rejected inspection", [{ phase: "blueprint" }, { phase: "replicate" }, { phase: "inspect", text: domain("blocked", { blocking: "x" }) }, { phase: "extract" }], "extract-after-unaccepted-inspection"],
    ["failed worker", [{ phase: "blueprint", success: false }], "worker-failed"],
    ["inspect by non-Frau (not recognized as inspect)", [{ phase: "blueprint" }, { phase: "replicate" }, { phase: "inspect", agent: "general-purpose" }, { phase: "extract" }], "premature-extract"],
    ["done with unresolved blocker", [{ phase: "blueprint", text: domain("done", { blocking: "still broken" }) }], "unresolved-blocker"],
    ["missing domain result", [{ phase: "blueprint", text: "all good" }], "domain-result-missing"],
    ["mismatched blueprint", [{ phase: "blueprint" }, { phase: "replicate", text: domain("done", { blueprint: "/other.md" }) }, { phase: "inspect" }, { phase: "extract" }], "blueprint-mismatch"],
    ["failed outer worker status", [{ phase: "blueprint", outer: "failed" }], "worker-unsuccessful-status"],
    ["cancelled outer worker status", [{ phase: "blueprint", outer: "cancelled" }], "worker-unsuccessful-status"],
    ["unknown outer worker status", [{ phase: "blueprint", outer: "unknown" }], "worker-unsuccessful-status"],
    ["HIGH-risk inspection followed by extract", [{ phase: "blueprint" }, { phase: "replicate" }, { phase: "inspect", risk: "HIGH" }, { phase: "extract" }], "extract-after-unaccepted-inspection"],
    ["replicate without blueprint identity", [{ phase: "blueprint" }, { phase: "replicate", text: domain("done", { blueprint: "null" }) }, { phase: "inspect" }, { phase: "extract" }], "blueprint-path-missing"],
    ["inspection without risk tier", [{ phase: "blueprint" }, { phase: "replicate" }, { phase: "inspect", text: domain("done") }, { phase: "extract" }], "inspection-acceptance-unproven"],
    ["LOW risk with explicit unresolved criterion and empty accepted IDs", [{ phase: "blueprint" }, { phase: "replicate" }, { phase: "inspect", text: domain("done") + "\nevidence_excerpts: ['Accepted criterion IDs: []','C3-2 remains failed and unresolved; return unfinished work to replicate']\n## Risk tier\n**LOW**" }, { phase: "extract" }], "extract-after-unaccepted-inspection"],
    ["real Frau package mutated HIGH to LOW keeps unresolved trace", [{ phase: "blueprint" }, { phase: "replicate" }, { phase: "inspect", text: domain("done") + "\n## Risk tier\n\n**LOW**\n\nRationale: concrete unresolved contract-completion gap." }, { phase: "extract" }], "extract-after-unaccepted-inspection"],
    ["accepted IDs listed alongside an unresolved requirement", [{ phase: "blueprint" }, { phase: "replicate" }, { phase: "inspect", text: domain("done") + "\nAccepted criterion IDs: [C3-1]\nC3-2 remains unresolved\n## Risk tier\n**LOW**" }, { phase: "extract" }], "extract-after-unaccepted-inspection"],
    ["failed inspection never accepted", [{ phase: "blueprint" }, { phase: "replicate" }, { phase: "inspect", text: domain("failed", { blocking: "bad" }) }], "missing-or-unaccepted-phase"],
]) {
    test(`audit flags ${label}`, () => {
        const codes = auditQualification({ jsonRecords: phaseRecords(steps) }).violations.map((item) => item.code);
        assert.ok(codes.includes(code), `${code} not in ${codes}`);
    });
}

test("audit flags overlapping workers", () => {
    const codes = auditQualification({ jsonRecords: phaseRecords(happy, { overlapAt: 1 }) }).violations.map((item) => item.code);
    assert.ok(codes.includes("overlap"));
});

test("audit tolerates native envelopes that omit the outer status", () => {
    const steps = happy.map((step) => ({ ...step, outer: null }));
    assert.deepEqual(auditQualification({ jsonRecords: phaseRecords(steps) }).violations, []);
});

test("audit accepts an inspection with explicit accepted IDs and no unresolved text", () => {
    const text = domain("done") + "\nAccepted criterion IDs: [C3-1, C3-2]\nNo unresolved requirements.\n## Risk tier\n**MEDIUM**";
    const steps = [{ phase: "blueprint" }, { phase: "replicate" }, { phase: "inspect", text }, { phase: "extract" }];
    assert.deepEqual(auditQualification({ jsonRecords: phaseRecords(steps) }).violations, []);
});

const archiveInspect = (line) => JSON.stringify({
    status: "done",
    blueprint_path: "/hq/bp.md",
    changed_files: [],
    blocking_issue: null,
    evidence_excerpts: ["risk_tier=LOW | uncertainty drivers mitigated", line],
});
for (const [label, line, accepted] of [
    ["real archive-acceptance phrasing", "Blueprint updated in this phase: status set to inspected; Active criteria cleared; C0-1..C0-4 moved to Criteria archive with inspect proof; handoff updated to `inspect complete (criteria accepted, risk LOW, no blockers)`.", true],
    ["listed IDs archived", "C0-1, C0-2 and C0-3 were archived in Criteria archive with inspect proof", true],
    ["IDs merely mentioned", "Reviewed C0-1..C0-4 against the diff; risk LOW", false],
    ["generic LOW only", "risk LOW, inspect complete", false],
    ["instruction to archive", "Archive C0-1..C0-4 in Criteria archive once proven", false],
    ["should be moved", "C0-1..C0-4 should be moved to Criteria archive", false],
    ["not yet archived", "C0-1..C0-4 not yet moved to Criteria archive; risk LOW", false],
    ["not accepted", "C0-1..C0-4 moved to Criteria archive but C0-4 not accepted", false],
    ["remaining active criteria", "C0-1 moved to Criteria archive; C0-2 remains active and C0-3 unresolved", false],
    ["neither/nor archive", "Neither C0-1 nor C0-2 moved to Criteria archive; risk LOW", false],
    ["hypothetical archive example", "For example, if C0-1..C0-2 were moved to Criteria archive they would be accepted", false],
    ["empty accepted list then reviewed IDs", "Accepted criterion IDs: []\nReviewed C0-1 and C0-2.\nRisk tier: LOW", false],
    ["accepted IDs with no criteria remaining unresolved", "Accepted criterion IDs: [C3-1]\nNo criteria remain unresolved.", true],
    ["no blockers but another criterion remains unresolved", "Accepted criterion IDs: [C3-1]\nNo blockers and C3-2 remains unresolved.", false],
    ["active criteria still listed", "C0-1..C0-2 moved to Criteria archive; C0-3 still active", false],
]) {
    test(`audit archive acceptance: ${label}`, () => {
        const steps = happy.map((step) => step.phase === "inspect" ? { ...step, text: archiveInspect(line), outer: null } : step);
        assert.equal(auditQualification({ jsonRecords: phaseRecords(steps) }).ok, accepted);
    });
}

test("accepted IDs are unique and ordered for duplicated native envelope copies with a range", () => {
    const line = "Blueprint updated in this phase: Active criteria cleared; C0-1..C0-4 moved to Criteria archive with inspect proof.";
    const text = archiveInspect(line);
    const steps = happy.map((step) => step.phase === "inspect" ? { ...step, text, outer: null } : step);
    const records = phaseRecords(steps).map((record) => record?.data?.result?.content === text ? { ...record, data: { ...record.data, result: { content: text, detailedContent: text } } } : record);
    const inspect = auditQualification({ jsonRecords: records }).workers.find((worker) => worker.phase === "inspect");
    assert.deepEqual(inspect.acceptedCriterionIds, ["C0-1", "C0-2", "C0-3", "C0-4"]);
    assert.deepEqual(parseAcceptance("Accepted criterion IDs: [C3-1, C3-1]\nC3-1 moved to Criteria archive").acceptedIds, ["C3-1"]);
});

for (const field of ["risk tier", "risk_tier", "risk-tier", "riskTier"]) {
    for (const tier of ["LOW", "MEDIUM", "HIGH"]) {
        test(`audit handles structured inspection risk ${field}=${tier}`, () => {
            const text = JSON.stringify({
                status: "done",
                blueprint_path: "/hq/bp.md",
                changed_files: [],
                blocking_issue: null,
                evidence_excerpts: ["Accepted criterion IDs: [C3-1]", "No unresolved requirements."],
                [field]: tier,
            });
            const steps = happy.map((step) => step.phase === "inspect" ? { ...step, text, outer: null } : step);
            const result = auditQualification({ jsonRecords: phaseRecords(steps) });
            assert.equal(result.ok, tier !== "HIGH");
            if (tier === "HIGH") {
                assert.ok(result.violations.some((item) => item.code === "extract-after-unaccepted-inspection"));
            }
        });
    }
}

test("audit allows a HIGH-risk inspection to be corrected and re-inspected", () => {
    const steps = [{ phase: "blueprint" }, { phase: "replicate" }, { phase: "inspect", risk: "HIGH" }, { phase: "replicate" }, { phase: "inspect", risk: "LOW" }, { phase: "extract" }];
    const result = auditQualification({ jsonRecords: phaseRecords(steps) });
    assert.deepEqual(result.violations, []);
    assert.equal(result.correctionLoops, 1);
});

test("hybrid: saved real Frau package (HIGH risk, done/null) is not an accepted inspection", async () => {
    // Real Frau text from a prior native run; surrounding phase events are synthetic, so this is audit evidence only.
    const real = "```json\n{\"status\":\"done\",\"blueprint_path\":\"/work/hq/bp.md\",\"changed_files\":[],\"blocking_issue\":null,\"evidence_excerpts\":[\"x\"]}\n```\n## Risk tier\n\n**HIGH**\n\nRationale: concrete unresolved contract-completion gap.";
    const steps = [{ phase: "blueprint", text: domain("done", { blueprint: "/work/hq/bp.md" }) }, { phase: "replicate", text: domain("done", { blueprint: "/work/hq/bp.md" }) }, { phase: "inspect", text: real }, { phase: "extract", text: domain("done", { blueprint: "/work/hq/bp.md" }) }];
    const codes = auditQualification({ jsonRecords: phaseRecords(steps) }).violations.map((item) => item.code);
    assert.ok(codes.includes("extract-after-unaccepted-inspection"));
});

test("audit finds nothing without native task events", () => {
    const codes = auditQualification({ jsonRecords: [{ type: "assistant.message", data: { content: "blueprint replicate inspect extract" } }] }).violations.map((item) => item.code);
    assert.ok(codes.includes("no-native-phase-workers"));
});

function directRecords({ skill = "blueprint", success = true, final = domain("done"), extra = [] } = {}) {
    return [
        { type: "tool.execution_start", data: { toolName: "skill", toolCallId: "s1", arguments: { skill } } },
        { type: "tool.execution_complete", data: { toolCallId: "s1", success, result: { content: "skill loaded" } } },
        ...extra,
        { type: "assistant.message", data: { content: final } },
    ];
}

const TERMINAL_JSON = (over = {}) => JSON.stringify({ status: "done", blueprint_path: "/hq/bp.md", changed_files: [], blocking_issue: null, evidence_excerpts: ["export { extractBlocks };", "ran `node --test`"], ...over }, null, 2);
const terminalSummary = (over) => `**Result:** Blueprint phase completed.\n\n\`\`\`json\n${TERMINAL_JSON(over)}\n\`\`\`\n\nThe blueprint contains criteria.`;
const terminalRecords = ({ summary = terminalSummary(), success = true, started = true, sessionEvent = false, extra = [] } = {}) => [
    ...directRecords({ final: "" }),
    ...extra,
    ...(started ? [{ type: "tool.execution_start", data: { toolName: "task_complete", toolCallId: "tc1", arguments: { summary } } }] : []),
    ...(started && success !== null ? [{ type: "tool.execution_complete", data: { toolCallId: "tc1", success, result: { content: summary } } }] : []),
    ...(sessionEvent ? [{ type: "session.task_complete", data: { success: true, summary } }] : []),
];
for (const [label, records, ok, code] of [
    ["skill-load output with example result and no completion", [
        { type: "tool.execution_start", data: { toolName: "skill", toolCallId: "s1", arguments: { skill: "blueprint" } } },
        { type: "tool.execution_complete", data: { toolCallId: "s1", success: true, result: { content: `Example phase result from the skill instructions:\n${TERMINAL_JSON()}` } } },
    ], false, "domain-result-missing"],
    ["terminal task_complete summary with prose and fenced JSON", terminalRecords(), true, null],
    ["terminal session.task_complete event only", terminalRecords({ started: false, sessionEvent: true }), true, null],
    ["terminal summary duplicated by session event", terminalRecords({ sessionEvent: true }), true, null],
    ["task_complete invocation without completion", terminalRecords({ success: null }), false, "domain-result-missing"],
    ["failed task_complete invocation", terminalRecords({ success: false }), false, "domain-result-missing"],
    ["blocked terminal summary", terminalRecords({ summary: terminalSummary({ status: "blocked", blocking_issue: "x" }) }), false, "phase-not-done"],
    ["terminal summary contradicting the final message", terminalRecords({ extra: [{ type: "assistant.message", data: { content: TERMINAL_JSON({ status: "blocked", blocking_issue: "x" }) } }] }), false, "conflicting-domain-results"],
    ["two contradictory terminal results", terminalRecords({ sessionEvent: true, summary: terminalSummary() }).concat([{ type: "session.task_complete", data: { success: true, summary: terminalSummary({ status: "blocked", blocking_issue: "x" }) } }]), false, "conflicting-domain-results"],
    ["user prompt template is not a result", [...directRecords({ final: "" }), { type: "user.message", data: { content: TERMINAL_JSON() } }], false, "domain-result-missing"],
    ["terminal result with successor skill", terminalRecords({ extra: [{ type: "tool.execution_start", data: { toolName: "skill", toolCallId: "s2", arguments: { skill: "extract" } } }] }), false, "unexpected-successor-phase"],
    ["standalone skill with five-field result", directRecords(), true, null],
    ["no skill invocation", [{ type: "assistant.message", data: { content: domain("done") } }], false, "blueprint-skill-not-invoked"],
    ["skill success:false despite done body", directRecords({ success: false }), false, "blueprint-skill-failed"],
    ["blocked result", directRecords({ final: domain("blocked", { blocking: "x" }) }), false, "phase-not-done"],
    ["missing result", directRecords({ final: "done" }), false, "domain-result-missing"],
    ["automatic successor skill", directRecords({ extra: [{ type: "tool.execution_start", data: { toolName: "skill", toolCallId: "s2", arguments: { skill: "replicate" } } }] }), false, "unexpected-successor-phase"],
    ["automatic successor task", directRecords({ extra: [{ type: "tool.execution_start", data: { toolName: "task", toolCallId: "t1", arguments: { name: "inspect", agent_type: "minime:frau" } } }] }), false, "unexpected-successor-phase"],
    ["legitimate unrelated research task", directRecords({ extra: [{ type: "tool.execution_start", data: { toolName: "task", toolCallId: "t2", arguments: { name: "research", agent_type: "explore" } } }] }), true, null],
]) {
    test(`direct blueprint control: ${label}`, () => {
        const result = auditDirectBlueprint({ jsonRecords: records });
        assert.equal(result.ok, ok, JSON.stringify(result.violations));
        if (code) assert.ok(result.violations.some((item) => item.code === code));
    });
}

for (const [label, text, expected] of [
    ["key lines", domain("done"), "done"],
    ["json", JSON.stringify({ status: "blocked", blueprint_path: "/a", changed_files: [], blocking_issue: "x", evidence_excerpts: [] }), "blocked"],
    ["pipe table", "| status | done |\n| blueprint_path | /a |\n| changed_files | [] |\n| blocking_issue | null |\n| evidence_excerpts | y |", "done"],
]) {
    test(`phase result parses ${label}`, () => assert.equal(parsePhaseResult(text).status, expected));
}

const NATIVE_RESULT = (over = {}) => JSON.stringify({
    status: "done",
    blueprint_path: "/work/hq/bp.md",
    changed_files: ["a.js"],
    blocking_issue: null,
    evidence_excerpts: ["export { extractBlocks, parse };", 'quote \\" and } brace'],
    ...over,
});
const SIGNOFF = "\n\nFrau reviewed: inspect complete {not a result}";
const envelope = (content, detailed = content) => [
    { type: "tool.execution_start", data: { toolName: "task", toolCallId: "n1", arguments: { name: "replicate", agent_type: "general-purpose" } } },
    { type: "tool.execution_complete", data: { toolCallId: "n1", success: true, result: { content, detailedContent: detailed } } },
];
for (const [label, content, detailed, status] of [
    ["duplicate content and detailedContent with braces in strings", NATIVE_RESULT(), NATIVE_RESULT(), "done"],
    ["trailing sign-off after the object", NATIVE_RESULT() + SIGNOFF, NATIVE_RESULT() + SIGNOFF, "done"],
    ["sign-off before the object", `${SIGNOFF}\n${NATIVE_RESULT()}`, NATIVE_RESULT(), "done"],
    ["blocked stays blocked", NATIVE_RESULT({ status: "blocked", blocking_issue: "x" }), NATIVE_RESULT({ status: "blocked", blocking_issue: "x" }), "blocked"],
    ["truncated object is rejected", NATIVE_RESULT().slice(0, -12), NATIVE_RESULT().slice(0, -12), null],
    ["unterminated string is rejected", '{"status":"done","blueprint_path":"/a', '{"status":"done","blueprint_path":"/a', null],
    ["missing field is rejected", JSON.stringify({ status: "done", blueprint_path: "/a" }), "", null],
    ["conflicting results done then blocked", NATIVE_RESULT(), NATIVE_RESULT({ status: "blocked", blocking_issue: "test suite failed" }), null],
    ["conflicting results blocked then done", NATIVE_RESULT({ status: "blocked", blocking_issue: "test suite failed" }), NATIVE_RESULT(), null],
    ["key-value done plus JSON done vs blocked JSON", `${domain("done")}\n${NATIVE_RESULT()}`, NATIVE_RESULT({ status: "blocked", blocking_issue: "test suite failed" }), null],
    ["blocked JSON vs key-value done plus JSON done", NATIVE_RESULT({ status: "blocked", blocking_issue: "test suite failed" }), `${domain("done")}\n${NATIVE_RESULT()}`, null],
    ["key-value done vs key-value blocked", domain("done"), domain("blocked", { blocking: "x" }), null],
    ["key-value done vs blocked JSON", domain("done"), NATIVE_RESULT({ status: "blocked", blocking_issue: "x" }), null],
    ["conflicting key-value lines in one channel", `${domain("done")}\n${domain("blocked", { blocking: "x" })}`, "", null],
    ["differing changed_files across channels", NATIVE_RESULT({ changed_files: ["src/a.mjs"] }), NATIVE_RESULT({ changed_files: ["src/b.mjs"] }), null],
    ["changed_files case differs across channels", NATIVE_RESULT({ changed_files: ["src/A.mjs"] }), NATIVE_RESULT({ changed_files: ["src/a.mjs"] }), null],
    ["changed_files case differs within one channel", `${NATIVE_RESULT({ changed_files: ["src/A.mjs"] })}\n${NATIVE_RESULT({ changed_files: ["src/a.mjs"] })}`, "", null],
    ["differing changed_files within one channel", `${NATIVE_RESULT({ changed_files: ["src/a.mjs"] })}\n${NATIVE_RESULT({ changed_files: ["src/b.mjs"] })}`, "", null],
    ["blueprint path case differs across channels", NATIVE_RESULT(), NATIVE_RESULT({ blueprint_path: "/WORK/hq/bp.md" }), null],
    ["identical key-value copies", domain("done"), domain("done"), "done"],
    ["same channel blocked key-value then done JSON", `${domain("blocked", { blocking: "x" })}\n${NATIVE_RESULT()}`, "", null],
    ["same channel done JSON then blocked key-value", `${NATIVE_RESULT()}\n${domain("blocked", { blocking: "x" })}`, "", null],
    ["same channel done key-value then blocked JSON", `${domain("done")}\n${NATIVE_RESULT({ status: "blocked", blocking_issue: "x" })}`, "", null],
    ["same channel blocked JSON then done key-value", `${NATIVE_RESULT({ status: "blocked", blocking_issue: "x" })}\n${domain("done")}`, "", null],
    ["same channel agreeing key-value and JSON", `${Object.entries(JSON.parse(NATIVE_RESULT())).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("\n")}\n${NATIVE_RESULT()}`, "", "done"],
    ["standalone key-value result", domain("done"), "", "done"],
    ["same channel JSON and key-value differing only in evidence", `${NATIVE_RESULT()}\n${domain("done", { blueprint: "/work/hq/bp.md" })}`, "", null],
    ["same channel JSON and key-value differing only in blueprint case", `${NATIVE_RESULT({ blueprint_path: "/work/hq/BP.md" })}\n${Object.entries(JSON.parse(NATIVE_RESULT())).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("\n")}`, "", null],
    ["blocked table quoted inside done JSON evidence", NATIVE_RESULT({ evidence_excerpts: ["| status | blocked |\n| blueprint_path | /x.md |\n| changed_files | [] |\n| blocking_issue | bad |\n| evidence_excerpts | [] |"] }), "", "done"],
    ["conflicting results differing only in evidence", NATIVE_RESULT(), NATIVE_RESULT({ evidence_excerpts: ["other"] }), null],
]) {
    test(`native envelope domain: ${label}`, () => {
        const worker = auditQualification({ jsonRecords: envelope(content, detailed) }).workers[0];
        assert.equal(worker.domainStatus, status);
        if (status === "done") assert.equal(worker.domainComplete ?? true, true);
        if (status === null) assert.ok(auditQualification({ jsonRecords: envelope(content, detailed) }).violations.some((item) => item.code === "domain-result-missing"));
    });
}

const EXTRACTED = { workers: [{ phase: "extract", domainStatus: "done" }], extractEvidenceText: "" };
const ABSTAINED = { ...EXTRACTED, extractEvidenceText: "no material reusable lesson" };
const BOOTSTRAP = { "schema.md": "1", "templates/plan.md": "1", "wiki/index.md": "1", "wiki/log.md": "1", "blueprints/bp.md": "1", "org/repo/blueprints/x.md": "1" };

for (const [label, after, audit, status, ok] of [
    ["raw plus topic", { "raw/a.md": "1", "wiki/topic.md": "2" }, EXTRACTED, "captured", true],
    ["bootstrap only with honest abstention", BOOTSTRAP, ABSTAINED, "honest-abstention", true],
    ["bootstrap plus raw/topic with abstention text uses the files", { ...BOOTSTRAP, "raw/a.md": "1", "wiki/t.md": "1" }, ABSTAINED, "captured", true],
    ["raw without topic (partial retention)", { ...BOOTSTRAP, "raw/a.md": "1" }, EXTRACTED, "partial-capture", false],
    ["topic without raw (partial retention)", { ...BOOTSTRAP, "wiki/t.md": "1" }, EXTRACTED, "partial-capture", false],
    ["partial output despite abstention claim", { "raw/a.md": "1" }, ABSTAINED, "partial-capture", false],
    ["no output and no abstention", BOOTSTRAP, EXTRACTED, "absent-unattributed", false],
    ["extract not done", { "raw/a.md": "1" }, { workers: [] }, "not-attributable", false],
]) {
    test(`learning: ${label}`, () => {
        const result = classifyLearning({ hqBefore: {}, hqAfter: after, auditResult: audit });
        assert.equal(result.status, status);
        assert.equal(result.ok, ok);
        assert.equal(result.demonstrated, status === "captured");
    });
}

test("knowledge reads: zero eligible topics is not-applicable, never 100%", () => {
    assert.equal(auditKnowledgeReads({ topicPaths: [], jsonRecords: [] }).status, "not-applicable");
    assert.equal(auditKnowledgeReads({ topicPaths: ["wiki/index.md"], jsonRecords: [] }).ratio, null);
});

function dockerRecorder({ defaultPresent }) {
    const calls = [];
    const spawnImpl = (_command, args) => {
        const child = new EventEmitter();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.unref = () => {};
        const signature = args.join(" ");
        calls.push(signature);
        const present = signature.includes("image inspect minime-eval-runtime-default") ? defaultPresent : false;
        process.nextTick(() => {
            child.stdout.end();
            child.stderr.end();
            child.emit("close", signature.includes("image inspect") && !present ? 1 : 0, null);
        });
        return child;
    };
    return { calls, spawnImpl };
}

for (const [label, forceRebuild, defaultPresent, defaultBuilt] of [
    ["setup force with an existing DEFAULT reuses it", true, true, false],
    ["non-force with an existing DEFAULT reuses it", false, true, false],
    ["a missing DEFAULT is still built", true, false, true],
]) {
    test(`candidate image preparation: ${label}`, async (t) => {
        const fixture = await makeCandidate(await scratch(t));
        const { calls, spawnImpl } = dockerRecorder({ defaultPresent });
        const result = await buildLocalRuntimeImages({
            projectRoot: await scratch(t),
            dockerfilePath: path.join(await scratch(t), "Dockerfile"),
            forceRebuild,
            candidate: { candidateManifestPath: fixture.manifestPath, approvedCandidateManifestSha256: fixture.manifestSha256 },
            spawnImpl,
        });
        assert.equal(result.ok, true, JSON.stringify(result));
        const builds = calls.filter((call) => call.startsWith("build "));
        assert.equal(builds.some((call) => call.includes("--target runtime-default")), defaultBuilt);
        assert.equal(builds.some((call) => call.includes("--target runtime-minime")), true);
        assert.equal(calls.some((call) => /^(tag|rmi|image tag|image rm) .*minime-eval-runtime-default/.test(call)), false);
    });
}

for (const [label, candidate] of [
    ["verified candidate identity", { candidateManifestPath: "/c/manifest.json", manifestSha256: "m".repeat(64), payloadSha256: "p".repeat(64), patchSha256: "x".repeat(64), baseCommit: "b".repeat(40), baselineSha256: "l".repeat(64), reviewedPaths: ["hooks/session-start.js"], fileCount: 63 }],
    ["absent candidate", null],
]) {
    test(`run manifest writer records ${label}`, async () => {
        const dir = await mkdtemp(path.join(tmpdir(), "run-manifest-"));
        await writeRunManifest({ suite: { suite: {}, tasks: {} }, runDir: dir, repeat: 1, runtimeProfile: {}, candidate });
        const written = JSON.parse(await readFile(path.join(dir, "run-manifest.json"), "utf8"));
        if (!candidate) return assert.equal("candidate" in written, false);
        assert.equal(written.candidate.approvedCandidateManifestSha256, candidate.manifestSha256);
        assert.equal(written.candidate.approvedPayloadSha256, candidate.payloadSha256);
        assert.equal(written.candidate.baseCommit, candidate.baseCommit);
    });
}

test("run manifest serializes the identity of a candidate verified from disk", async (t) => {
    const fixture = await makeCandidate(await scratch(t));
    const verified = await loadVerifiedCandidate({ candidateManifestPath: fixture.manifestPath, approvedCandidateManifestSha256: fixture.manifestSha256 });
    const dir = await mkdtemp(path.join(tmpdir(), "run-manifest-"));
    await writeRunManifest({ suite: { suite: {}, tasks: {} }, runDir: dir, repeat: 1, runtimeProfile: {}, candidate: candidateIdentity(verified) });
    const written = JSON.parse(await readFile(path.join(dir, "run-manifest.json"), "utf8")).candidate;
    assert.equal(written.approvedCandidateManifestSha256, fixture.manifestSha256);
    assert.equal(written.payloadSha256, verified.payloadSha256);
    assert.equal(written.baseCommit, verified.baseCommit);
    assert.deepEqual(written.reviewedPaths, ["hooks/session-start.js"]);
});

test("commandRun passes the verified runtime candidate identity to the manifest writer", async () => {
    const source = await readFile(new URL("../cli.mjs", import.meta.url), "utf8");
    assert.match(source, /writeRunManifest\(\{[^}]*candidate: runtimeReady\.images\?\.candidate/);
});

const obs = (files) => ({ status: "observed", at: "t", fileCount: Object.keys(files).length, inventorySha256: "i", files });
const BOOT = { "schema.md": "1", "wiki/index.md": "1", "wiki/log.md": "1", "blueprints/bp.md": "1" };
const TOPIC = "wiki/topics/parser.md";
const readRecords = (completion) => [
    { type: "tool.execution_start", data: { toolName: "view", toolCallId: "r1", arguments: { path: `/work/hq/${TOPIC}` } } },
    ...(completion === undefined ? [] : [{ type: "tool.execution_complete", data: { toolCallId: "r1", success: completion } }]),
];

for (const [label, before, after, records, generation, retrieval] of [
    ["empty to empty", obs({}), obs({}), [], "none-observed", "no-eligible-prior-topic"],
    ["bootstrap-only delta", obs({}), obs({ ...BOOT, "blueprints/new.md": "2" }), [], "none-observed", "no-eligible-prior-topic"],
    ["raw plus topic delta", obs(BOOT), obs({ ...BOOT, "raw/a/b.md": "3", [TOPIC]: "4" }), [], "raw-and-topic", "no-eligible-prior-topic"],
    ["raw-only delta", obs(BOOT), obs({ ...BOOT, "raw/a/b.md": "3" }), [], "partial", "no-eligible-prior-topic"],
    ["prepopulated topic never read", obs({ ...BOOT, [TOPIC]: "4" }), obs({ ...BOOT, [TOPIC]: "4" }), [], "none-observed", "not-read"],
    ["prior topic read and completed", obs({ ...BOOT, [TOPIC]: "4" }), obs({ ...BOOT, [TOPIC]: "4" }), readRecords(true), "none-observed", "path-read"],
    ["prior topic read failed", obs({ ...BOOT, [TOPIC]: "4" }), obs({ ...BOOT, [TOPIC]: "4" }), readRecords(false), "none-observed", "unproven"],
    ["prior topic read never completed", obs({ ...BOOT, [TOPIC]: "4" }), obs({ ...BOOT, [TOPIC]: "4" }), readRecords(undefined), "none-observed", "unproven"],
    ["pre-state observation error", { status: "error", error: "EACCES" }, obs(BOOT), [], "unavailable", "unavailable"],
    ["post-state observation error", obs(BOOT), { status: "error", error: "EIO" }, [], "unavailable", "unavailable"],
    ["pre-state absent", undefined, obs(BOOT), [], "unavailable", "unavailable"],
]) {
    test(`knowledge summary: ${label}`, () => {
        const summary = summarizeKnowledge({ arm: "MINIME", before, after, records });
        assert.equal(summary.generation.status, generation);
        assert.equal(summary.retrieval.status, retrieval);
        assert.equal("files" in (summary.before ?? {}), false);
    });
}

test("knowledge summary binds eligible prior topics to pre-launch hashes", () => {
    const { fullDetail } = summarizeKnowledge({ arm: "MINIME", before: obs({ ...BOOT, [TOPIC]: "h4" }), after: obs({ ...BOOT, [TOPIC]: "h5" }), records: readRecords(true) });
    assert.deepEqual(fullDetail.reads.eligibleTopics, [{ path: TOPIC, sha256: "h4" }]);
});

test("DEFAULT arm knowledge is not applicable", () => {
    const summary = summarizeKnowledge({ arm: "DEFAULT", before: null, after: null });
    assert.equal(summary.generation.status, "not-applicable");
    assert.equal(summary.retrieval.status, "not-applicable");
});

test("observeHq reports I/O errors instead of an empty inventory", async () => {
    const missing = await observeHq(path.join(tmpdir(), "definitely-missing-hq-root"));
    assert.equal(missing.status, "error");
    const thrown = await observeHq("/x", { manifest: async () => { throw new Error("EIO"); } });
    assert.equal(thrown.status, "error");
    assert.equal((await observeHq(null)).status, "not-applicable");
});

for (const [label, withHq, expectGeneration] of [
    ["MINIME with readable HQ", true, "raw-and-topic"],
    ["MINIME with unreadable HQ keeps the run outcome", false, "unavailable"],
]) {
    test(`observeKnowledge: ${label}`, async (t) => {
        const root = await scratch(t);
        const hqRoot = path.join(root, "hq");
        const receiptsRoot = path.join(root, "receipts");
        await mkdir(receiptsRoot, { recursive: true });
        if (withHq) await mkdir(path.join(hqRoot, "raw/a"), { recursive: true });
        const before = withHq ? await observeHq(hqRoot) : { status: "error", error: "ENOENT" };
        if (withHq) {
            await writeFile(path.join(hqRoot, "raw/a/n.md"), "raw");
            await mkdir(path.join(hqRoot, "wiki/t"), { recursive: true });
            await writeFile(path.join(hqRoot, "wiki/t/x.md"), "topic");
        }
        const runtimeOutcome = { status: "completed" };
        const result = await observeKnowledge({ arm: RUNTIME_ARMS.MINIME, context: { paths: { hqRoot, runtimeRoot: root, receiptsRoot }, lineage: { inputSnapshotId: null } }, hqBefore: before, runtimeOutcome });
        assert.equal(result.knowledge.generation.status, expectGeneration);
        assert.equal(runtimeOutcome.status, "completed");
        if (withHq) {
            const body = await readFile(result.knowledge.receipt.path);
            assert.equal(createHash("sha256").update(body).digest("hex"), result.knowledge.receipt.sha256);
            assert.ok(JSON.parse(body).inventories.after["raw/a/n.md"]);
        }
    });
}

test("observeKnowledge: DEFAULT arm is not applicable and writes no receipt", async () => {
    const result = await observeKnowledge({ arm: RUNTIME_ARMS.DEFAULT, context: { paths: {} }, hqBefore: null, runtimeOutcome: {} });
    assert.equal(result.knowledge.generation.status, "not-applicable");
});

for (const [label, task, arm, expected] of [
    ["observed generation is not the snapshot label", { runtimeOutcome: { snapshot: { promoted: true } }, knowledge: { generation: { status: "none-observed", raw: { count: 0 }, topics: { count: 0 } }, retrieval: { status: "read", eligible: 1, confirmedReads: 1 } } }, "MINIME", { snapshotState: "promoted", knowledgeGeneration: "none-observed", knowledgeRetrieval: "read" }],
    ["historical task without observation stays explicit", { runtimeOutcome: { snapshot: { promoted: true } } }, "MINIME", { snapshotState: "promoted", knowledgeGeneration: "not_observed", knowledgeRetrieval: "not_observed" }],
    ["DEFAULT arm", { runtimeOutcome: {} }, "DEFAULT", { knowledgeGeneration: "not_applicable", knowledgeRetrieval: "not_applicable" }],
]) {
    test(`ordinary summary fields: ${label}`, () => {
        assert.deepEqual(Object.fromEntries(Object.keys(expected).map((key) => [key, knowledgeFields(task, arm)[key]])), expected);
    });
}

test("qualification consumes the measured pre-launch inventory", async (t) => {
    const suite = await loadSuiteManifest("ahm-parser-smoke@1");
    const fixture = await makeCandidate(await scratch(t));
    const run = (inventories) => runQualification({
        suite,
        taskKey: "AHM-P1@1",
        candidate: { candidateManifestPath: fixture.manifestPath, approvedCandidateManifestSha256: fixture.manifestSha256 },
        runtimeProfile: { model: "gpt-5.3-codex", reasoningEffort: "high", taskTimeoutSeconds: 900 },
        runtimeReadiness: async () => ({ kind: "runtime_image_ready", ok: true, images: { defaultImage: "d", minimeImage: "m", probe: "p", payloadHash: "h", candidate: { manifestSha256: fixture.manifestSha256 } }, defaultImageId: "sha256:x" }),
        attempt: async () => ({ context: { paths: { runtimeRoot: path.join(path.dirname(fixture.manifestPath), "no-logs"), hqRoot: null } }, runtimeOutcome: { status: "completed" }, verification: null, inventories }),
        env: { COPILOT_GITHUB_TOKEN: "present" },
    });
    const observed = await run({ before: obs({ "raw/old.md": "1" }), after: obs({ "raw/old.md": "1", "raw/new.md": "2" }) });
    assert.equal(observed.output.learning.preStateObserved, true);
    assert.deepEqual(observed.output.learning.raw, ["raw/new.md"]);
    const missing = await run(undefined);
    assert.equal(missing.output.learning.preStateObserved, false);
});

const sha256Of = (text) => createHash("sha256").update(text).digest("hex");
// Retained-version read evidence uses the SDK shape: result.content is the raw file text.
const TOPIC_TEXT = "# parser topic\nretained lesson\n";
const viewRecords = (target, { content = TOPIC_TEXT, success = true, complete = true } = {}) => [
    { type: "tool.execution_start", data: { toolName: "view", toolCallId: "v1", arguments: { path: target } } },
    ...(complete ? [{ type: "tool.execution_complete", data: { toolCallId: "v1", success, result: { content, detailedContent: `diff of ${target}` } } }] : []),
];
const PRIOR = obs({ ...BOOT, [TOPIC]: sha256Of(TOPIC_TEXT) });

for (const [label, target, retrieval, confirmed, pathReads] of [
    ["canonical HQ path with raw content", `/work/hq/${TOPIC}`, "read", 1, 1],
    ["canonical path with dot segments", `/work/hq/wiki/../${TOPIC}`, "read", 1, 1],
    ["same suffix under the repository", `/work/repo/${TOPIC}`, "not-read", 0, 0],
    ["same suffix under another HQ", `/another/hq/${TOPIC}`, "not-read", 0, 0],
    ["bare relative path", TOPIC, "not-read", 0, 0],
]) {
    test(`knowledge read binding: ${label}`, () => {
        const { retrieval: r } = summarizeKnowledge({ arm: "MINIME", before: PRIOR, after: PRIOR, records: viewRecords(target) });
        assert.equal(r.status, retrieval);
        assert.equal(r.confirmedReads, confirmed);
        assert.equal(r.pathReads, pathReads);
    });
}

for (const [label, content, after, status, confirmed, pathReads] of [
    ["replacement content read, replaced topic", "# replaced\n", sha256Of("# replaced\n"), "path-read", 0, 1],
    ["partial content, unchanged topic", "# parser topic\n", sha256Of(TOPIC_TEXT), "path-read", 0, 1],
    ["no content evidence", null, sha256Of(TOPIC_TEXT), "path-read", 0, 1],
    ["raw content matching the retained hash", TOPIC_TEXT, sha256Of("# later\n"), "read", 1, 1],
]) {
    test(`knowledge version proof: ${label}`, () => {
        const { retrieval: r } = summarizeKnowledge({ arm: "MINIME", before: PRIOR, after: obs({ ...BOOT, [TOPIC]: after }), records: viewRecords(`/work/hq/${TOPIC}`, { content }) });
        assert.equal(r.status, status);
        assert.equal(r.confirmedReads, confirmed);
        assert.equal(r.pathReads, pathReads);
    });
}

test("unavailable native trace is not an observed zero read", () => {
    const summary = summarizeKnowledge({ arm: "MINIME", before: PRIOR, after: obs({ ...BOOT, [TOPIC]: sha256Of(TOPIC_TEXT), "raw/x/y.md": "1" }), records: [], nativeTrace: { status: "unavailable", error: "ENOENT" } });
    assert.equal(summary.retrieval.status, "unavailable");
    assert.equal(summary.retrieval.reason, "native-trace-unavailable");
    assert.equal(summary.generation.status, "partial");
    assert.equal(summary.retrieval.eligible, 1);
});

test("observeKnowledge reports an absent native stream as unavailable retrieval and keeps the run outcome", async (t) => {
    const root = await scratch(t);
    const hqRoot = path.join(root, "hq");
    await mkdir(path.join(hqRoot, "wiki/topics"), { recursive: true });
    await writeFile(path.join(hqRoot, TOPIC), TOPIC_TEXT);
    const receiptsRoot = path.join(root, "receipts");
    await mkdir(receiptsRoot, { recursive: true });
    const before = await observeHq(hqRoot);
    const runtimeOutcome = { status: "completed" };
    const { knowledge } = await observeKnowledge({ arm: RUNTIME_ARMS.MINIME, context: { paths: { hqRoot, runtimeRoot: path.join(root, "no-logs"), receiptsRoot }, lineage: null }, hqBefore: before, runtimeOutcome });
    assert.equal(knowledge.retrieval.status, "unavailable");
    assert.equal(runtimeOutcome.status, "completed");
    await mkdir(path.join(root, "logs-ok"), { recursive: true });
    await writeFile(path.join(root, "logs-ok", "stdout.full.log"), `${JSON.stringify({ type: "assistant.message", data: { content: "done" } })}\n`);
    const observed = await observeKnowledge({ arm: RUNTIME_ARMS.MINIME, context: { paths: { hqRoot, runtimeRoot: path.join(root, "logs-ok"), receiptsRoot }, lineage: null }, hqBefore: before, runtimeOutcome });
    assert.equal(observed.knowledge.retrieval.status, "not-read");
});

for (const [label, inventories] of [
    ["absent inventories", undefined],
    ["before error", { before: { status: "error", error: "EACCES" }, after: obs({ "raw/old.md": "1" }) }],
    ["after error", { before: obs({}), after: { status: "error", error: "EIO" } }],
]) {
    test(`qualification does not invent a baseline: ${label}`, async (t) => {
        const suite = await loadSuiteManifest("ahm-parser-smoke@1");
        const fixture = await makeCandidate(await scratch(t));
        const hqRoot = path.join(await scratch(t), "hq");
        await mkdir(path.join(hqRoot, "raw/a"), { recursive: true });
        await writeFile(path.join(hqRoot, "raw/a/old.md"), "old");
        const result = await runQualification({
            suite,
            taskKey: "AHM-P1@1",
            candidate: { candidateManifestPath: fixture.manifestPath, approvedCandidateManifestSha256: fixture.manifestSha256 },
            runtimeProfile: { model: "gpt-5.3-codex", reasoningEffort: "high", taskTimeoutSeconds: 900 },
            runtimeReadiness: async () => ({ kind: "runtime_image_ready", ok: true, images: { defaultImage: "d", minimeImage: "m", probe: "p", payloadHash: "h", candidate: { manifestSha256: fixture.manifestSha256 } }, defaultImageId: "sha256:x" }),
            attempt: async () => ({ context: { paths: { runtimeRoot: path.join(path.dirname(fixture.manifestPath), "no-logs"), hqRoot } }, runtimeOutcome: { status: "completed" }, verification: null, inventories }),
            env: { COPILOT_GITHUB_TOKEN: "present" },
        });
        assert.equal(result.output.learning.demonstrated, false);
        assert.equal(result.output.learning.ok, false);
        assert.equal(result.output.learning.status, "not-observed");
        assert.equal(result.output.learning.preStateObserved, false);
        assert.deepEqual(result.output.learning.changed ?? [], []);
    });
}

for (const [label, files] of [
    ["empty stdout", { "stdout.full.log": "" }],
    ["empty stderr only", { "stderr.full.log": "" }],
    ["ordinary diagnostic text", { "stdout.full.log": "starting up\nplain text\n" }],
    ["unrecognized event family", { "stdout.full.log": `${JSON.stringify({ type: "diagnostic.message", data: { message: "ordinary diagnostic" } })}\n` }],
    ["recognized family with array payload", { "stdout.full.log": `${JSON.stringify({ type: "model.call_start", data: [] })}\n` }],
    ["jsonl without native events", { "logs/diagnostic.jsonl": `${JSON.stringify({ message: "ordinary diagnostic" })}\n${JSON.stringify({ type: "note" })}\n` }],
]) {
    test(`native trace without event evidence is unavailable: ${label}`, async (t) => {
        const root = await scratch(t);
        for (const [name, body] of Object.entries(files)) {
            await mkdir(path.dirname(path.join(root, "rt", name)), { recursive: true });
            await writeFile(path.join(root, "rt", name), body);
        }
        const hqRoot = path.join(root, "hq");
        await mkdir(path.join(hqRoot, "wiki/topics"), { recursive: true });
        await writeFile(path.join(hqRoot, TOPIC), TOPIC_TEXT);
        const receiptsRoot = path.join(root, "receipts");
        await mkdir(receiptsRoot, { recursive: true });
        const { knowledge } = await observeKnowledge({ arm: RUNTIME_ARMS.MINIME, context: { paths: { hqRoot, runtimeRoot: path.join(root, "rt"), receiptsRoot }, lineage: null }, hqBefore: await observeHq(hqRoot), runtimeOutcome: { status: "completed" } });
        assert.equal(knowledge.retrieval.status, "unavailable");
        assert.equal(knowledge.retrieval.reason, "native-trace-unavailable");
        assert.equal(knowledge.generation.status, "none-observed");
        assert.ok(knowledge.receipt.sha256);
    });
}
