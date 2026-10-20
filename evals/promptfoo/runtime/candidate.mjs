import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { RUNTIME_PAYLOAD_COMMIT } from "./contracts.mjs";

const execFileAsync = promisify(execFile);

export const CANDIDATE_PAYLOAD_ROOTS = Object.freeze([
    ".claude-plugin",
    ".github/extensions",
    "agents",
    "assets",
    "skills",
    "hooks",
]);
export const CANDIDATE_ALLOWED_PATHS = Object.freeze(["hooks/session-start.js", "agents/dr-evil.md"]);
export const CANDIDATE_SCHEMA_VERSION = 1;

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const FILE_MODES = new Set(["100644", "100755"]);

function sha256(data) {
    return createHash("sha256").update(data).digest("hex");
}

function modeOf(stats) {
    return stats.mode & 0o111 ? "100755" : "100644";
}

export function assertSafeRelativePath(candidatePath, label = "path") {
    if (typeof candidatePath !== "string" || !candidatePath) throw new Error(`${label} must be a non-empty string.`);
    if (candidatePath.includes("\0") || candidatePath.includes("\\")) throw new Error(`${label} has forbidden characters: ${candidatePath}`);
    if (path.posix.isAbsolute(candidatePath)) throw new Error(`${label} must be relative: ${candidatePath}`);
    const normalized = path.posix.normalize(candidatePath);
    if (normalized !== candidatePath || candidatePath === "." || candidatePath.split("/").includes("..")) {
        throw new Error(`${label} is not a normalized in-tree path: ${candidatePath}`);
    }
    if (!CANDIDATE_PAYLOAD_ROOTS.some((root) => candidatePath === root || candidatePath.startsWith(`${root}/`))) {
        throw new Error(`${label} is outside the plugin payload roots: ${candidatePath}`);
    }
    return candidatePath;
}

export function payloadDigest(files) {
    const hash = createHash("sha256");
    for (const file of files) hash.update(`${file.path}\0${file.mode}\0${file.sha256}\n`);
    return hash.digest("hex");
}

async function walkPayload(root, { relativeRoots = CANDIDATE_PAYLOAD_ROOTS } = {}) {
    const files = new Map();
    async function walk(absolute, relative) {
        const stats = await lstat(absolute);
        if (stats.isSymbolicLink()) throw new Error(`Symlink is forbidden in candidate payload: ${relative}`);
        if (stats.isDirectory()) {
            const entries = await readdir(absolute);
            entries.sort();
            for (const entry of entries) await walk(path.join(absolute, entry), `${relative}/${entry}`);
            return;
        }
        if (!stats.isFile()) throw new Error(`Unsupported entry type in candidate payload: ${relative}`);
        const bytes = await readFile(absolute);
        files.set(relative, { bytes, mode: modeOf(stats), sha256: sha256(bytes) });
    }
    for (const relativeRoot of relativeRoots) {
        try {
            await lstat(path.join(root, relativeRoot));
        } catch (error) {
            if (error?.code === "ENOENT") continue;
            throw error;
        }
        await walk(path.join(root, relativeRoot), relativeRoot);
    }
    return files;
}

function canonicalFiles(entries) {
    return [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function resolveCandidateSelection({ candidateManifestPath, approvedCandidateManifestSha256 } = {}) {
    const manifestPath = candidateManifestPath ? String(candidateManifestPath) : "";
    const approved = approvedCandidateManifestSha256 ? String(approvedCandidateManifestSha256).trim().toLowerCase() : "";
    if (!manifestPath && !approved) return null;
    if (!manifestPath) throw new Error("An approved candidate manifest hash requires --candidate-manifest.");
    if (!approved) throw new Error("--candidate-manifest requires --approved-candidate-manifest-sha256.");
    if (!path.isAbsolute(manifestPath)) throw new Error("--candidate-manifest must be an absolute path.");
    if (!SHA256_PATTERN.test(approved)) throw new Error("--approved-candidate-manifest-sha256 must be 64 lowercase hex characters.");
    return { candidateManifestPath: manifestPath, approvedCandidateManifestSha256: approved };
}

export async function loadVerifiedCandidate({ candidateManifestPath, approvedCandidateManifestSha256 }) {
    const selection = resolveCandidateSelection({ candidateManifestPath, approvedCandidateManifestSha256 });
    if (!selection) throw new Error("A candidate selection is required.");
    const manifestBytes = await readFile(selection.candidateManifestPath);
    const manifestSha256 = sha256(manifestBytes);
    if (manifestSha256 !== selection.approvedCandidateManifestSha256) {
        throw new Error(`Candidate manifest hash ${manifestSha256} does not match the approved hash ${selection.approvedCandidateManifestSha256}.`);
    }
    const manifest = JSON.parse(manifestBytes.toString("utf8"));
    if (manifest.schemaVersion !== CANDIDATE_SCHEMA_VERSION || manifest.kind !== "minime-candidate") {
        throw new Error("Unsupported candidate manifest schema.");
    }
    if (manifest.baseCommit !== RUNTIME_PAYLOAD_COMMIT) {
        throw new Error(`Candidate base commit ${manifest.baseCommit} is not the pinned ${RUNTIME_PAYLOAD_COMMIT}.`);
    }
    for (const field of ["baselineSha256", "patchSha256", "payloadSha256"]) {
        if (!SHA256_PATTERN.test(String(manifest[field] ?? ""))) throw new Error(`Candidate manifest field ${field} is not a SHA-256.`);
    }
    const directory = path.dirname(selection.candidateManifestPath);
    if (path.basename(directory) !== manifest.payloadSha256) {
        throw new Error("Candidate directory name does not match its payload SHA-256.");
    }
    const patchBytes = await readFile(path.join(directory, "patch.diff"));
    if (sha256(patchBytes) !== manifest.patchSha256) throw new Error("Candidate patch bytes do not match the manifest.");

    const listed = Array.isArray(manifest.files) ? manifest.files : [];
    const seen = new Set();
    let previous = "";
    for (const file of listed) {
        assertSafeRelativePath(file.path, "manifest file");
        if (file.path <= previous || seen.has(file.path)) throw new Error("Candidate manifest files must be unique and sorted.");
        previous = file.path;
        seen.add(file.path);
        if (!FILE_MODES.has(file.mode)) throw new Error(`Unexpected mode ${file.mode} for ${file.path}.`);
        if (!SHA256_PATTERN.test(String(file.sha256 ?? ""))) throw new Error(`Bad hash for ${file.path}.`);
        if (file.origin !== "base" && file.origin !== "delta") throw new Error(`Bad origin for ${file.path}.`);
    }
    const delta = listed.filter((file) => file.origin === "delta").map((file) => file.path);
    const reviewed = Array.isArray(manifest.reviewedPaths) ? [...manifest.reviewedPaths].sort() : [];
    if (JSON.stringify(delta) !== JSON.stringify(reviewed) || delta.length === 0) {
        throw new Error("Candidate delta files do not match the reviewed paths.");
    }
    for (const reviewedPath of reviewed) {
        if (!CANDIDATE_ALLOWED_PATHS.includes(reviewedPath)) throw new Error(`Unapproved candidate path: ${reviewedPath}`);
    }
    if (payloadDigest(listed) !== manifest.payloadSha256) throw new Error("Candidate manifest payload digest is inconsistent.");

    const payloadRoot = path.join(directory, "payload");
    const actual = await walkPayload(payloadRoot);
    if (actual.size !== listed.length) throw new Error("Candidate payload file set differs from the manifest.");
    for (const file of listed) {
        const found = actual.get(file.path);
        if (!found) throw new Error(`Candidate payload is missing ${file.path}.`);
        if (found.sha256 !== file.sha256 || found.mode !== file.mode) throw new Error(`Candidate payload bytes or mode drifted: ${file.path}.`);
    }
    return {
        candidateManifestPath: selection.candidateManifestPath,
        manifestSha256,
        payloadSha256: manifest.payloadSha256,
        patchSha256: manifest.patchSha256,
        baseCommit: manifest.baseCommit,
        baselineSha256: manifest.baselineSha256,
        reviewedPaths: reviewed,
        files: listed,
        fileCount: listed.length,
        payloadRoot,
        manifestBytes,
    };
}

export function candidateIdentity(verified) {
    return {
        candidateManifestPath: verified.candidateManifestPath,
        manifestSha256: verified.manifestSha256,
        payloadSha256: verified.payloadSha256,
        patchSha256: verified.patchSha256,
        baseCommit: verified.baseCommit,
        baselineSha256: verified.baselineSha256,
        reviewedPaths: verified.reviewedPaths,
        fileCount: verified.fileCount,
    };
}

async function git(projectRoot, args) {
    const { stdout } = await execFileAsync("git", ["-C", projectRoot, ...args], {
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
        maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
}

async function buildPatch({ reviewed, baseFiles, deltaBytes, scratch }) {
    const chunks = [];
    for (const relative of reviewed) {
        const before = path.join(scratch, "a", relative);
        const after = path.join(scratch, "b", relative);
        await mkdir(path.dirname(before), { recursive: true });
        await mkdir(path.dirname(after), { recursive: true });
        await writeFile(before, baseFiles.get(relative).bytes);
        await writeFile(after, deltaBytes.get(relative));
        try {
            await execFileAsync("git", ["diff", "--no-index", "--no-color", "--", `a/${relative}`, `b/${relative}`], {
                cwd: scratch,
                env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
                maxBuffer: 64 * 1024 * 1024,
            });
        } catch (error) {
            if (error?.code !== 1 || typeof error.stdout !== "string") throw error;
            chunks.push(error.stdout);
        }
    }
    return chunks.join("");
}

async function assertExistingMatches({ finalDirectory, manifestText, patchText }) {
    const existingManifest = await readFile(path.join(finalDirectory, "manifest.json"), "utf8");
    const existingPatch = await readFile(path.join(finalDirectory, "patch.diff"), "utf8");
    if (existingManifest !== manifestText || existingPatch !== patchText) {
        throw new Error(`Existing candidate directory ${finalDirectory} differs from the freshly assembled identity; refusing to reuse or delete it.`);
    }
    await loadVerifiedCandidate({
        candidateManifestPath: path.join(finalDirectory, "manifest.json"),
        approvedCandidateManifestSha256: sha256(manifestText),
    });
}

export async function prepareCandidate({
    projectRoot,
    baselinePath,
    paths,
    candidatesRoot,
    materializeBase,
}) {
    if (typeof materializeBase !== "function") throw new Error("prepareCandidate requires a materializeBase function.");
    if (!Array.isArray(paths) || paths.length === 0) throw new Error("prepareCandidate requires at least one reviewed path.");
    const reviewed = [...new Set(paths)].sort();
    if (reviewed.length !== paths.length) throw new Error("Reviewed paths must be unique.");
    for (const reviewedPath of reviewed) {
        assertSafeRelativePath(reviewedPath, "reviewed path");
        if (!CANDIDATE_ALLOWED_PATHS.includes(reviewedPath)) throw new Error(`Unapproved candidate path: ${reviewedPath}`);
    }

    const baselineBytes = await readFile(baselinePath);
    const baseline = JSON.parse(baselineBytes.toString("utf8"));
    if (baseline.baseCommit !== RUNTIME_PAYLOAD_COMMIT) throw new Error("Baseline base commit is not the pinned payload commit.");
    const head = (await git(projectRoot, ["rev-parse", "HEAD"])).trim();
    if (head !== baseline.baseCommit) throw new Error(`Baseline drift: HEAD ${head} differs from ${baseline.baseCommit}.`);
    const indexPath = path.resolve(projectRoot, (await git(projectRoot, ["rev-parse", "--git-path", "index"])).trim());
    if (sha256(await readFile(indexPath)) !== baseline.gitIndexSha256) throw new Error("Baseline drift: the Git index changed.");
    const baselineEntries = new Map((baseline.sourcePayloadManifest ?? []).map((entry) => [entry.path, entry]));
    const dirtyPaths = new Set(baseline.dirtySourcePayloadPaths ?? []);
    for (const reviewedPath of reviewed) {
        if (dirtyPaths.has(reviewedPath)) throw new Error(`Reviewed path was dirty at baseline: ${reviewedPath}`);
    }

    await mkdir(candidatesRoot, { recursive: true });
    const scratch = path.join(candidatesRoot, `.tmp-${randomUUID()}`);
    const stagingBase = path.join(scratch, "base");
    await mkdir(stagingBase, { recursive: true });
    try {
        await materializeBase({ projectRoot, commit: baseline.baseCommit, stagingPayloadRoot: stagingBase });
        const baseFiles = await walkPayload(stagingBase);
        const sourceFiles = await walkPayload(projectRoot);

        for (const [relative, entry] of baselineEntries) {
            const base = baseFiles.get(relative);
            if (!base || base.sha256 !== entry.baseSha256) throw new Error(`Baseline base hash does not match the pinned commit: ${relative}`);
        }
        const all = new Set([...baseFiles.keys(), ...sourceFiles.keys()]);
        const deltaBytes = new Map();
        for (const relative of [...all].sort()) {
            const base = baseFiles.get(relative);
            const source = sourceFiles.get(relative);
            if (!base) throw new Error(`Unreviewed added source file: ${relative}`);
            if (!source) throw new Error(`Unreviewed removed source file: ${relative}`);
            if (reviewed.includes(relative)) {
                if (source.mode !== base.mode) throw new Error(`Reviewed path changed mode: ${relative}`);
                if (source.sha256 === base.sha256) throw new Error(`Reviewed path has no change from base: ${relative}`);
                deltaBytes.set(relative, source.bytes);
            } else if (dirtyPaths.has(relative)) {
                const entry = baselineEntries.get(relative);
                if (!entry || source.sha256 !== entry.sourceSha256) throw new Error(`Baseline drift in unrelated dirty file: ${relative}`);
            } else if (source.sha256 !== base.sha256 || source.mode !== base.mode) {
                throw new Error(`Unreviewed change in production source: ${relative}`);
            }
        }

        const files = canonicalFiles([...baseFiles.entries()].map(([relative, base]) => {
            const delta = deltaBytes.get(relative);
            return delta
                ? { path: relative, mode: base.mode, sha256: sha256(delta), origin: "delta", baseSha256: base.sha256 }
                : { path: relative, mode: base.mode, sha256: base.sha256, origin: "base" };
        }));
        const patchText = await buildPatch({ reviewed, baseFiles, deltaBytes, scratch });
        const payloadSha256 = payloadDigest(files);
        const manifest = {
            schemaVersion: CANDIDATE_SCHEMA_VERSION,
            kind: "minime-candidate",
            baseCommit: baseline.baseCommit,
            baselineSha256: sha256(baselineBytes),
            reviewedPaths: reviewed,
            patchSha256: sha256(patchText),
            payloadSha256,
            files,
        };
        const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
        const manifestSha256 = sha256(manifestText);
        const finalDirectory = path.join(candidatesRoot, payloadSha256);
        const manifestPath = path.join(finalDirectory, "manifest.json");

        let reused = false;
        try {
            await lstat(finalDirectory);
            reused = true;
        } catch (error) {
            if (error?.code !== "ENOENT") throw error;
        }
        if (reused) {
            await assertExistingMatches({ finalDirectory, manifestText, patchText });
        } else {
            const assembled = path.join(scratch, "assembled");
            for (const file of files) {
                const target = path.join(assembled, "payload", file.path);
                await mkdir(path.dirname(target), { recursive: true });
                await writeFile(target, deltaBytes.get(file.path) ?? baseFiles.get(file.path).bytes, { mode: parseInt(file.mode.slice(3), 8) === 0o755 ? 0o755 : 0o644 });
            }
            await writeFile(path.join(assembled, "patch.diff"), patchText);
            await writeFile(path.join(assembled, "manifest.json"), manifestText);
            await rename(assembled, finalDirectory);
        }
        return {
            candidateManifestPath: manifestPath,
            candidateDirectory: finalDirectory,
            baseCommit: baseline.baseCommit,
            baselineSha256: manifest.baselineSha256,
            patchSha256: manifest.patchSha256,
            payloadSha256,
            manifestSha256,
            reviewedPaths: reviewed,
            fileCount: files.length,
            reused,
        };
    } finally {
        await rm(scratch, { recursive: true, force: true });
    }
}
