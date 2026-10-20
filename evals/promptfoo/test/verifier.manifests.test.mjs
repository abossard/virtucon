import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
    reportIdentity,
    validateScenarioManifest
} from "../verify.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scenariosDir = path.resolve(__dirname, "../scenarios");

async function loadManifest(filename) {
    const fullPath = path.join(scenariosDir, filename);
    const content = await readFile(fullPath, "utf8");
    return JSON.parse(content);
}

test("manifest validation accepts smoke and hard suites with pinned source metadata", async () => {
    const manifests = await Promise.all([
        loadManifest("ahm-parser-smoke@1.json"),
        loadManifest("ahm-managed-hard@1.json"),
        loadManifest("ahm-managed-hard@2.json")
    ]);

    for (const manifest of manifests) {
        const validation = validateScenarioManifest(manifest);
        assert.equal(validation.ok, true);
        assert.equal(manifest.sourcePin.repository, "abossard/ahm-diagrammo");
        assert.equal(manifest.sourcePin.commit, "7f93a1eddb08c319a157d6b1a1c58bf571dc3ce7");
        assert.equal(manifest.sourcePin.visibility, "public");
        assert.equal(manifest.sourcePin.licenseSpdx, "MIT");
    }
});

test("hard suite keeps exact ordered task ids and versions", async () => {
    const manifest = await loadManifest("ahm-managed-hard@1.json");
    const ordered = manifest.orderedTasks.map((task) => `${task.id}@${task.version}`);
    assert.deepEqual(ordered, ["AHM-H1@1", "AHM-H2@1", "AHM-H3@1"]);
});

test("active hard suite v2 keeps exact ordered task ids and versions", async () => {
    const manifest = await loadManifest("ahm-managed-hard@2.json");
    const ordered = manifest.orderedTasks.map((task) => `${task.id}@${task.version}`);
    assert.deepEqual(ordered, ["AHM-H1@2", "AHM-H2@2", "AHM-H3@2"]);
});

test("smoke and hard suites keep separate report identities", async () => {
    const smoke = await loadManifest("ahm-parser-smoke@1.json");
    const hard = await loadManifest("ahm-managed-hard@1.json");
    assert.deepEqual(reportIdentity(smoke), { suite: "ahm-parser-smoke@1", role: "smoke" });
    assert.deepEqual(reportIdentity(hard), { suite: "ahm-managed-hard@1", role: "hard" });
});

test("tampering task definition without version/hash bump is rejected", async () => {
    const manifest = await loadManifest("ahm-managed-hard@1.json");
    const tampered = structuredClone(manifest);
    tampered.tasks["AHM-H1@1"].definition.cli.stdoutIncludes.push("new-fragment");
    const validation = validateScenarioManifest(tampered);
    assert.equal(validation.ok, false);
    assert.equal(
        validation.issues.some((issue) => issue.code === "TASK_DEFINITION_HASH_MISMATCH"),
        true
    );
});
