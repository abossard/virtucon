// extension.mjs — minime-wiki canvas.
//
// Wiring only: one loopback HTTP server per open instance, the canvas
// declaration (open/onClose + agent-callable actions), and the LLM bridge that
// routes iframe "LLM tool" requests through the host agent via session.send.
//
// The interesting logic lives in wiki.mjs (pure + disk wrappers) and ui.mjs
// (the iframe document). stdout is reserved for JSON-RPC — never console.log;
// use session.log().

import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

import { joinSession, createCanvas, CanvasError } from "@github/copilot-sdk/extension";

import * as wiki from "./wiki.mjs";
import { renderHtml } from "./ui.mjs";

const ROOT = wiki.resolveRoot();
const MAX_JSON_BODY_BYTES = 1024 * 1024;

const servers = new Map(); // instanceId -> { server, url, origin, nonce, clients, currentRepository, scopeMode, selectedPath, draftSessionKey }
let sessionRef = null;

/* ───────────────────────────── helpers ─────────────────────────────── */

function safeEqual(left, right) {
    if (typeof left !== "string" || typeof right !== "string") return false;
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
}

function normalizeRepositoryPreset(value) {
    if (!value || typeof value !== "object") return null;
    const org = typeof value.org === "string" ? value.org.trim() : "";
    const repo = typeof value.repo === "string" ? value.repo.trim() : "";
    if (!org || !repo) return null;
    return { org, repo };
}

function normalizeDraftSessionKey(value, sessionId) {
    if (typeof value === "string" && value.trim()) return value.trim();
    return `wiki:${sessionId}`;
}

function scopeStatus(entry) {
    if (entry.scopeMode === "current" && entry.currentRepository) {
        return `current ${entry.currentRepository.org}/${entry.currentRepository.repo} + patterns`;
    }
    return "all repositories";
}

function sendJson(res, status, body) {
    res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
    });
    res.end(JSON.stringify(body));
}

function sendError(res, status, error, extra = {}) {
    sendJson(res, status, { error, ...extra });
}

async function readBody(req, limit = MAX_JSON_BODY_BYTES) {
    if (Number(req.headers["content-length"] ?? 0) > limit) {
        req.resume();
        throw Object.assign(new Error("request body is too large"), { status: 413, code: "body_too_large" });
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > limit) {
            chunks.length = 0;
            req.resume();
            throw Object.assign(new Error("request body is too large"), { status: 413, code: "body_too_large" });
        }
        chunks.push(chunk);
    }
    if (chunks.length === 0) return {};
    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
        throw Object.assign(new Error("request body must be valid JSON"), { status: 400, code: "invalid_json" });
    }
}

function scopedCorpus(entry, corpus) {
    return wiki.scopeCorpus(corpus, {
        mode: entry.scopeMode,
        currentRepository: entry.currentRepository,
    });
}

function treePayload(entry, corpus) {
    const scoped = scopedCorpus(entry, corpus);
    return {
        root: ROOT,
        scope: entry.scopeMode,
        currentRepository: entry.currentRepository,
        selectedPath: entry.selectedPath,
        ...wiki.buildTree(scoped),
        files: wiki.buildFileTree(scoped),
    };
}

function broadcast(entry) {
    for (const res of entry.clients) {
        try { res.write("data: changed\n\n"); } catch { /* dropped */ }
    }
}

async function buildServerEntry(ctx, input = {}) {
    const fromInput = normalizeRepositoryPreset(input.currentRepositoryPreset || input.currentRepository);
    const currentRepository = fromInput || wiki.deriveCurrentRepository() || null;
    const initialScope =
        input.presetEnabled === false
            ? "all"
            : wiki.resolveScopeMode(input.scope, currentRepository);
    return {
        nonce: randomBytes(24).toString("base64url"),
        clients: new Set(),
        currentRepository,
        scopeMode: initialScope,
        selectedPath: typeof input.selectedPath === "string" && input.selectedPath.trim() ? input.selectedPath.trim() : null,
        draftSessionKey: normalizeDraftSessionKey(input.draftSessionKey, ctx.sessionId),
    };
}

function applyOpenInput(entry, ctx, input = {}) {
    const fromInput = normalizeRepositoryPreset(input.currentRepositoryPreset || input.currentRepository);
    if (fromInput) entry.currentRepository = fromInput;
    if (input.presetEnabled === false) {
        entry.scopeMode = "all";
    } else if (typeof input.scope === "string") {
        entry.scopeMode = wiki.resolveScopeMode(input.scope, entry.currentRepository);
    } else if (!entry.scopeMode) {
        entry.scopeMode = wiki.resolveScopeMode("current", entry.currentRepository);
    }
    if (typeof input.selectedPath === "string" && input.selectedPath.trim()) {
        entry.selectedPath = input.selectedPath.trim();
    }
    entry.draftSessionKey = normalizeDraftSessionKey(input.draftSessionKey || entry.draftSessionKey, ctx.sessionId);
}

/* ───────────────────────── LLM bridge (iframe) ──────────────────────── */

async function handOff(prompt, displayPrompt) {
    if (!sessionRef) throw new Error("assistant session not ready");
    try {
        await sessionRef.send({ prompt, displayPrompt });
    } catch (e) {
        throw new Error("could not reach the assistant: " + (e?.message || String(e)));
    }
    return { sent: true, displayPrompt };
}

async function repoCorpusText(org, repo) {
    const corpus = await wiki.loadCorpus(ROOT);
    const docs = corpus.filter((d) => d.area === "wiki" && d.org === org && d.repo === repo);
    if (docs.length === 0) throw new CanvasError("not_found", `no wiki articles for ${org}/${repo}`);
    return { docs };
}

const base = (p) => String(p).split("/").pop().replace(/\.md$/, "");

async function handleLlm(body) {
    const today = new Date().toISOString().slice(0, 10);
    switch (body.op) {
        case "derive": {
            const { org, repo } = body;
            await repoCorpusText(org, repo);
            const prompt =
                `Using the Minime Wiki canvas (search/read the wiki, then read the destination file and write_article with expectedRevision), derive the most important GENERAL reusable engineering rules from curated articles in ${org}/${repo}. ` +
                `Consolidate overlaps, drop task-specific noise, and cite code/paths as Evidence. Show proposed markdown first. Write to wiki/orgs/${org}/${repo}/derived-rules.md using expectedRevision from read. If the file is missing, call write_article with createOnly=true and an explicit expectedRevision (null or an opaque token). ` +
                `Format: # title, **Summary**, **Scope**, **Confidence**, **Status: active**, **LastVerified: ${today}**, then ## Rules.`;
            return handOff(prompt, `⊹ Derive rules for ${org}/${repo}`);
        }
        case "merge": {
            const paths = body.paths || [];
            if (paths.length < 2) throw new CanvasError("bad_input", "merge needs two paths");
            const prompt =
                `Using the Minime Wiki canvas, consolidate these overlapping wiki articles into ONE canonical article. Preserve every distinct rule, gotcha and code/path citation, keep the strongest title, set **LastVerified: ${today}**. ` +
                `Read ${paths[0]} first to get expectedRevision, then write_article to ${paths[0]} with that expectedRevision. Optionally mark others status=superseded with rate_article and expectedRevision from read.`;
            return handOff(prompt, `⇄ Merge ${paths.map(base).join(" + ")}`);
        }
        case "rate": {
            if (!body.path) throw new CanvasError("bad_input", "path is required");
            const prompt =
                `Using the Minime Wiki canvas, read ${body.path} and assess it. Suggest ValueScore (0–8), Confidence (high/medium/low), and Status (active/stale/superseded) with a one-line rationale. Ask before applying with rate_article (needs expectedRevision from read).`;
            return handOff(prompt, `★ Suggest rating for ${base(body.path)}`);
        }
        case "ask": {
            const q = body.question;
            if (!q) throw new CanvasError("bad_input", "question is required");
            const prompt =
                `Using the Minime Wiki canvas (search + read wiki/raw), answer the following and cite relPath(s). If the wiki doesn't cover it, say so.\n\nQuestion: ${q}`;
            return handOff(prompt, `🔎 Ask the wiki: ${q}`);
        }
        default:
            throw new CanvasError("bad_input", `unknown op: ${body.op}`);
    }
}

async function openBlueprintCanvas(relPath) {
    const normalized = wiki.normalizeRelPath(relPath);
    if (!wiki.isBlueprintPath(normalized)) {
        throw Object.assign(new Error("path is not a blueprint"), { status: 422, code: "bad_input" });
    }
    const filename = normalized.split("/").pop();
    const flowInstanceId = `minime-flow-${filename.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80)}`;
    if (sessionRef?.rpc?.canvas?.open) {
        try {
            const request = {
                canvasId: "minime-flow",
                instanceId: flowInstanceId,
                input: { blueprint: filename, blueprintPath: normalized },
            };
            let opened;
            try {
                opened = await sessionRef.rpc.canvas.open(request);
            } catch (error) {
                const candidates = [
                    ...(Array.isArray(error?.candidates) ? error.candidates : []),
                    ...(Array.isArray(error?.details?.candidates) ? error.details.candidates : []),
                    ...(Array.isArray(error?.data?.candidates) ? error.data.candidates : []),
                ]
                    .filter((id) => typeof id === "string")
                    .map((id) => id.trim())
                    .filter((id) => id.endsWith(":minime-flow"));
                if (!candidates.length) throw error;
                let lastRetryError = error;
                for (const extensionId of [...new Set(candidates)]) {
                    try {
                        opened = await sessionRef.rpc.canvas.open({ ...request, extensionId });
                        break;
                    } catch (retryError) {
                        lastRetryError = retryError;
                    }
                }
                if (!opened) throw lastRetryError;
            }
            return {
                opened: true,
                delegated: false,
                instanceId: opened.instanceId || flowInstanceId,
                canvasId: opened.canvasId || "minime-flow",
                path: normalized,
            };
        } catch (error) {
            await sessionRef.send({
                prompt: `Open the Minime flow canvas for blueprint file ${filename} (path ${normalized}).`,
                displayPrompt: `Open blueprint canvas: ${filename}`,
            });
            return {
                opened: false,
                delegated: true,
                path: normalized,
                message: `could not open minime-flow directly: ${error?.message || String(error)}. request sent to chat`,
            };
        }
    }
    await sessionRef.send({
        prompt: `Open the Minime flow canvas for blueprint file ${filename} (path ${normalized}).`,
        displayPrompt: `Open blueprint canvas: ${filename}`,
    });
    return {
        opened: false,
        delegated: true,
        path: normalized,
        message: "canvas open RPC is unavailable. request sent to chat",
    };
}

/* ─────────────────────────── HTTP routing ──────────────────────────── */

async function route(req, res, instanceId) {
    const entry = servers.get(instanceId);
    if (!entry) return sendError(res, 404, "canvas instance not found", { code: "not_found" });
    const url = new URL(req.url || "/", entry.origin);
    const p = url.pathname;
    try {
        const requestOrigin = req.headers.origin;
        if (requestOrigin && requestOrigin !== entry.origin) {
            return sendError(res, 403, "cross-origin request rejected", { code: "cross_origin" });
        }
        if (req.method === "POST" && requestOrigin !== entry.origin) {
            return sendError(res, 403, "a same-origin request is required", { code: "same_origin_required" });
        }
        const requiresNonce = p === "/events" || p.startsWith("/api/");
        if (requiresNonce) {
            const suppliedNonce = req.headers["x-minime-nonce"] ?? url.searchParams.get("nonce");
            if (!safeEqual(suppliedNonce, entry.nonce)) {
                return sendError(res, 403, "invalid request nonce", { code: "invalid_nonce" });
            }
        }

        if (p === "/" || p === "/index.html") {
            res.writeHead(200, {
                "content-type": "text/html; charset=utf-8",
                "cache-control": "no-store",
                "x-content-type-options": "nosniff",
                "referrer-policy": "no-referrer",
                "content-security-policy":
                    `default-src 'self'; connect-src 'self'; img-src 'self' data:; ` +
                    `script-src 'self' 'nonce-${entry.nonce}'; style-src 'self' 'nonce-${entry.nonce}'`,
            });
            return res.end(renderHtml(instanceId, {
                root: ROOT,
                nonce: entry.nonce,
                scope: entry.scopeMode,
                currentRepository: entry.currentRepository,
                selectedPath: entry.selectedPath,
                draftSessionKey: entry.draftSessionKey,
            }));
        }
        if (p === "/events") {
            res.writeHead(200, {
                "content-type": "text/event-stream",
                "cache-control": "no-cache, no-transform",
                connection: "keep-alive",
                "x-accel-buffering": "no",
            });
            res.write("retry: 3000\n\n");
            entry.clients.add(res);
            req.on("close", () => entry.clients.delete(res));
            return;
        }
        if (p === "/api/tree") {
            const corpus = await wiki.loadCorpus(ROOT);
            return sendJson(res, 200, treePayload(entry, corpus));
        }
        if (p === "/api/scope" && req.method === "POST") {
            const body = await readBody(req, 2048);
            entry.scopeMode = wiki.resolveScopeMode(body.mode, entry.currentRepository);
            const corpus = await wiki.loadCorpus(ROOT);
            return sendJson(res, 200, treePayload(entry, corpus));
        }
        if (p === "/api/search") {
            const corpus = await wiki.loadCorpus(ROOT);
            const scoped = scopedCorpus(entry, corpus);
            return sendJson(res, 200, wiki.searchCorpus(scoped, url.searchParams.get("q") || ""));
        }
        if (p === "/api/article") {
            const path = url.searchParams.get("path") || entry.selectedPath;
            if (!path) throw Object.assign(new Error("path is required"), { status: 422, code: "bad_input" });
            const article = await wiki.readArticle(ROOT, path, {
                draftSessionKey: entry.draftSessionKey,
            });
            entry.selectedPath = article.relPath;
            return sendJson(res, 200, article);
        }
        if (p === "/api/stats") {
            const corpus = await wiki.loadCorpus(ROOT);
            const scoped = scopedCorpus(entry, corpus);
            return sendJson(res, 200, wiki.computeStats(scoped));
        }
        if (p === "/api/blueprints") {
            const list = await wiki.loadBlueprints(ROOT);
            return sendJson(res, 200, { ...wiki.buildBlueprintTree(list), items: list, files: wiki.buildFileTree(list) });
        }
        if (p === "/api/llm" && req.method === "POST") {
            const out = await handleLlm(await readBody(req, 16384));
            return sendJson(res, 200, out);
        }
        if (p === "/api/open-blueprint" && req.method === "POST") {
            const b = await readBody(req, 4096);
            const path = b.path || entry.selectedPath;
            if (!path) throw Object.assign(new Error("path is required"), { status: 422, code: "bad_input" });
            return sendJson(res, 200, await openBlueprintCanvas(path));
        }
        if (p === "/api/draft" && req.method === "POST") {
            const b = await readBody(req);
            const out = await wiki.saveDraft(ROOT, b.path, {
                content: b.content,
                baseRevision: b.baseRevision,
                revision: b.expectedDraftRevision,
                updatedAt: new Date().toISOString(),
            }, {
                draftSessionKey: b.draftSessionKey || entry.draftSessionKey,
                expectedDraftRevision: b.expectedDraftRevision,
            });
            entry.selectedPath = out.relPath;
            broadcast(entry);
            return sendJson(res, 200, out);
        }
        if (p === "/api/apply" && req.method === "POST") {
            const b = await readBody(req);
            const out = await wiki.writeArticle(ROOT, b.path, b.content, {
                expectedRevision: b.expectedRevision,
                draftSessionKey: b.draftSessionKey || entry.draftSessionKey,
                draft: b.draft || { content: b.content, baseRevision: b.expectedRevision },
                expectedDraftRevision: b.draft?.revision ?? b.expectedDraftRevision ?? null,
                createOnly: b.createOnly === true,
            });
            entry.selectedPath = out.relPath;
            broadcast(entry);
            return sendJson(res, 200, out);
        }
        if (p === "/api/rate" && req.method === "POST") {
            const b = await readBody(req);
            const out = await wiki.rateArticle(ROOT, b.path, b.fields || {}, {
                expectedRevision: b.expectedRevision,
                draftSessionKey: b.draftSessionKey || entry.draftSessionKey,
                draft: b.draft || null,
                expectedDraftRevision: b.draft?.revision ?? b.expectedDraftRevision ?? null,
            });
            entry.selectedPath = out.relPath;
            broadcast(entry);
            return sendJson(res, 200, out);
        }
        return sendError(res, 404, "route not found", { code: "not_found" });
    } catch (error) {
        const status = Number.isInteger(error?.status)
            ? error.status
            : (error instanceof CanvasError && error.code === "not_found" ? 404 : 400);
        return sendError(res, status, error?.message || String(error), {
            code: error?.code,
            relPath: error?.relPath,
            expectedRevision: error?.expectedRevision,
            currentRevision: error?.currentRevision,
            currentContent: error?.currentContent,
            currentDraftRevision: error?.currentDraftRevision,
            retainedDraftPath: error?.retainedDraftPath,
            currentRequestId: error?.currentRequestId,
            currentStatus: error?.currentStatus,
        });
    }
}

async function startServer(ctx, input = {}) {
    const entry = await buildServerEntry(ctx, input);
    const server = createServer((req, res) => { void route(req, res, ctx.instanceId); });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    entry.server = server;
    entry.url = `http://127.0.0.1:${port}/`;
    entry.origin = `http://127.0.0.1:${port}`;
    servers.set(ctx.instanceId, entry);
    return entry;
}

/* ─────────────────────── agent-facing actions ──────────────────────── */

const actions = [
    {
        name: "search",
        description: "Full-text search the minime wiki + raw sources. Supports all or current-repo scope.",
        inputSchema: {
            type: "object",
            properties: {
                query: { type: "string" },
                scope: { type: "string", enum: ["all", "current"] },
                currentRepositoryPreset: {
                    type: "object",
                    properties: { org: { type: "string" }, repo: { type: "string" } },
                    required: ["org", "repo"],
                    additionalProperties: false,
                },
            },
            required: ["query"],
            additionalProperties: false,
        },
        handler: async (ctx) => {
            const currentRepository = normalizeRepositoryPreset(ctx.input?.currentRepositoryPreset) || wiki.deriveCurrentRepository();
            const mode = wiki.resolveScopeMode(ctx.input?.scope, currentRepository);
            const corpus = wiki.scopeCorpus(await wiki.loadCorpus(ROOT), {
                mode,
                currentRepository,
            });
            return { scope: { mode, currentRepository }, results: wiki.searchCorpus(corpus, ctx.input?.query || "") };
        },
    },
    {
        name: "read",
        description: "Read one wiki/raw article by wiki-root-relative path.",
        inputSchema: {
            type: "object",
            properties: {
                path: { type: "string" },
                draftSessionKey: { type: "string" },
            },
            required: ["path"],
            additionalProperties: false,
        },
        handler: async (ctx) => wiki.readArticle(ROOT, ctx.input?.path, {
            draftSessionKey: ctx.input?.draftSessionKey || `wiki:${ctx.sessionId}`,
        }),
    },
    {
        name: "stats",
        description: "Maintenance signals: counts by area, stale + low-confidence articles, and duplicate candidates.",
        inputSchema: {
            type: "object",
            properties: {
                scope: { type: "string", enum: ["all", "current"] },
                currentRepositoryPreset: {
                    type: "object",
                    properties: { org: { type: "string" }, repo: { type: "string" } },
                    required: ["org", "repo"],
                    additionalProperties: false,
                },
            },
            additionalProperties: false,
        },
        handler: async (ctx) => {
            const currentRepository = normalizeRepositoryPreset(ctx.input?.currentRepositoryPreset) || wiki.deriveCurrentRepository();
            const mode = wiki.resolveScopeMode(ctx.input?.scope, currentRepository);
            const corpus = wiki.scopeCorpus(await wiki.loadCorpus(ROOT), {
                mode,
                currentRepository,
            });
            return wiki.computeStats(corpus);
        },
    },
    {
        name: "save_draft",
        description: "Persist a draft for a wiki article keyed by draftSessionKey (not by canvas instance).",
        inputSchema: {
            type: "object",
            properties: {
                path: { type: "string" },
                content: { type: "string" },
                baseRevision: { type: ["string", "number", "null"] },
                expectedDraftRevision: { type: ["string", "number", "null"] },
                draftSessionKey: { type: "string" },
            },
            required: ["path", "content", "draftSessionKey"],
            additionalProperties: false,
        },
        handler: async (ctx) => wiki.saveDraft(ROOT, ctx.input?.path, {
            content: ctx.input?.content,
            baseRevision: ctx.input?.baseRevision,
            updatedAt: new Date().toISOString(),
            revision: ctx.input?.expectedDraftRevision,
        }, {
            draftSessionKey: ctx.input?.draftSessionKey,
            expectedDraftRevision: ctx.input?.expectedDraftRevision,
        }),
    },
    {
        name: "derive_rules",
        description: "Return a repo's curated articles plus guidance so you can derive reusable rules.",
        inputSchema: {
            type: "object",
            properties: { org: { type: "string" }, repo: { type: "string" } },
            required: ["org", "repo"],
            additionalProperties: false,
        },
        handler: async (ctx) => {
            const { org, repo } = ctx.input || {};
            const { docs } = await repoCorpusText(org, repo);
            return {
                org,
                repo,
                count: docs.length,
                articles: docs.map((d) => ({ relPath: d.relPath, title: d.title, markdown: d.text })),
                guidance: `Derive GENERAL reusable rules and cite evidence. Then read wiki/orgs/${org}/${repo}/derived-rules.md for expectedRevision. If it is missing, call write_article with createOnly=true and an explicit expectedRevision (null or opaque token).`,
            };
        },
    },
    {
        name: "merge_articles",
        description: "Return two+ articles plus guidance so you can consolidate them safely.",
        inputSchema: {
            type: "object",
            properties: { paths: { type: "array", items: { type: "string" }, minItems: 2 } },
            required: ["paths"],
            additionalProperties: false,
        },
        handler: async (ctx) => {
            const paths = ctx.input?.paths || [];
            if (paths.length < 2) throw new CanvasError("bad_input", "provide at least two paths");
            const articles = [];
            for (const path of paths) articles.push(await wiki.readArticle(ROOT, path));
            return {
                articles: articles.map((a) => ({ relPath: a.relPath, markdown: a.markdown })),
                guidance: `Read the destination first to get expectedRevision, then call write_article with expectedRevision for "${paths[0]}".`,
            };
        },
    },
    {
        name: "open_blueprint",
        description: "Open a blueprint in the Minime flow canvas. Falls back to chat request when canvas RPC is unavailable.",
        inputSchema: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
            additionalProperties: false,
        },
        handler: async (ctx) => openBlueprintCanvas(ctx.input?.path),
    },
    {
        name: "rate_article",
        description: "Patch article metadata with revision guard. Raw and blueprint paths are read-only.",
        inputSchema: {
            type: "object",
            properties: {
                path: { type: "string" },
                expectedRevision: { type: ["string", "number"] },
                draftSessionKey: { type: "string" },
                expectedDraftRevision: { type: ["string", "number", "null"] },
                draft: {
                    type: "object",
                    properties: {
                        content: { type: "string" },
                        baseRevision: { type: ["string", "number", "null"] },
                        revision: { type: ["string", "number", "null"] },
                        updatedAt: { type: "string" },
                    },
                    required: ["content"],
                    additionalProperties: false,
                },
                valueScore: { type: ["string", "number"] },
                confidence: { type: "string", enum: ["high", "medium", "low"] },
                status: { type: "string", enum: ["active", "stale", "superseded"] },
                lastVerified: { type: "string" },
            },
            required: ["path", "expectedRevision"],
            additionalProperties: false,
        },
        handler: async (ctx) => {
            const { path, expectedRevision, draftSessionKey, draft, expectedDraftRevision, ...fields } = ctx.input || {};
            return wiki.rateArticle(ROOT, path, fields, {
                expectedRevision,
                draftSessionKey: draftSessionKey || `wiki:${ctx.sessionId}`,
                draft,
                expectedDraftRevision,
            });
        },
    },
    {
        name: "write_article",
        description: "Write/replace a wiki article with revision guard. For new files use createOnly=true and provide expectedRevision (null or opaque token).",
        inputSchema: {
            type: "object",
            properties: {
                path: { type: "string" },
                content: { type: "string" },
                expectedRevision: { type: ["string", "number", "null"] },
                draftSessionKey: { type: "string" },
                expectedDraftRevision: { type: ["string", "number", "null"] },
                createOnly: { type: "boolean" },
                draft: {
                    type: "object",
                    properties: {
                        content: { type: "string" },
                        baseRevision: { type: ["string", "number", "null"] },
                        revision: { type: ["string", "number", "null"] },
                        updatedAt: { type: "string" },
                    },
                    required: ["content"],
                    additionalProperties: false,
                },
            },
            required: ["path", "content", "expectedRevision"],
            additionalProperties: false,
        },
        handler: async (ctx) => {
            const { path, content, expectedRevision, draftSessionKey, draft, expectedDraftRevision, createOnly } = ctx.input || {};
            const out = await wiki.writeArticle(ROOT, path, content, {
                expectedRevision,
                draftSessionKey: draftSessionKey || `wiki:${ctx.sessionId}`,
                draft,
                expectedDraftRevision,
                createOnly: createOnly === true,
            });
            const entry = servers.get(ctx.instanceId);
            if (entry) broadcast(entry);
            return out;
        },
    },
];

/* ──────────────────────────── join session ─────────────────────────── */

const session = await joinSession({
    canvases: [
        createCanvas({
            id: "wiki",
            displayName: "Minime Wiki",
            description: "Browse the global minime wiki and edit wiki articles with revision-safe saves.",
            inputSchema: {
                type: "object",
                properties: {
                    currentRepositoryPreset: {
                        type: "object",
                        properties: { org: { type: "string" }, repo: { type: "string" } },
                        required: ["org", "repo"],
                        additionalProperties: false,
                    },
                    scope: { type: "string", enum: ["all", "current"] },
                    presetEnabled: { type: "boolean" },
                    selectedPath: { type: "string" },
                    draftSessionKey: { type: "string" },
                },
                additionalProperties: false,
            },
            actions,
            open: async (ctx) => {
                let entry = servers.get(ctx.instanceId);
                if (!entry) {
                    entry = await startServer(ctx, ctx.input || {});
                } else {
                    applyOpenInput(entry, ctx, ctx.input || {});
                }
                return {
                    title: "Minime Wiki",
                    url: entry.url,
                    status: `${ROOT} · ${scopeStatus(entry)}`,
                };
            },
            onClose: async (ctx) => {
                const entry = servers.get(ctx.instanceId);
                if (!entry) return;
                servers.delete(ctx.instanceId);
                for (const client of entry.clients) client.end();
                await new Promise((resolve) => entry.server.close(() => resolve()));
            },
        }),
    ],
});

sessionRef = session;
await session.log(`minime-wiki ready · root ${ROOT}`, { ephemeral: true });
