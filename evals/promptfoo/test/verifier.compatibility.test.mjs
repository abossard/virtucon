import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
    assessSuiteCompatibility,
    evaluateCalibrationMatrix
} from "../verify.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scenariosDir = path.resolve(__dirname, "../scenarios");

async function loadManifest(filename) {
    const fullPath = path.join(scenariosDir, filename);
    const content = await readFile(fullPath, "utf8");
    return JSON.parse(content);
}

test("suite compatibility stays full when task keys and order are unchanged", async () => {
    const baseline = await loadManifest("ahm-managed-hard@1.json");
    const candidate = structuredClone(baseline);
    const result = assessSuiteCompatibility({
        leftManifest: baseline,
        rightManifest: candidate
    });
    assert.equal(result.fullComparable, true);
    assert.equal(result.longitudinalComparable, true);
    assert.deepEqual(result.sharedTasks, ["AHM-H1@1", "AHM-H2@1", "AHM-H3@1"]);
});

test("suite compatibility marks order drift as not longitudinally comparable", async () => {
    const baseline = await loadManifest("ahm-managed-hard@1.json");
    const candidate = structuredClone(baseline);
    candidate.orderedTasks = [
        { id: "AHM-H2", version: 1 },
        { id: "AHM-H1", version: 1 },
        { id: "AHM-H3", version: 1 }
    ];

    const result = assessSuiteCompatibility({
        leftManifest: baseline,
        rightManifest: candidate
    });

    assert.equal(result.fullComparable, false);
    assert.equal(result.longitudinalComparable, false);
    assert.deepEqual(result.sharedTasks, ["AHM-H1@1", "AHM-H2@1", "AHM-H3@1"]);
});

test("suite compatibility keeps only shared versioned tasks across replacements", async () => {
    const baseline = await loadManifest("ahm-managed-hard@1.json");
    const replacement = structuredClone(baseline);
    replacement.orderedTasks[2] = { id: "AHM-H3", version: 2 };
    replacement.tasks["AHM-H3@2"] = replacement.tasks["AHM-H3@1"];
    delete replacement.tasks["AHM-H3@1"];

    const result = assessSuiteCompatibility({
        leftManifest: baseline,
        rightManifest: replacement
    });

    assert.equal(result.fullComparable, false);
    assert.equal(result.longitudinalComparable, true);
    assert.deepEqual(result.sharedTasks, ["AHM-H1@1", "AHM-H2@1"]);
});

test("calibration matrix enforces baseline-green, task-red, reference-green transitions", async () => {
    const manifest = await loadManifest("ahm-parser-smoke@1.json");
    const passingTriplet = {
        baselineGreen: { preservationPass: true, taskContractPass: false },
        taskRed: { preservationPass: true, taskContractPass: false },
        referenceGreen: { preservationPass: true, taskContractPass: true }
    };
    const calibrationByTask = Object.fromEntries(
        manifest.orderedTasks.map((task) => [`${task.id}@${task.version}`, passingTriplet])
    );

    const passResult = evaluateCalibrationMatrix({ manifest, calibrationByTask });
    assert.equal(passResult.ok, true);

    const failing = structuredClone(calibrationByTask);
    failing["AHM-P2@1"] = {
        baselineGreen: { preservationPass: true, taskContractPass: false },
        taskRed: { preservationPass: true, taskContractPass: false },
        referenceGreen: { preservationPass: false, taskContractPass: true }
    };

    const failResult = evaluateCalibrationMatrix({ manifest, calibrationByTask: failing });
    assert.equal(failResult.ok, false);
    assert.equal(failResult.failures.some((failure) => failure.code === "REFERENCE_NOT_GREEN"), true);
});
