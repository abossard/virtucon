import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import MinimePromptfooProvider from "../provider.mjs";

test("provider forwards pre-aborted caller signal before runtime execution", async (t) => {
    const temp = await mkdtemp(path.join(tmpdir(), "provider-preabort-"));
    t.after(() => rm(temp, { recursive: true, force: true }));

    const previousToken = process.env.COPILOT_GITHUB_TOKEN;
    const previousSuite = process.env.PROMPTFOO_SUITE;
    const previousReceipt = process.env.PROMPTFOO_CALIBRATION_RECEIPT;
    process.env.COPILOT_GITHUB_TOKEN = "test-token";
    process.env.PROMPTFOO_SUITE = "ahm-parser-smoke@1";
    delete process.env.PROMPTFOO_CALIBRATION_RECEIPT;

    try {
        const provider = new MinimePromptfooProvider({ id: "minime-eval", config: { suite: "ahm-parser-smoke@1" } });
        const controller = new AbortController();
        controller.abort();
        const result = await provider.callApi("noop", {}, { abortSignal: controller.signal });
        assert.equal(result?.output?.status, "infrastructure_error");
        assert.equal(result?.output?.runtimeInfra?.code, "episode-aborted-before-runtime");
    } finally {
        if (previousToken === undefined) delete process.env.COPILOT_GITHUB_TOKEN;
        else process.env.COPILOT_GITHUB_TOKEN = previousToken;
        if (previousSuite === undefined) delete process.env.PROMPTFOO_SUITE;
        else process.env.PROMPTFOO_SUITE = previousSuite;
        if (previousReceipt === undefined) delete process.env.PROMPTFOO_CALIBRATION_RECEIPT;
        else process.env.PROMPTFOO_CALIBRATION_RECEIPT = previousReceipt;
    }
});
