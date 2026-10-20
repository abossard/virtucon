import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { verifyTaskAttempt } from "../verify.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scenariosDir = path.resolve(__dirname, "../scenarios");

async function loadManifest(filename) {
    const fullPath = path.join(scenariosDir, filename);
    const content = await readFile(fullPath, "utf8");
    return JSON.parse(content);
}

function passingObservation({ definition, touchedPaths, wrotePaths }) {
    const apiChecks = [
        ...(definition.api?.checks ?? []).map((check) => check.name),
        ...(definition.api?.oracleChecks ?? []).map((check) => check.name),
    ];
    const cliChecks = (definition.cli?.oracleChecks ?? []).map((check) => check.name);
    return {
        expectedOwner: "host",
        preservationPass: true,
        api: {
            exports: [...new Set([...(definition.api?.requiredExports ?? []), "extractBlocks"])],
            checks: apiChecks.map((name) => ({ name, ok: true }))
        },
        cli: {
            exitCode: definition.cli?.expectedExitCode ?? 0,
            stdout: (definition.cli?.stdoutIncludes ?? []).join(" "),
            stderr: "",
            checks: cliChecks.map((name) => ({ name, ok: true })),
        },
        filesystem: {
            touchedPaths,
            wrotePaths
        }
    };
}

test("verifyTaskAttempt passes hard task when API+CLI+filesystem contracts are met", async () => {
    const manifest = await loadManifest("ahm-managed-hard@1.json");
    const definition = manifest.tasks["AHM-H1@1"].definition;
    const result = verifyTaskAttempt({
        manifest,
        taskId: "AHM-H1",
        taskVersion: 1,
        observation: passingObservation({
            definition,
            touchedPaths: ["src/inventory.mjs", "bin/diagrammo.mjs"],
            wrotePaths: ["src/inventory.mjs", "bin/diagrammo.mjs"]
        })
    });

    assert.equal(result.classification.classification, "pass");
    assert.equal(result.probeResult.pass, true);
    assert.equal(result.probeResult.failures.length, 0);
});

test("verifyTaskAttempt classifies explicit infra errors separately from coding failures", async () => {
    const manifest = await loadManifest("ahm-managed-hard@1.json");
    const result = verifyTaskAttempt({
        manifest,
        taskId: "AHM-H2",
        taskVersion: 1,
        infraFailure: {
            kind: "runtime",
            detail: "copilot runtime boot failed"
        },
        observation: null
    });

    assert.equal(result.classification.classification, "infrastructure_failure");
    assert.equal(result.classification.kind, "runtime");
    assert.equal(result.probeResult, null);
});

test("verifyTaskAttempt fails coding verdict on no-op and allowlist tamper", async () => {
    const manifest = await loadManifest("ahm-managed-hard@1.json");
    const definition = manifest.tasks["AHM-H3@1"].definition;
    const result = verifyTaskAttempt({
        manifest,
        taskId: "AHM-H3",
        taskVersion: 1,
        observation: passingObservation({
            definition,
            touchedPaths: ["src/sync-status.mjs", "evals/promptfoo/verify.mjs"],
            wrotePaths: []
        })
    });

    assert.equal(result.classification.classification, "coding_failure");
    assert.equal(result.probeResult.failures.some((failure) => failure.code === "NO_OP_PATCH"), true);
    assert.equal(result.probeResult.failures.some((failure) => failure.code === "PATH_NOT_ALLOWED"), true);
});
