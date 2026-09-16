import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, resolve, sep } from "node:path";
import {
    lstatSync,
    readFileSync,
    realpathSync,
} from "node:fs";
import {
    mkdir,
    open,
    readFile,
    rename,
    rm,
    stat,
    writeFile,
} from "node:fs/promises";

const LOCK_TIMEOUT_MS = 10_000;
const LOCK_RETRY_MS = 20;
const PRIVATE_FILE_MODE = 0o600;
const APPLY_CONTEXT_PHASES = new Set(["blueprint", "replicate", "inspect", "extract", "unknown"]);
const MAX_APPLY_CONTEXT_IDS = 128;
const PROTECTED_HEADINGS = ["## Criteria archive", "## User's original request"];
const DOCUMENT_POLICY_BLUEPRINT = "blueprint";
const DOCUMENT_POLICY_GENERIC = "generic";

function fail(status, message, extra = {}) {
    return Object.assign(new Error(message), { status, ...extra });
}

function wait(ms) {
    return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

function digest(markdown) {
    return createHash("sha256").update(markdown, "utf8").digest("hex");
}

function normalizeRoot(path) {
    const candidate = resolve(path);
    try {
        return realpathSync(candidate);
    } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        return candidate;
    }
}

function assertWithinRoot(root, path) {
    if (path === root) return;
    if (!path.startsWith(`${root}${sep}`)) throw fail(400, "Path is outside the allowed root.");
}

function canonicalDocumentPath({ draftRoot, documentPath, allowMissing = false }) {
    if (typeof documentPath !== "string" || !documentPath) {
        throw fail(400, "Document path is required.");
    }
    const root = normalizeRoot(draftRoot);
    const candidate = resolve(documentPath);
    try {
        if (!lstatSync(candidate).isFile()) throw fail(404, "Document file is missing.");
        const path = realpathSync(candidate);
        assertWithinRoot(root, path);
        return {
            root,
            path,
            filename: basename(path),
            artifactRoot: dirname(path),
            exists: true,
        };
    } catch (error) {
        if (error?.status) throw error;
        if (error?.code !== "ENOENT") throw error;
        if (!allowMissing) throw fail(404, "Document file is missing.");
    }
    const parent = dirname(candidate);
    let canonicalParent;
    try {
        canonicalParent = realpathSync(parent);
    } catch {
        throw fail(404, "Document file is missing.");
    }
    assertWithinRoot(root, canonicalParent);
    const filename = basename(candidate);
    return {
        root,
        path: resolve(canonicalParent, filename),
        filename,
        artifactRoot: canonicalParent,
        exists: false,
    };
}

function artifactKey(sessionId, documentPath) {
    if (typeof sessionId !== "string" || !sessionId.trim()) {
        throw fail(400, "Session identity is required.");
    }
    return createHash("sha256")
        .update(`${sessionId}\n${documentPath}`, "utf8")
        .digest("hex");
}

function documentKey(documentPath) {
    return createHash("sha256").update(documentPath, "utf8").digest("hex");
}

function artifactPaths(artifactRoot, key, sharedKey) {
    const draftsRoot = resolve(artifactRoot, ".drafts");
    return {
        draftsRoot,
        draftLockPath: resolve(draftsRoot, `${key}.lock`),
        documentLockPath: resolve(draftsRoot, `${sharedKey}.document.lock`),
        draftPath: resolve(draftsRoot, `${key}.json`),
        conflictRoot: resolve(draftsRoot, `${key}.conflicts`),
    };
}

function readJson(path) {
    try {
        return JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
        if (error?.code === "ENOENT") return null;
        throw fail(500, "Draft state is unreadable.");
    }
}

async function atomicWrite(path, content, { mode = null, preserveMode = false } = {}) {
    let fileMode = mode;
    if (preserveMode) {
        try {
            const details = await stat(path);
            fileMode = details.mode & 0o777;
        } catch (error) {
            if (error?.code !== "ENOENT") throw error;
        }
    }
    const temp = `${path}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
    try {
        if (typeof fileMode === "number") {
            await writeFile(temp, content, { encoding: "utf8", mode: fileMode });
        } else {
            await writeFile(temp, content, "utf8");
        }
        await rename(temp, path);
    } catch (error) {
        await rm(temp, { force: true });
        throw error;
    }
}

function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        if (error?.code === "ESRCH") return false;
        return true;
    }
}

async function shouldBreakLock(lockPath) {
    let metaText = "";
    try {
        metaText = await readFile(lockPath, "utf8");
    } catch (error) {
        if (error?.code === "ENOENT") return false;
        throw error;
    }
    let meta = {};
    try {
        meta = JSON.parse(metaText);
    } catch {
        meta = {};
    }
    const staleByPid = typeof meta.pid === "number" && !isProcessAlive(meta.pid);
    return staleByPid;
}

async function removeAbandonedLock(lockPath) {
    const claimPath = `${lockPath}.reclaim`;
    let claim;
    try {
        claim = await open(claimPath, "wx", PRIVATE_FILE_MODE);
    } catch (error) {
        if (error?.code === "EEXIST") return false;
        throw error;
    }
    try {
        if (!await shouldBreakLock(lockPath)) return false;
        await rm(lockPath, { force: true });
        return true;
    } finally {
        await claim.close();
        await rm(claimPath, { force: true });
    }
}

async function withLock(lockPath, operation) {
    await mkdir(dirname(lockPath), { recursive: true });
    if (realpathSync(dirname(lockPath)) !== dirname(lockPath)) {
        throw fail(400, "Draft storage must not be a symlink.");
    }
    const timeoutAt = Date.now() + LOCK_TIMEOUT_MS;
    let handle;
    while (!handle) {
        try {
            handle = await open(lockPath, "wx", PRIVATE_FILE_MODE);
            await handle.writeFile(JSON.stringify({
                pid: process.pid,
                acquiredAt: new Date().toISOString(),
            }), "utf8");
        } catch (error) {
            if (error?.code !== "EEXIST") throw error;
            if (await removeAbandonedLock(lockPath)) continue;
            if (Date.now() >= timeoutAt) {
                throw fail(504, "Timed out waiting for document lock.");
            }
            await wait(LOCK_RETRY_MS);
        }
    }
    try {
        return await operation();
    } finally {
        await handle.close();
        await rm(lockPath, { force: true });
    }
}

function readDocument({ root, path, filename }) {
    const markdown = readFileSync(path, "utf8");
    return {
        filename,
        path,
        markdown,
        revision: digest(markdown),
    };
}

function readCurrentDocument(document) {
    if (!document.exists) {
        return {
            filename: document.filename,
            path: document.path,
            markdown: "",
            revision: null,
        };
    }
    return readDocument(document);
}

function serializeDraft(draft) {
    return JSON.stringify(draft, null, 2);
}

async function retainConflict({ conflictRoot, markdown, baseRevision, baseMarkdown = null, expectedDraftRevision, currentDraftRevision }) {
    await mkdir(conflictRoot, { recursive: true });
    const retainedDraftPath = resolve(conflictRoot, `${Date.now()}-${randomUUID()}.json`);
    await atomicWrite(
        retainedDraftPath,
        JSON.stringify({
            markdown,
            baseRevision,
            baseMarkdown,
            expectedDraftRevision,
            currentDraftRevision,
            retainedAt: new Date().toISOString(),
        }, null, 2),
        { mode: PRIVATE_FILE_MODE },
    );
    return retainedDraftPath;
}

async function throwRetainedConflict({
    paths,
    markdown,
    baseRevision,
    expectedDraftRevision,
    currentDraftRevision,
    message,
    extraConflict = {},
}) {
    const retainedDraftPath = await retainConflict({
        conflictRoot: paths.conflictRoot,
        markdown,
        baseRevision,
        expectedDraftRevision,
        currentDraftRevision,
    });
    throw fail(409, message, {
        conflict: {
            ...extraConflict,
            currentDraftRevision,
            retainedDraftPath,
        },
    });
}

function readDraft(draftPath) {
    const draft = readJson(draftPath);
    if (!draft) return null;
    if (typeof draft.markdown !== "string" || typeof draft.revision !== "string") {
        throw fail(500, "Draft state is invalid.");
    }
    return draft;
}

function publicDraft(draft) {
    if (!draft) return null;
    return {
        markdown: draft.markdown,
        baseRevision: draft.baseRevision ?? null,
        baseMarkdown: draft.baseMarkdown ?? null,
        submissionPath: draft.submissionPath ?? null,
        revision: draft.revision,
        status: draft.status ?? "saved",
        requestId: draft.requestId ?? null,
        updatedAt: draft.updatedAt ?? null,
    };
}

function canCreateNewDraft(existing) {
    return !existing || existing.status === "applied" || existing.status === "committed";
}

function splitLines(markdown) {
    return markdown.match(/[^\n]*\n|[^\n]+/g) ?? [];
}

function parseSections(markdown) {
    const lines = splitLines(markdown);
    const offsets = new Array(lines.length + 1).fill(0);
    for (let index = 0; index < lines.length; index += 1) {
        offsets[index + 1] = offsets[index] + lines[index].length;
    }
    const headings = [];
    let inFence = false;
    let fenceChar = "";
    let fenceLength = 0;
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index].replace(/\r?\n$/, "");
        const fenceMatch = line.match(/^([`~]{3,})/);
        if (fenceMatch) {
            const marker = fenceMatch[1];
            const char = marker[0];
            const length = marker.length;
            if (!inFence) {
                inFence = true;
                fenceChar = char;
                fenceLength = length;
            } else if (char === fenceChar && length >= fenceLength) {
                inFence = false;
                fenceChar = "";
                fenceLength = 0;
            }
            continue;
        }
        if (inFence) continue;
        const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*$/);
        if (!headingMatch) continue;
        const level = headingMatch[1].length;
        const text = headingMatch[2].trim();
        headings.push({
            level,
            text,
            key: `${"#".repeat(level)} ${text}`,
            lineIndex: index,
        });
    }
    const sections = new Map();
    for (let index = 0; index < headings.length; index += 1) {
        const heading = headings[index];
        let endLine = lines.length;
        for (let cursor = index + 1; cursor < headings.length; cursor += 1) {
            if (headings[cursor].level <= heading.level) {
                endLine = headings[cursor].lineIndex;
                break;
            }
        }
        sections.set(heading.key, {
            key: heading.key,
            start: offsets[heading.lineIndex],
            end: offsets[endLine],
        });
    }
    return { headings, sections };
}

function requiredHeadingKeys(markdown) {
    const parsed = parseSections(markdown);
    return parsed.headings
        .filter((heading) => heading.level <= 2)
        .map((heading) => heading.key);
}

function preserveProtectedSections({ baselineMarkdown, candidateMarkdown }) {
    const baseline = parseSections(baselineMarkdown);
    const candidate = parseSections(candidateMarkdown);
    const candidateKeys = new Set(candidate.headings.map((heading) => heading.key));
    const required = requiredHeadingKeys(baselineMarkdown);
    const missing = required.filter((key) => !candidateKeys.has(key));
    if (missing.length > 0) {
        throw fail(422, `Draft is malformed. Missing required headings: ${missing.join(", ")}`);
    }
    for (const heading of PROTECTED_HEADINGS) {
        const baselineSection = baseline.sections.get(heading);
        const candidateSection = candidate.sections.get(heading);
        if (!baselineSection) continue;
        if (!candidateSection) {
            throw fail(422, `Draft is malformed. Missing required heading: ${heading}`);
        }
        const original = baselineMarkdown.slice(baselineSection.start, baselineSection.end);
        const proposed = candidateMarkdown.slice(candidateSection.start, candidateSection.end);
        if (original.replace(/(?:\r?\n)+$/, "") !== proposed.replace(/(?:\r?\n)+$/, "")) {
            throw fail(422, `Draft changes protected section ${heading}. Keep it unchanged in a user correction.`);
        }
    }
    return candidateMarkdown;
}

function resolveDocumentPolicy(documentPath, explicitPolicy = null) {
    if (explicitPolicy === DOCUMENT_POLICY_BLUEPRINT || explicitPolicy === DOCUMENT_POLICY_GENERIC) {
        return explicitPolicy;
    }
    if (explicitPolicy !== null && explicitPolicy !== undefined) {
        throw fail(422, "Document policy must be 'blueprint' or 'generic'.");
    }
    return documentPath.endsWith(".blueprint.md")
        ? DOCUMENT_POLICY_BLUEPRINT
        : DOCUMENT_POLICY_GENERIC;
}

function sanitizeApplyContext(context) {
    if (context == null) return null;
    if (typeof context !== "object" || Array.isArray(context)) {
        throw fail(422, "Apply context must be an object.");
    }
    const phase = context.phase ?? "unknown";
    if (!APPLY_CONTEXT_PHASES.has(phase)) throw fail(422, "Invalid apply phase.");
    const asIds = (value = []) => {
        if (!Array.isArray(value) || value.length > MAX_APPLY_CONTEXT_IDS ||
            value.some((item) => typeof item !== "string" || !item.trim())) {
            throw fail(422, "Invalid native worker identifiers.");
        }
        return [...new Set(value)];
    };
    return {
        phase,
        blueprintPath: context.blueprintPath ?? null,
        activeAgentIds: asIds(context.activeAgentIds),
        activeToolCallIds: asIds(context.activeToolCallIds),
    };
}

export function resolveHqRoot(env = process.env) {
    if (env.VIRTUCON_HQ) return resolve(env.VIRTUCON_HQ);
    if (env.MINIME_HOME) return resolve(env.MINIME_HOME);
    if (env.HOME) return resolve(env.HOME, ".minime");
    throw fail(500, "HOME is unavailable.");
}

export function repositoryRoots({ org, repo }, env = process.env) {
    if (!org || !repo) throw fail(500, "Repository identity is required.");
    const hqRoot = resolveHqRoot(env);
    return {
        hqRoot,
        blueprintRoot: resolve(hqRoot, org, `_${repo}`, "blueprints"),
        rawRoot: resolve(hqRoot, "raw", org, repo),
        wikiRoot: resolve(hqRoot, "wiki", "orgs", org, repo),
    };
}

export function readDocumentWithDraft({
    draftRoot,
    documentPath,
    sessionId,
    allowMissing = false,
}) {
    const document = canonicalDocumentPath({ draftRoot, documentPath, allowMissing });
    const key = artifactKey(sessionId, document.path);
    const paths = artifactPaths(document.artifactRoot, key, documentKey(document.path));
    const draft = readDraft(paths.draftPath);
    return {
        ...readCurrentDocument(document),
        draft: publicDraft(draft),
    };
}

export function readDocumentDraftState({
    draftRoot,
    documentPath,
    sessionId,
    allowMissing = false,
}) {
    const document = canonicalDocumentPath({ draftRoot, documentPath, allowMissing });
    const key = artifactKey(sessionId, document.path);
    const paths = artifactPaths(document.artifactRoot, key, documentKey(document.path));
    const draft = readDraft(paths.draftPath);
    if (!draft) return null;
    return {
        markdown: draft.markdown,
        baseRevision: draft.baseRevision ?? null,
        revision: draft.revision,
        status: draft.status ?? "saved",
        requestId: draft.requestId ?? null,
        updatedAt: draft.updatedAt ?? null,
        applyContext: sanitizeApplyContext(draft.applyContext),
    };
}

export async function saveDocumentDraft({
    draftRoot,
    documentPath,
    sessionId,
    markdown,
    baseRevision,
    expectedDraftRevision,
    createIfMissing = false,
}) {
    if (typeof markdown !== "string") throw fail(422, "Draft markdown must be a string.");
    const document = canonicalDocumentPath({
        draftRoot,
        documentPath,
        allowMissing: createIfMissing,
    });
    const key = artifactKey(sessionId, document.path);
    const paths = artifactPaths(document.artifactRoot, key, documentKey(document.path));
    return withLock(paths.draftLockPath, async () => {
        const current = readCurrentDocument(document);
        const existing = readDraft(paths.draftPath);
        if (document.exists && baseRevision !== current.revision) {
            await throwRetainedConflict({
                paths,
                markdown,
                baseRevision,
                expectedDraftRevision,
                currentDraftRevision: existing?.revision ?? null,
                message: "Document revision changed before save.",
                extraConflict: { currentRevision: current.revision },
            });
        }
        if (existing?.status === "queued") {
            if (existing.revision === expectedDraftRevision && existing.markdown === markdown) {
                return {
                    ...current,
                    draft: publicDraft(existing),
                };
            }
            await throwRetainedConflict({
                paths,
                markdown,
                baseRevision,
                expectedDraftRevision,
                currentDraftRevision: existing.revision,
                message: "Apply is queued for this draft. Save rejected until commit resolves.",
                extraConflict: {
                    currentRequestId: existing.requestId ?? null,
                    currentStatus: existing.status,
                },
            });
        }
        if (expectedDraftRevision === null || expectedDraftRevision === undefined) {
            if (!canCreateNewDraft(existing)) {
                await throwRetainedConflict({
                    paths,
                    markdown,
                    baseRevision,
                    expectedDraftRevision,
                    currentDraftRevision: existing?.revision ?? null,
                    message: "Draft already exists. Supply expectedDraftRevision to update it.",
                });
            }
        } else if (!existing || existing.revision !== expectedDraftRevision) {
            await throwRetainedConflict({
                paths,
                markdown,
                baseRevision,
                expectedDraftRevision,
                currentDraftRevision: existing?.revision ?? null,
                message: "Draft revision mismatch.",
            });
        }
        const persistedDraft = {
            markdown,
            baseRevision,
            baseMarkdown: current.markdown,
            revision: digest(`${markdown}\n${Date.now()}\n${randomUUID()}`),
            status: "saved",
            requestId: null,
            updatedAt: new Date().toISOString(),
        };
        await atomicWrite(paths.draftPath, serializeDraft(persistedDraft), { mode: PRIVATE_FILE_MODE });
        const verified = readDraft(paths.draftPath);
        if (!verified || verified.revision !== persistedDraft.revision) {
            throw fail(500, "Draft save did not persist.");
        }
        return {
            ...current,
            draft: publicDraft(verified),
        };
    });
}

export async function queueDocumentApply({
    draftRoot,
    documentPath,
    sessionId,
    expectedDraftRevision,
    applyContext = null,
    createIfMissing = false,
}) {
    const document = canonicalDocumentPath({
        draftRoot,
        documentPath,
        allowMissing: createIfMissing,
    });
    const key = artifactKey(sessionId, document.path);
    const paths = artifactPaths(document.artifactRoot, key, documentKey(document.path));
    return withLock(paths.draftLockPath, async () => {
        const draft = readDraft(paths.draftPath);
        if (!draft) throw fail(404, "No saved draft is available.");
        if (draft.revision !== expectedDraftRevision) {
            throw fail(409, "Draft revision mismatch.", {
                conflict: { currentDraftRevision: draft.revision },
            });
        }
        if (draft.status === "queued" && draft.requestId) {
            return {
                requestId: draft.requestId,
                status: "queued",
                baseRevision: draft.baseRevision ?? null,
                applyContext: sanitizeApplyContext(draft.applyContext),
            };
        }
        const requestId = randomUUID();
        const sanitizedContext = sanitizeApplyContext(applyContext);
        const queued = {
            ...draft,
            status: "queued",
            requestId,
            updatedAt: new Date().toISOString(),
            applyContext: sanitizedContext,
        };
        await atomicWrite(paths.draftPath, serializeDraft(queued), { mode: PRIVATE_FILE_MODE });
        const verified = readDraft(paths.draftPath);
        if (!verified || verified.requestId !== requestId || verified.status !== "queued") {
            throw fail(500, "Apply queue state did not persist.");
        }
        return {
            requestId,
            status: "queued",
            baseRevision: verified.baseRevision ?? null,
            applyContext: sanitizeApplyContext(verified.applyContext),
        };
    });
}

export async function resolveQueuedDocument({
    draftRoot,
    documentPath,
    sessionId,
    requestId,
    expectedRevision,
    expectedDraftRevision,
    markdown,
}) {
    if (typeof markdown !== "string" || !expectedRevision || !expectedDraftRevision) {
        throw fail(422, "Resolution requires merged markdown and both current revision guards.");
    }
    const document = canonicalDocumentPath({ draftRoot, documentPath });
    const key = artifactKey(sessionId, document.path);
    const paths = artifactPaths(document.artifactRoot, key, documentKey(document.path));
    return withLock(paths.documentLockPath, () => withLock(paths.draftLockPath, async () => {
        const current = readDocument(document);
        const draft = readDraft(paths.draftPath);
        if (!draft || draft.status !== "queued" || draft.requestId !== requestId) {
            throw fail(409, "Resolution requires the matching queued apply request.");
        }
        if (current.revision !== expectedRevision || draft.revision !== expectedDraftRevision) {
            throw fail(409, "Document or draft revision changed before resolution.");
        }
        const resolvedMarkdown = document.path.endsWith(".blueprint.md")
            ? preserveProtectedSections({ baselineMarkdown: current.markdown, candidateMarkdown: markdown })
            : markdown;
        const submissionPath = draft.submissionPath ?? await retainConflict({
            conflictRoot: paths.conflictRoot,
            markdown: draft.markdown,
            baseRevision: draft.baseRevision,
            baseMarkdown: draft.baseMarkdown,
            expectedDraftRevision,
            currentDraftRevision: draft.revision,
        });
        const resolved = {
            ...draft,
            markdown: resolvedMarkdown,
            baseMarkdown: current.markdown,
            baseRevision: current.revision,
            revision: digest(`${resolvedMarkdown}\n${randomUUID()}`),
            submissionPath,
            updatedAt: new Date().toISOString(),
        };
        await atomicWrite(paths.draftPath, serializeDraft(resolved), { mode: PRIVATE_FILE_MODE });
        return { ...current, draft: publicDraft(readDraft(paths.draftPath)) };
    }));
}

export async function clearDocumentDraft({
    draftRoot,
    documentPath,
    sessionId,
    allowMissing = true,
}) {
    const document = canonicalDocumentPath({ draftRoot, documentPath, allowMissing });
    const key = artifactKey(sessionId, document.path);
    const paths = artifactPaths(document.artifactRoot, key, documentKey(document.path));
    return withLock(paths.draftLockPath, async () => {
        await rm(paths.draftPath, { force: true });
        return { cleared: true };
    });
}

export async function commitQueuedDocument({
    draftRoot,
    documentPath,
    sessionId,
    requestId,
    expectedRevision,
    createIfMissing = false,
    documentPolicy = null,
}) {
    const document = canonicalDocumentPath({
        draftRoot,
        documentPath,
        allowMissing: createIfMissing,
    });
    const key = artifactKey(sessionId, document.path);
    const sharedKey = documentKey(document.path);
    const paths = artifactPaths(document.artifactRoot, key, sharedKey);
    return withLock(paths.documentLockPath, () =>
        withLock(paths.draftLockPath, async () => {
            const current = readCurrentDocument(canonicalDocumentPath({
                draftRoot,
                documentPath: document.path,
                allowMissing: createIfMissing,
            }));
            const draft = readDraft(paths.draftPath);
            if (!draft) throw fail(404, "No saved draft is available.");
            if (draft.requestId !== requestId) {
                throw fail(409, "Apply request does not match the saved draft.", {
                    conflict: { currentRequestId: draft.requestId ?? null },
                });
            }
            if (draft.status === "applied" || draft.status === "committed") {
                if (!current.revision) {
                    throw fail(409, "Applied draft proof no longer matches document revision.", {
                        conflict: { currentRevision: null, appliedRevision: draft.baseRevision ?? null },
                    });
                }
                if (draft.baseRevision && draft.baseRevision !== current.revision) {
                    throw fail(409, "Applied draft proof no longer matches document revision.", {
                        conflict: { currentRevision: current.revision, appliedRevision: draft.baseRevision },
                    });
                }
                return {
                    requestId,
                    status: "committed",
                    proof: { revision: current.revision, path: current.path },
                };
            }
            if (current.revision && expectedRevision !== current.revision) {
                throw fail(409, "Document revision changed before commit.", {
                    conflict: {
                        currentRevision: current.revision,
                        expectedRevision: expectedRevision ?? null,
                    },
                });
            }
            if (current.revision && draft.baseRevision !== current.revision) {
                throw fail(409, "Draft base revision no longer matches the document bytes.", {
                    conflict: {
                        currentRevision: current.revision,
                        expectedBaseRevision: draft.baseRevision ?? null,
                    },
                });
            }
            if (!current.revision && expectedRevision !== draft.baseRevision) {
                throw fail(409, "Document creation revision mismatch.", {
                    conflict: {
                        currentRevision: null,
                        expectedRevision: draft.baseRevision ?? null,
                    },
                });
            }
            if (draft.status !== "queued") {
                throw fail(409, "Draft is not queued for apply.", {
                    conflict: { status: draft.status },
                });
            }
            const policy = resolveDocumentPolicy(current.path, documentPolicy);
            const mergedMarkdown = current.revision && policy === DOCUMENT_POLICY_BLUEPRINT
                ? preserveProtectedSections({
                    baselineMarkdown: current.markdown,
                    candidateMarkdown: draft.markdown,
                })
                : draft.markdown;
            await mkdir(dirname(current.path), { recursive: true });
            await atomicWrite(current.path, mergedMarkdown, { preserveMode: true });
            const persisted = readDocument({
                ...document,
                exists: true,
            });
            if (persisted.markdown !== mergedMarkdown) {
                throw fail(500, "Persisted blueprint does not match the queued draft.");
            }
            const committed = {
                ...draft,
                markdown: mergedMarkdown,
                baseRevision: persisted.revision,
                status: "committed",
                updatedAt: new Date().toISOString(),
            };
            await atomicWrite(paths.draftPath, serializeDraft(committed), { mode: PRIVATE_FILE_MODE });
            const verifiedDraft = readDraft(paths.draftPath);
            if (!verifiedDraft || verifiedDraft.status !== "committed" || verifiedDraft.requestId !== requestId) {
                throw fail(500, "Applied draft state did not persist.");
            }
            return {
                requestId,
                status: "committed",
                proof: {
                    revision: persisted.revision,
                    path: persisted.path,
                },
            };
        }),
    );
}
