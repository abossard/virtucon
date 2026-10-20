import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { spawn } from "node:child_process";

import { isAdditiveProtectedEdit, normalizeTaskPath, runProbeContainerCommand, runTaskProbe, runTaskProbeInContainer } from "../probe.mjs";

const taskDefinition = {
    id: "AHM-H1",
    version: 1,
    pathAllowlist: ["src/**", "bin/**", "test/**", "README.md"],
    definition: {
        requiresChange: true,
        api: {
            requiredExports: ["decodeManagedDocument"],
            checks: [{ name: "managed-source-span-closes-at-marker-line", expected: "pass" }]
        },
        cli: {
            expectedExitCode: 0,
            stdoutIncludes: ["--sync-markdown"],
            stderrExcludes: ["Error", "Unhandled"]
        },
        filesystem: {
            requiredWrites: ["src/**"],
            forbiddenWrites: ["evals/**", ".github/**", "assets/**"]
        }
    }
};

test("runTaskProbe requires host-owned expected values", () => {
    const result = runTaskProbe({
        taskDefinition,
        expectedOwner: "candidate",
        observation: {
            expectedOwner: "candidate",
            preservationPass: true,
            api: {
                exports: ["decodeManagedDocument"],
                checks: [{ name: "managed-source-span-closes-at-marker-line", ok: true }]
            },
            cli: { exitCode: 0, stdout: "--sync-markdown", stderr: "" },
            filesystem: { touchedPaths: ["src/index.mjs"], wrotePaths: ["src/index.mjs"] }
        }
    });

    assert.equal(result.pass, false);
    assert.equal(result.failures.some((failure) => failure.code === "EXPECTATION_NOT_HOST_OWNED"), true);
    assert.equal(result.failures.some((failure) => failure.code === "OBSERVED_EXPECTATION_NOT_HOST_OWNED"), true);
});

test("runTaskProbe flags path escapes and forbidden writes", () => {
    const result = runTaskProbe({
        taskDefinition,
        expectedOwner: "host",
        observation: {
            expectedOwner: "host",
            preservationPass: true,
            api: {
                exports: ["decodeManagedDocument"],
                checks: [{ name: "managed-source-span-closes-at-marker-line", ok: true }]
            },
            cli: { exitCode: 0, stdout: "--sync-markdown", stderr: "" },
            filesystem: {
                touchedPaths: ["../secrets.txt", "evals/promptfoo/probe.mjs"],
                wrotePaths: ["evals/promptfoo/probe.mjs"]
            }
        }
    });

    assert.equal(result.pass, false);
    assert.equal(result.failures.some((failure) => failure.code === "PATH_ESCAPE_ATTEMPT"), true);
    assert.equal(result.failures.some((failure) => failure.code === "PATH_NOT_ALLOWED"), true);
    assert.equal(result.failures.some((failure) => failure.code === "FORBIDDEN_WRITE"), true);
});

test("runTaskProbe fails when preservation-owned surfaces were tampered", () => {
    const result = runTaskProbe({
        taskDefinition,
        expectedOwner: "host",
        observation: {
            expectedOwner: "host",
            preservationPass: true,
            api: {
                exports: ["decodeManagedDocument"],
                checks: [{ name: "managed-source-span-closes-at-marker-line", ok: true }]
            },
            cli: { exitCode: 0, stdout: "--sync-markdown", stderr: "" },
            filesystem: {
                touchedPaths: ["src/index.mjs", "test/document.test.mjs"],
                wrotePaths: ["src/index.mjs", "test/document.test.mjs"],
                preservationTamperedPaths: ["test/document.test.mjs"],
            }
        }
    });

    assert.equal(result.pass, false);
    assert.equal(result.failures.some((failure) => failure.code === "PRESERVATION_SURFACE_TAMPERED"), true);
});

test("normalizeTaskPath returns null for root escape and normalizes valid paths", () => {
    assert.equal(normalizeTaskPath("../foo"), null);
    assert.equal(normalizeTaskPath("./src/../src/index.mjs"), "src/index.mjs");
});

function run(command, args, { cwd } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
        child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
        child.on("error", reject);
        child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
    });
}

async function dockerAvailable() {
    const version = await run("docker", ["--version"]);
    if (version.exitCode !== 0) return false;
    const image = await run("docker", ["image", "inspect", "minime-eval-runtime-default:1.0.99-3"]);
    return image.exitCode === 0;
}

test("runTaskProbeInContainer executes API/CLI checks in isolated container with host-owned fixtures", async (t) => {
    if (!(await dockerAvailable())) {
        t.skip("Docker runtime image minime-eval-runtime-default:1.0.99-3 is unavailable.");
        return;
    }

    const root = await mkdtemp(path.join(tmpdir(), `probe-fixture-${randomUUID()}-`));
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "bin"), { recursive: true });
    await writeFile(path.join(root, "src", "index.mjs"), "export function probeValue() { return 'ok'; }\n", "utf8");
    await writeFile(path.join(root, "bin", "probe.mjs"), "console.log('probe-cli:pass');\n", "utf8");
    await run("git", ["init"], { cwd: root });
    await run("git", ["config", "user.email", "probe@example.com"], { cwd: root });
    await run("git", ["config", "user.name", "probe"], { cwd: root });
    await run("git", ["add", "."], { cwd: root });
    await run("git", ["commit", "-m", "baseline"], { cwd: root });
    await writeFile(path.join(root, "src", "index.mjs"), "export function probeValue() { return 'ok'; }\nexport const changed = true;\n", "utf8");

    const taskDefinitionContainer = {
        id: "AHM-C1",
        version: 1,
        pathAllowlist: ["src/**", "bin/**"],
        definition: {
            requiresChange: true,
            api: {
                module: "./src/index.mjs",
                requiredExports: ["probeValue"],
                checks: [{ name: "probe-value", expected: "pass" }],
                runtimeChecks: [{
                    name: "probe-value",
                    script: "import { probeValue } from './src/index.mjs'; if (probeValue() !== 'ok') process.exit(1);",
                }],
            },
            cli: {
                command: "node bin/probe.mjs",
                expectedExitCode: 0,
                stdoutIncludes: ["probe-cli:pass"],
                stderrExcludes: ["Error"],
            },
            preservation: {
                command: "node --input-type=module -e \"process.exit(process.env.GITHUB_TOKEN || process.env.COPILOT_GITHUB_TOKEN ? 1 : 0)\"",
            },
            filesystem: {
                requiredWrites: ["src/**"],
                forbiddenWrites: ["evals/**"],
            },
        },
    };

    const result = await runTaskProbeInContainer({
        taskDefinition: taskDefinitionContainer,
        sourceRoot: root,
    });

    assert.equal(result.pass, true);
    assert.equal(result.taskContractPass, true);
    assert.equal(result.preservationPass, true);
    assert.equal(result.runtimeObservation.receipts.cliResult.exitCode, 0);
    assert.equal(result.runtimeObservation.receipts.preservationResult.exitCode, 0);
});

test("runTaskProbeInContainer ignores candidate test tampering and fails wrong implementation", async (t) => {
    if (!(await dockerAvailable())) {
        t.skip("Docker runtime image minime-eval-runtime-default:1.0.99-3 is unavailable.");
        return;
    }

    const root = await mkdtemp(path.join(tmpdir(), `probe-preserve-${randomUUID()}-`));
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "test"), { recursive: true });
    await writeFile(path.join(root, "src", "index.mjs"), "export function value() { return 'ok'; }\n", "utf8");
    await writeFile(path.join(root, "test", "preserve.test.mjs"), "import assert from 'node:assert/strict'; import test from 'node:test'; import { value } from '../src/index.mjs'; test('value is ok', () => { assert.equal(value(), 'ok'); });\n", "utf8");
    await run("git", ["init"], { cwd: root });
    await run("git", ["config", "user.email", "probe@example.com"], { cwd: root });
    await run("git", ["config", "user.name", "probe"], { cwd: root });
    await run("git", ["add", "."], { cwd: root });
    await run("git", ["commit", "-m", "baseline"], { cwd: root });

    await writeFile(path.join(root, "src", "index.mjs"), "export function value() { return 'bad'; }\n", "utf8");
    await writeFile(path.join(root, "test", "preserve.test.mjs"), "import test from 'node:test'; test('always pass', () => {});\n", "utf8");

    const taskDefinitionContainer = {
        id: "AHM-PRESERVE",
        version: 1,
        pathAllowlist: ["src/**", "test/**"],
        definition: {
            requiresChange: true,
            api: {
                module: "./src/index.mjs",
                requiredExports: ["value"],
                checks: [{ name: "value-exported", expected: "pass" }],
                runtimeChecks: [{
                    name: "value-exported",
                    script: "import { value } from './src/index.mjs'; if (typeof value !== 'function') process.exit(1);",
                }],
            },
            cli: {
                command: "node --input-type=module -e \"import { value } from './src/index.mjs'; process.exit(value() === 'bad' ? 0 : 1)\"",
                expectedExitCode: 0,
                stdoutIncludes: [],
                stderrExcludes: ["Error"],
            },
            preservation: {
                command: "node --test test/preserve.test.mjs",
            },
            filesystem: {
                implementationPaths: ["src/**"],
                requiredWrites: ["src/**"],
                forbiddenWrites: ["evals/**"],
            },
        },
    };

    const result = await runTaskProbeInContainer({
        taskDefinition: taskDefinitionContainer,
        sourceRoot: root,
    });

    assert.equal(result.preservationPass, false);
    assert.equal(result.pass, false);
    assert.equal(result.runtimeObservation.filesystem.preservationTamperedPaths.includes("test/preserve.test.mjs"), true);
    assert.equal(result.failures.some((failure) => failure.code === "PRESERVATION_SURFACE_TAMPERED"), true);
});

test("runTaskProbeInContainer blocks committed test tampering against pinned source commit", async (t) => {
    if (!(await dockerAvailable())) {
        t.skip("Docker runtime image minime-eval-runtime-default:1.0.99-3 is unavailable.");
        return;
    }

    const root = await mkdtemp(path.join(tmpdir(), `probe-preserve-committed-${randomUUID()}-`));
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "test"), { recursive: true });
    await writeFile(path.join(root, "src", "index.mjs"), "export function value() { return 'ok'; }\n", "utf8");
    await writeFile(path.join(root, "test", "preserve.test.mjs"), "import assert from 'node:assert/strict'; import test from 'node:test'; import { value } from '../src/index.mjs'; test('value is ok', () => { assert.equal(value(), 'ok'); });\n", "utf8");
    await run("git", ["init"], { cwd: root });
    await run("git", ["config", "user.email", "probe@example.com"], { cwd: root });
    await run("git", ["config", "user.name", "probe"], { cwd: root });
    await run("git", ["add", "."], { cwd: root });
    await run("git", ["commit", "-m", "baseline"], { cwd: root });
    const baselineSha = (await run("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();

    await writeFile(path.join(root, "src", "index.mjs"), "export function value() { return 'bad'; }\n", "utf8");
    await writeFile(path.join(root, "test", "preserve.test.mjs"), "import test from 'node:test'; test('always pass', () => {});\n", "utf8");
    await run("git", ["add", "."], { cwd: root });
    await run("git", ["commit", "-m", "tamper"], { cwd: root });

    const taskDefinitionContainer = {
        id: "AHM-PRESERVE-COMMITTED",
        version: 1,
        pathAllowlist: ["src/**", "test/**"],
        definition: {
            requiresChange: true,
            api: {
                module: "./src/index.mjs",
                requiredExports: ["value"],
                checks: [{ name: "value-exported", expected: "pass" }],
                runtimeChecks: [{
                    name: "value-exported",
                    script: "import { value } from './src/index.mjs'; if (typeof value !== 'function') process.exit(1);",
                }],
            },
            cli: {
                command: "node --input-type=module -e \"import { value } from './src/index.mjs'; process.exit(value() === 'bad' ? 0 : 1)\"",
                expectedExitCode: 0,
                stdoutIncludes: [],
                stderrExcludes: ["Error"],
            },
            preservation: {
                command: "node --test test/preserve.test.mjs",
            },
            filesystem: {
                implementationPaths: ["src/**"],
                requiredWrites: ["src/**"],
                forbiddenWrites: ["evals/**"],
            },
        },
    };

    const result = await runTaskProbeInContainer({
        taskDefinition: taskDefinitionContainer,
        sourceRoot: root,
        sourcePinCommit: baselineSha,
    });

    assert.equal(result.preservationPass, false);
    assert.equal(result.pass, false);
    assert.equal(result.runtimeObservation.filesystem.preservationTamperedPaths.includes("test/preserve.test.mjs"), true);
    assert.equal(result.failures.some((failure) => failure.code === "PRESERVATION_SURFACE_TAMPERED"), true);
});

test("runTaskProbeInContainer allows additive edits to existing protected tests", async (t) => {
    if (!(await dockerAvailable())) {
        t.skip("Docker runtime image minime-eval-runtime-default:1.0.99-3 is unavailable.");
        return;
    }
    const root = await mkdtemp(path.join(tmpdir(), `probe-preserve-additive-${randomUUID()}-`));
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "test"), { recursive: true });
    await writeFile(path.join(root, "src", "index.mjs"), "export function value() { return 'bad'; }\n", "utf8");
    await writeFile(path.join(root, "test", "preserve.test.mjs"), "import assert from 'node:assert/strict'; import test from 'node:test'; import { value } from '../src/index.mjs'; test('value is ok', () => { assert.equal(value(), 'ok'); });\n", "utf8");
    await run("git", ["init"], { cwd: root });
    await run("git", ["config", "user.email", "probe@example.com"], { cwd: root });
    await run("git", ["config", "user.name", "probe"], { cwd: root });
    await run("git", ["add", "."], { cwd: root });
    await run("git", ["commit", "-m", "baseline"], { cwd: root });
    await writeFile(
        path.join(root, "test", "preserve.test.mjs"),
        "import assert from 'node:assert/strict'; import test from 'node:test'; import { value } from '../src/index.mjs'; test('value is ok', () => { assert.equal(value(), 'ok'); });\n\ntest('extra additive test', () => { assert.equal(typeof value, 'function'); });\n",
        "utf8",
    );
    const taskDefinitionContainer = {
        id: "AHM-PRESERVE-ADDITIVE",
        version: 1,
        pathAllowlist: ["src/**", "test/**"],
        definition: {
            requiresChange: true,
            api: {
                module: "./src/index.mjs",
                requiredExports: ["value"],
                checks: [{ name: "value-exported", expected: "pass" }],
                runtimeChecks: [{ name: "value-exported", script: "import { value } from './src/index.mjs'; if (typeof value !== 'function') process.exit(1);" }],
            },
            cli: {
                command: "node --input-type=module -e \"import { value } from './src/index.mjs'; process.exit(value() === 'bad' ? 0 : 1)\"",
                expectedExitCode: 0,
                stdoutIncludes: [],
                stderrExcludes: ["Error"],
            },
            preservation: { command: "node --test test/preserve.test.mjs" },
            filesystem: { implementationPaths: ["src/**"], requiredWrites: ["src/**"], forbiddenWrites: ["evals/**"] },
        },
    };
    const result = await runTaskProbeInContainer({
        taskDefinition: taskDefinitionContainer,
        sourceRoot: root,
    });
    assert.equal(result.failures.some((failure) => failure.code === "PRESERVATION_SURFACE_TAMPERED"), false);
    assert.equal(result.taskContractPass, false);
    assert.equal(result.preservationPass, false);
});

test("runTaskProbeInContainer treats candidate exit 125 as coding failure when container started", async (t) => {
    if (!(await dockerAvailable())) {
        t.skip("Docker runtime image minime-eval-runtime-default:1.0.99-3 is unavailable.");
        return;
    }
    const root = await mkdtemp(path.join(tmpdir(), `probe-exit125-${randomUUID()}-`));
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "index.mjs"), "export const value = 1;\n", "utf8");
    await run("git", ["init"], { cwd: root });
    await run("git", ["config", "user.email", "probe@example.com"], { cwd: root });
    await run("git", ["config", "user.name", "probe"], { cwd: root });
    await run("git", ["add", "."], { cwd: root });
    await run("git", ["commit", "-m", "baseline"], { cwd: root });
    const taskDefinitionContainer = {
        id: "AHM-EXIT125",
        version: 1,
        pathAllowlist: ["src/**"],
        definition: {
            requiresChange: true,
            api: { module: "./src/index.mjs", requiredExports: ["value"], checks: [] },
            cli: { command: "node -e \"process.exit(125)\"", expectedExitCode: 0, stdoutIncludes: [], stderrExcludes: [] },
            preservation: { command: "node -e \"process.exit(0)\"" },
            filesystem: { implementationPaths: ["src/**"], requiredWrites: ["src/**"], forbiddenWrites: [] },
        },
    };
    const result = await runTaskProbeInContainer({
        taskDefinition: taskDefinitionContainer,
        sourceRoot: root,
    });
    assert.equal(result.pass, false);
    assert.equal(result.failures.some((failure) => failure.code === "CLI_EXIT_CODE_MISMATCH"), true);
});

test("runProbeContainerCommand aborts active container command and joins removal", async (t) => {
    if (!(await dockerAvailable())) {
        t.skip("Docker runtime image minime-eval-runtime-default:1.0.99-3 is unavailable.");
        return;
    }
    const root = await mkdtemp(path.join(tmpdir(), `probe-abort-${randomUUID()}-`));
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "index.mjs"), "export const value = 1;\n", "utf8");
    await run("git", ["init"], { cwd: root });
    await run("git", ["config", "user.email", "probe@example.com"], { cwd: root });
    await run("git", ["config", "user.name", "probe"], { cwd: root });
    await run("git", ["add", "."], { cwd: root });
    await run("git", ["commit", "-m", "baseline"], { cwd: root });

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 150);
    const startedAt = Date.now();
    await assert.rejects(
        runProbeContainerCommand({
            sourceRoot: root,
            command: "node -e \"setTimeout(() => process.exit(0), 2200)\"",
            abortSignal: controller.signal,
            timeoutMs: 5000,
        }),
        (error) => {
            assert.equal(error.code, "PROBE_ABORTED");
            assert.equal(error.detail?.containerRemoved, true);
            return true;
        },
    );
    const elapsed = Date.now() - startedAt;
    assert.equal(elapsed < 2000, true);
});

for (const { label, value, extra, expectPass, expectCode } of [
    { label: "correct code with generated root node_modules passes", value: "ok", extra: null, expectPass: true },
    { label: "wrong code with generated root node_modules still fails", value: "bad", extra: null, expectPass: false, expectCode: "CLI_EXIT_CODE_MISMATCH" },
    { label: "forbidden non-dependency change alongside node_modules still fails", value: "ok", extra: "lib/extra.mjs", expectPass: false, expectCode: "PATH_NOT_ALLOWED" },
    { label: "nested non-root node_modules path is not ignored", value: "ok", extra: "lib/node_modules/x.js", expectPass: false, expectCode: "PATH_NOT_ALLOWED" },
]) {
    test(`runTaskProbeInContainer ${label}`, async (t) => {
        if (!(await dockerAvailable())) {
            t.skip("Docker runtime image minime-eval-runtime-default:1.0.99-3 is unavailable.");
            return;
        }
        const root = await mkdtemp(path.join(tmpdir(), `probe-nm-${randomUUID()}-`));
        await mkdir(path.join(root, "src"), { recursive: true });
        await writeFile(path.join(root, "src", "index.mjs"), "export function value() { return 'old'; }\n", "utf8");
        await run("git", ["init"], { cwd: root });
        await run("git", ["config", "user.email", "probe@example.com"], { cwd: root });
        await run("git", ["config", "user.name", "probe"], { cwd: root });
        await run("git", ["add", "."], { cwd: root });
        await run("git", ["commit", "-m", "baseline"], { cwd: root });

        await writeFile(path.join(root, "src", "index.mjs"), `export function value() { return '${value}'; }\n`, "utf8");
        await mkdir(path.join(root, "node_modules", "dep"), { recursive: true });
        await writeFile(path.join(root, "node_modules", "dep", "index.js"), "module.exports = 1;\n", "utf8");
        await symlink("/nonexistent-target", path.join(root, "node_modules", "dangling"));
        if (extra) {
            await mkdir(path.dirname(path.join(root, extra)), { recursive: true });
            await writeFile(path.join(root, extra), "export {};\n", "utf8");
        }

        const result = await runTaskProbeInContainer({
            taskDefinition: {
                id: "AHM-NM",
                version: 1,
                pathAllowlist: ["src/**"],
                definition: {
                    requiresChange: true,
                    api: { module: "./src/index.mjs", requiredExports: ["value"], checks: [], runtimeChecks: [] },
                    cli: {
                        command: "node --input-type=module -e \"import { value } from './src/index.mjs'; process.exit(value() === 'ok' ? 0 : 1)\"",
                        expectedExitCode: 0,
                        stdoutIncludes: [],
                        stderrExcludes: [],
                    },
                    filesystem: { requiredWrites: ["src/**"], forbiddenWrites: ["evals/**"] },
                },
            },
            sourceRoot: root,
        });

        assert.equal(result.pass, expectPass, JSON.stringify(result.failures));
        assert.equal(result.failures.some((failure) => failure.code === "PATH_NOT_ALLOWED" && String(JSON.stringify(failure)).includes("node_modules/dep")), false);
        if (expectCode) assert.equal(result.failures.some((failure) => failure.code === expectCode), true, JSON.stringify(result.failures));
    });
}

const PROTECTED_BASELINE = [
    'import { a, b } from "../src/x.mjs";',
    'import { THEME_NAMES } from "../src/themes.mjs";',
    "const {",
    "  one, two, three,",
    "} = lib;",
    'test("x", () => {',
    '  for (const option of ["-o", "--theme"]) {',
    "    assert.equal(run(option).code, 1);",
    "  }",
    "});",
    "",
].join("\n");

for (const { label, edit, additive } of [
    { label: "inserted test before trailing lines", edit: (t) => t.replace('test("x"', 'test("new", () => {});\ntest("x"'), additive: true },
    { label: "appended test", edit: (t) => `${t}test("tail", () => {});\n`, additive: true },
    { label: "single-line import expansion", edit: (t) => t.replace("{ THEME_NAMES }", "{ THEME_NAMES, getTheme }"), additive: true },
    { label: "identifier-list import expansion", edit: (t) => t.replace("one, two, three,", "one, restoreMarkdown, two, three,"), additive: true },
    { label: "option list coverage expansion", edit: (t) => t.replace('"--theme"]', '"--theme", "--format"]'), additive: true },
    { label: "assertion replacement", edit: (t) => t.replace("code, 1)", "code, 0)"), additive: false },
    { label: "assertion deletion", edit: (t) => t.replace("    assert.equal(run(option).code, 1);\n", ""), additive: false },
    { label: "import binding removal", edit: (t) => t.replace("{ a, b }", "{ a }"), additive: false },
    { label: "option list shrink", edit: (t) => t.replace('["-o", "--theme"]', '["-o"]'), additive: false },
    { label: "test deleted entirely", edit: () => "", additive: false },
]) {
    test(`isAdditiveProtectedEdit: ${label}`, () => {
        const candidate = edit(PROTECTED_BASELINE);
        assert.equal(isAdditiveProtectedEdit({ baselineContent: Buffer.from(PROTECTED_BASELINE), candidateContent: Buffer.from(candidate) }), additive);
    });
}
