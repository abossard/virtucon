import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { validateScenarioManifest } from "../verify.mjs";

function suiteFixture() {
    return {
        suite: {
            role: "smoke",
            reportingKey: "smoke-suite",
        },
        orderedTasks: [{
            id: "AHM-S1",
            version: 1,
        }],
        tasks: {
            "AHM-S1@1": {
                definition: {
                    title: "Fixture task",
                },
            },
        },
    };
}

test("episode returns infra blocker evidence when compatibility probe fails", async (t) => {
    let runEpisode;
    try {
        ({ runEpisode } = await import("../episode.mjs"));
    } catch (error) {
        if (error?.code === "ERR_MODULE_NOT_FOUND") {
            t.skip(`episode dependencies unavailable in this slice: ${error.url ?? error.message}`);
            return;
        }
        throw error;
    }
    const previousToken = process.env.COPILOT_GITHUB_TOKEN;
    const previousReceipt = process.env.PROMPTFOO_CALIBRATION_RECEIPT;
    process.env.COPILOT_GITHUB_TOKEN = "test-token";
    const temp = await mkdtemp(path.join(tmpdir(), "episode-calibration-"));
    const suite = suiteFixture();
    const validation = validateScenarioManifest(suite);
    const receiptPath = path.join(temp, "receipt.json");
    await writeFile(receiptPath, JSON.stringify({
        ok: true,
        identity: {
            suite: suite.suite.reportingKey,
            manifestDigest: validation.manifestDigest,
            sourcePin: suite.sourcePin ?? {},
            taskDefinitionHashes: { "AHM-S1@1": null },
        },
    }, null, 2));
    process.env.PROMPTFOO_CALIBRATION_RECEIPT = receiptPath;
    t.after(async () => rm(temp, { recursive: true, force: true }));
    let result;
    try {
        result = await runEpisode({
            suite,
            runtimeProfile: {
                model: "GPT-5.3-Codex",
                reasoningEffort: "high",
                taskTimeoutSeconds: 900,
            },
            compatibilityProbe: async () => ({
                ok: false,
                message: "Native launch unavailable.",
                missingPrerequisites: ["native-launch"],
                capabilityChecks: [{ id: "minime-native-launch", status: "failed", reason: "unavailable" }],
                evidence: ["Native launch invocation failed."],
            }),
            runtimeReadiness: async () => ({
                kind: "runtime_image_ready",
                ok: true,
                images: {
                    defaultImage: "minime-eval-runtime-default:1.0.99-3",
                    minimeImage: "minime-eval-runtime-minime:1.0.99-3-fixture",
                },
                buildEvidence: ["fixture"],
                readinessEvidence: {
                    ok: true,
                    capabilityChecks: [],
                    evidence: [],
                    missingPrerequisites: [],
                },
            }),
        });
    } finally {
        if (previousToken === undefined) {
            delete process.env.COPILOT_GITHUB_TOKEN;
        } else {
            process.env.COPILOT_GITHUB_TOKEN = previousToken;
        }
        if (previousReceipt === undefined) delete process.env.PROMPTFOO_CALIBRATION_RECEIPT;
        else process.env.PROMPTFOO_CALIBRATION_RECEIPT = previousReceipt;
    }

    assert.equal(result.output.status, "infrastructure_error");
    assert.equal(result.output.runtimeInfra.kind, "runtime_infra_error");
    assert.equal(result.output.runtimeInfra.code, "compatibility-blocked");
    assert.deepEqual(result.output.runtimeInfra.blockerEvidence.missingPrerequisites, ["native-launch"]);
    assert.equal(Array.isArray(result.metadata.runtimeInfra.blockerEvidence.evidence), true);
});
