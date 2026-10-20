import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateSuiteContracts, classifyProbeError } from "../verify.mjs";

const scenariosDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../scenarios");
const load = async (name) => JSON.parse(await readFile(path.join(scenariosDir, name), "utf8"));

test("shipped suites have complete contracts", async () => {
    for (const name of ["ahm-managed-hard@1.json", "ahm-managed-hard@2.json", "ahm-parser-smoke@1.json"]) {
        const result = await validateSuiteContracts({ manifest: await load(name) });
        assert.equal(result.ok, true, JSON.stringify(result.failures ?? result));
    }
});

for (const [label, mutate, code] of [
    ["missing oracle script", (t) => { t.definition.api.oracleChecks[0].script = "scenarios/oracles/ahm-managed-hard@1/none.mjs"; }, "ORACLE_SCRIPT_MISSING"],
    ["tampered oracle hash", (t) => { t.definition.api.oracleChecks[0].sha256 = "0".repeat(64); }, "ORACLE_HASH_MISMATCH"],
    ["missing reference patch", (t) => { t.referencePatch = "reference/none.patch"; }, "REFERENCE_PATCH_MISSING"],
    ["wrong patch equals reference", (t) => { t.wrongPatch = t.referencePatch; }, "WRONG_PATCH_IDENTICAL"],
]) {
    test(`validateSuiteContracts rejects ${label}`, async () => {
        const manifest = await load("ahm-managed-hard@1.json");
        mutate(manifest.tasks["AHM-H1@1"]);
        const result = await validateSuiteContracts({ manifest });
        assert.equal(result.ok, false);
        assert.ok(JSON.stringify(result).includes(code));
    });
}

test("classifyProbeError marks probe errors as verifier failures", () => {
    assert.equal(classifyProbeError(Object.assign(new Error("x"), { code: "PROBE_CONTAINER_INFRA" })).kind, "verifier");
});
