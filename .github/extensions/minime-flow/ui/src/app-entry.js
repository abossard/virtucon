import DOMPurify from "dompurify";
import mermaid from "mermaid";
import { marked } from "marked";
import { collectAgentRecords, toAgentSummary } from "../agent-state.js";
import { allowsInlineStyle } from "../csp-policy.js";
import {
    applySectionEdits,
    containsDesignHeading,
    containsMermaidFence,
    extractEditableSections,
} from "../document-model.js";
import { mergeRemoteDraftState, statusForApplyState } from "../draft-sync.js";
import { setEditorMode } from "../editor-dom.js";
import { renderPreview } from "../preview.js";

const nonce = document.querySelector('meta[name="minime-nonce"]')?.content ?? "";
const byId = (id) => document.getElementById(id);
const MODE_ORDER = ["sections", "source", "preview"];

const store = {
    mode: "sections",
    flow: null,
    selectedBlueprint: null,
    documents: new Map(),
    previewToken: 0,
    inlineStyleAllowed: null,
    inlineStyleCheck: null,
};

function hasText(value) {
    return typeof value === "string" && value.length > 0;
}

function textOr(value, fallback) {
    return hasText(value) ? value : fallback;
}

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

async function checkInlineStylePolicy() {
    if (typeof store.inlineStyleAllowed === "boolean") return store.inlineStyleAllowed;
    if (store.inlineStyleCheck) return store.inlineStyleCheck;
    store.inlineStyleCheck = (async () => {
        try {
            const response = await fetch(window.location.href, {
                method: "GET",
                cache: "no-store",
            });
            const policy = response.headers.get("content-security-policy");
            store.inlineStyleAllowed = hasText(policy) ? allowsInlineStyle(policy) : false;
        } catch {
            store.inlineStyleAllowed = false;
        } finally {
            store.inlineStyleCheck = null;
        }
        return store.inlineStyleAllowed;
    })();
    return store.inlineStyleCheck;
}

function selectedDocument() {
    if (!store.selectedBlueprint) return null;
    return store.documents.get(store.selectedBlueprint) ?? null;
}

function createDocumentState(filename) {
    return {
        filename,
        path: "Not provided",
        markdown: "",
        baseRevision: null,
        documentRevision: null,
        expectedDraftRevision: null,
        remoteDraftStatus: "none",
        remoteRequestId: null,
        dirty: false,
        saving: false,
        applying: false,
        clientRevision: 0,
        status: { kind: "", text: "No local edits." },
    };
}

function ensureDocumentState(filename) {
    if (!store.documents.has(filename)) {
        store.documents.set(filename, createDocumentState(filename));
    }
    return store.documents.get(filename);
}

function setDraftStatus(kind, text) {
    const node = byId("draft-state");
    node.textContent = text;
    node.className = `status ${kind}`.trim();
}

function syncTextareaValue(node, next, preserveActive) {
    const value = typeof next === "string" ? next : "";
    if (preserveActive && document.activeElement === node) return;
    if (node.value !== value) node.value = value;
}

function updateButtons(entry) {
    const disabled = !entry;
    byId("save-draft").disabled = disabled || entry.saving || entry.applying;
    byId("apply-draft").disabled =
        disabled ||
        entry.saving ||
        entry.applying ||
        entry.dirty ||
        !hasText(entry.expectedDraftRevision);
    byId("mode-sections").disabled = disabled;
    byId("mode-source").disabled = disabled;
    byId("mode-preview").disabled = disabled;
    byId("goal-input").disabled = disabled || entry.saving || entry.applying;
    byId("active-criteria-input").disabled = disabled || entry.saving || entry.applying;
    byId("plan-summary-input").disabled = disabled || entry.saving || entry.applying;
    byId("source-input").disabled = disabled || entry.saving || entry.applying;
}

function formatPhaseStatus(phase) {
    if (hasText(phase?.status)) return phase.status;
    return "unknown";
}

function renderPhaseStrip(phases, currentWork = {}) {
    const target = byId("phase-strip");
    const nodes = asArray(phases).map((phase) => {
        const item = document.createElement("li");
        const label = document.createElement("strong");
        const status = document.createElement("span");
        label.textContent = textOr(phase?.label, textOr(phase?.id, "Unnamed phase"));
        status.textContent = formatPhaseStatus(phase);
        if (phase?.id === currentWork.phase) {
            item.setAttribute("aria-current", "step");
            status.textContent = `Current: ${textOr(currentWork.status === "unknown" ? null : currentWork.status, status.textContent)}`;
        }
        item.append(label, status);
        return item;
    });
    target.replaceChildren(...nodes);
}

function renderEvidenceList(evidence) {
    const target = byId("evidence-list");
    const items = asArray(evidence);
    if (items.length === 0) {
        const empty = document.createElement("li");
        empty.textContent = "No evidence links provided.";
        target.replaceChildren(empty);
        byId("open-evidence").disabled = true;
        return;
    }
    const nodes = items.map((entry) => {
        const item = document.createElement("li");
        if (typeof entry === "string") {
            item.textContent = entry;
            return item;
        }
        if (entry && typeof entry === "object") {
            const label = textOr(entry.label, textOr(entry.path, textOr(entry.url, "Unlabeled evidence")));
            if (hasText(entry.url)) {
                const link = document.createElement("a");
                link.href = entry.url;
                link.textContent = label;
                link.target = "_blank";
                link.rel = "noopener noreferrer";
                item.append(link);
            } else {
                item.textContent = label;
            }
            if (hasText(entry.status)) {
                const suffix = document.createElement("span");
                suffix.textContent = ` (${entry.status})`;
                item.append(suffix);
            }
            return item;
        }
        item.textContent = "Evidence entry not provided.";
        return item;
    });
    target.replaceChildren(...nodes);
    byId("open-evidence").disabled = false;
}

function renderHistoryList(history) {
    const target = byId("history-list");
    const items = asArray(history);
    if (items.length === 0) {
        const empty = document.createElement("li");
        empty.textContent = "No history provided.";
        target.replaceChildren(empty);
        return;
    }
    const nodes = items.map((entry) => {
        const item = document.createElement("li");
        item.textContent = typeof entry === "string" ? entry : JSON.stringify(entry);
        return item;
    });
    target.replaceChildren(...nodes);
}

function renderAgentList(work, recordsFromFlow = null) {
    const target = byId("agent-list");
    const nodes = [];
    const records = Array.isArray(recordsFromFlow)
        ? recordsFromFlow
        : Array.isArray(work?.agents)
            ? work.agents
            : Array.isArray(work?.subagentEvents)
                ? work.subagentEvents
                : Array.isArray(work?.agentEvents)
                    ? work.agentEvents
                    : [];

    if (records.length > 0) {
        for (const agent of records) {
            const summary = toAgentSummary(agent);
            const item = document.createElement("li");
            item.textContent = [
                summary.name,
                summary.status,
                summary.model,
                summary.description,
            ].join(" · ");
            nodes.push(item);
        }
    }

    if (work?.session && typeof work.session === "object") {
        const item = document.createElement("li");
        item.textContent = [
            textOr(work.session.status, "unknown"),
            textOr(work.session.message, "No session message provided."),
        ].join(": ");
        nodes.push(item);
    }

    if (nodes.length === 0) {
        const empty = document.createElement("li");
        empty.textContent = "No agent state provided.";
        nodes.push(empty);
        byId("open-agents").disabled = true;
    } else {
        byId("open-agents").disabled = false;
    }

    target.replaceChildren(...nodes);
}

function renderNavigationList(flow) {
    const target = byId("blueprint-list");
    const entries = asArray(flow?.blueprints);
    byId("blueprint-count").textContent = `${entries.length} open in this repository`;

    const nodes = entries.map((blueprint) => {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = [
            textOr(blueprint?.title, "Untitled"),
            textOr(blueprint?.filename, "filename not provided"),
        ].join(" · ");
        if (blueprint?.filename === store.selectedBlueprint) {
            button.setAttribute("aria-current", "true");
        }
        if (hasText(blueprint?.filename)) {
            button.addEventListener("click", () => {
                void selectBlueprint(blueprint.filename);
            });
        } else {
            button.disabled = true;
        }
        item.append(button);
        return item;
    });

    if (nodes.length === 0) {
        const empty = document.createElement("li");
        empty.textContent = "No open blueprints provided.";
        target.replaceChildren(empty);
        return;
    }
    target.replaceChildren(...nodes);
}

function resolveApplySignal(flow, currentWork) {
    const flowApply = flow?.apply && typeof flow.apply === "object" ? flow.apply : null;
    const workApply =
        currentWork?.apply && typeof currentWork.apply === "object" ? currentWork.apply : null;
    return {
        state: hasText(flowApply?.state)
            ? flowApply.state
            : hasText(workApply?.state)
                ? workApply.state
                : null,
        requestId: hasText(flowApply?.requestId)
            ? flowApply.requestId
            : hasText(workApply?.requestId)
                ? workApply.requestId
                : null,
        message: hasText(flowApply?.message)
            ? flowApply.message
            : hasText(workApply?.message)
                ? workApply.message
                : null,
    };
}

function renderFlow(flow) {
    store.flow = flow;
    const projectOrg = textOr(flow?.project?.org, "unknown-org");
    const projectRepo = textOr(flow?.project?.repo, "unknown-repo");
    byId("project-name").textContent = `${projectOrg}/${projectRepo}`;

    const blueprint = flow?.blueprint;
    byId("blueprint-title").textContent = textOr(blueprint?.title, "No selected blueprint");
    byId("blueprint-status").textContent = `Status: ${textOr(blueprint?.status, "unknown")}`;

    renderPhaseStrip(flow?.phases, flow?.currentWork);

    const currentWork = flow?.currentWork ?? {};
    byId("current-criterion-id").textContent = hasText(currentWork.criterionId)
        ? `Criterion: ${currentWork.criterionId}`
        : "Criterion id not provided.";
    byId("current-criterion").textContent = textOr(
        currentWork.criterion,
        "Current criterion not provided.",
    );
    byId("current-phase").textContent = `Phase: ${textOr(currentWork.phase, "unknown")}`;
    if (currentWork.needsInput === true) {
        byId("needs-input").textContent = "Needs input: yes";
    } else if (typeof currentWork.needsInput === "string") {
        byId("needs-input").textContent = `Needs input: ${currentWork.needsInput}`;
    } else if (currentWork.needsInput && typeof currentWork.needsInput === "object") {
        byId("needs-input").textContent = `Needs input: ${textOr(
            currentWork.needsInput.question,
            "details not provided",
        )}`;
    } else {
        byId("needs-input").textContent = "Needs input: no";
    }

    renderEvidenceList(currentWork.evidence);
    renderHistoryList(currentWork.history);
    renderAgentList(currentWork, collectAgentRecords(flow, currentWork));
    renderNavigationList(flow);

    const selectedFilename = hasText(blueprint?.filename) ? blueprint.filename : null;
    if (selectedFilename !== store.selectedBlueprint) {
        store.selectedBlueprint = selectedFilename;
        void loadDocument(selectedFilename);
    } else if (selectedFilename) {
        const entry = selectedDocument();
        if (entry && !entry.dirty && !entry.saving) {
            const applySignal = resolveApplySignal(flow, currentWork);
            if (hasText(applySignal.requestId)) entry.remoteRequestId = applySignal.requestId;
            if (hasText(applySignal.state)) {
                entry.remoteDraftStatus = applySignal.state;
                if (!entry.applying) {
                    const mapped = statusForApplyState(entry.remoteDraftStatus, entry.remoteRequestId);
                    if (mapped) {
                        entry.status = hasText(applySignal.message)
                            ? { kind: mapped.kind, text: applySignal.message }
                            : mapped;
                    }
                }
            }
        }
        const revisionFromState =
            typeof blueprint?.revision === "string" || typeof blueprint?.revision === "number"
                ? String(blueprint.revision)
            : null;
        const pendingDraftStates = new Set(["pending", "queued", "applying"]);
        const shouldRefreshPendingDraft =
            entry &&
            !entry.dirty &&
            pendingDraftStates.has(String(entry.remoteDraftStatus).toLowerCase());
        const shouldRefreshRevision =
            entry &&
            !entry.dirty &&
            revisionFromState !== null &&
            String(entry.documentRevision) !== revisionFromState;

        if (!entry || shouldRefreshPendingDraft || shouldRefreshRevision) {
            void loadDocument(selectedFilename);
            return;
        }
        renderDocument(entry, { preserveActive: true });
    } else {
        renderDocument(null, { preserveActive: true });
    }
}

function updateSectionWarnings(extracted) {
    const warning = byId("section-warning");
    if (extracted.missing.length > 0) {
        warning.className = "status error";
        warning.textContent = `Section not provided: ${extracted.missing.join(", ")}.`;
        return;
    }
    warning.className = "status";
    warning.textContent = "Sections map directly to the same markdown draft.";
}

function updateDesignStatus(extracted) {
    const node = byId("design-status");
    if (extracted.planSummary === null) {
        node.textContent = "Design heading status: plan summary not provided.";
        return;
    }
    const hasDesignHeading = containsDesignHeading(extracted.planSummary);
    const hasDiagram = containsMermaidFence(extracted.planSummary);
    if (hasDesignHeading) {
        node.textContent = "Design section found in plan summary.";
        return;
    }
    node.textContent = hasDiagram
        ? "Design diagram found in plan summary."
        : "No design heading or diagram found in plan summary.";
}

function renderDocument(entry, { preserveActive }) {
    if (!entry) {
        store.previewToken += 1;
        byId("blueprint-path").textContent = "File: not provided";
        byId("design-status").textContent = "No blueprint selected.";
        byId("section-warning").textContent = "Select a blueprint to edit.";
        byId("preview-output").replaceChildren();
        byId("preview-state").textContent = "";
        setDraftStatus("error", "No selected blueprint.");
        updateButtons(null);
        return;
    }

    byId("blueprint-path").textContent = `File: ${entry.path}`;
    updateButtons(entry);

    const extracted = extractEditableSections(entry.markdown);
    syncTextareaValue(byId("goal-input"), extracted.goal ?? "", preserveActive);
    syncTextareaValue(byId("active-criteria-input"), extracted.activeCriteria ?? "", preserveActive);
    syncTextareaValue(byId("plan-summary-input"), extracted.planSummary ?? "", preserveActive);
    syncTextareaValue(byId("source-input"), entry.markdown, preserveActive);

    byId("goal-input").disabled = byId("goal-input").disabled || extracted.goal === null;
    byId("active-criteria-input").disabled =
        byId("active-criteria-input").disabled || extracted.activeCriteria === null;
    byId("plan-summary-input").disabled =
        byId("plan-summary-input").disabled || extracted.planSummary === null;

    updateSectionWarnings(extracted);
    updateDesignStatus(extracted);
    setDraftStatus(entry.status.kind, entry.status.text);

    if (store.mode === "preview") void refreshPreview();
}

function updateSelectedMarkdown(nextMarkdown) {
    const entry = selectedDocument();
    if (!entry || typeof nextMarkdown !== "string") return;
    if (entry.markdown === nextMarkdown) return;
    entry.markdown = nextMarkdown;
    entry.clientRevision += 1;
    entry.dirty = true;
    entry.status = { kind: "", text: "Unsaved local edits." };
    renderDocument(entry, { preserveActive: true });
}

function handleSectionEdit(sectionKey, value) {
    const entry = selectedDocument();
    if (!entry) return;
    try {
        const next = applySectionEdits(entry.markdown, { [sectionKey]: value });
        updateSelectedMarkdown(next);
    } catch (error) {
        entry.status = {
            kind: "error",
            text: error?.message ?? "Section update failed.",
        };
        renderDocument(entry, { preserveActive: true });
    }
}

function applyDocumentPayload(payload, filename, sentClientRevision = null) {
    const resolvedFilename = hasText(payload?.filename) ? payload.filename : filename;
    if (!resolvedFilename) return null;

    const entry = ensureDocumentState(resolvedFilename);
    const merged = mergeRemoteDraftState(entry, payload, sentClientRevision);
    store.documents.set(resolvedFilename, merged);

    if (store.selectedBlueprint === resolvedFilename) {
        renderDocument(merged, { preserveActive: true });
    }
    return merged;
}

async function request(path, options = {}) {
    const headers = {
        "X-Minime-Nonce": nonce,
        ...(options.headers ?? {}),
    };
    if (options.body && !headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
    }
    const response = await fetch(path, { ...options, headers });
    let payload = {};
    try {
        payload = await response.json();
    } catch {
        payload = {};
    }
    if (!response.ok) {
        const error = new Error(payload?.error ?? `Request failed (${response.status}).`);
        error.status = response.status;
        error.payload = payload;
        throw error;
    }
    return payload;
}

async function loadDocument(filename) {
    if (!filename) {
        renderDocument(null, { preserveActive: true });
        return;
    }
    try {
        const payload = await request(`/api/document?blueprint=${encodeURIComponent(filename)}`);
        const entry = applyDocumentPayload(payload, filename);
        if (entry && !entry.status.text) {
            entry.status = { kind: "", text: "No local edits." };
        }
    } catch (error) {
        const entry = ensureDocumentState(filename);
        entry.status = { kind: "error", text: error?.message ?? "Unable to load document." };
        if (store.selectedBlueprint === filename) {
            renderDocument(entry, { preserveActive: true });
        }
    }
}

async function saveDraft() {
    const filename = store.selectedBlueprint;
    const entry = selectedDocument();
    if (!filename || !entry) return;

    const sentClientRevision = entry.clientRevision;
    entry.saving = true;
    entry.status = { kind: "", text: "Saving draft…" };
    renderDocument(entry, { preserveActive: true });

    try {
        const payload = await request("/api/draft", {
            method: "POST",
            body: JSON.stringify({
                nonce,
                blueprint: filename,
                markdown: entry.markdown,
                baseRevision: entry.baseRevision,
                expectedDraftRevision: entry.expectedDraftRevision,
            }),
        });
        applyDocumentPayload(payload, filename, sentClientRevision);
    } catch (error) {
        const targetEntry = ensureDocumentState(filename);
        targetEntry.saving = false;
        targetEntry.status = { kind: "error", text: error?.message ?? "Draft save failed." };
        if (store.selectedBlueprint === filename) {
            renderDocument(targetEntry, { preserveActive: true });
        }
    }
}

async function applyDraft() {
    const filename = store.selectedBlueprint;
    const entry = selectedDocument();
    if (!filename || !entry) return;

    if (entry.dirty) {
        entry.status = { kind: "error", text: "Save the draft before apply." };
        renderDocument(entry, { preserveActive: true });
        return;
    }
    if (!hasText(entry.expectedDraftRevision)) {
        entry.status = { kind: "error", text: "A saved draft revision is required before apply." };
        renderDocument(entry, { preserveActive: true });
        return;
    }

    entry.applying = true;
    entry.status = { kind: "", text: "Sending apply request…" };
    renderDocument(entry, { preserveActive: true });

    try {
        const result = await request("/api/apply", {
            method: "POST",
            body: JSON.stringify({
                nonce,
                blueprint: filename,
                expectedDraftRevision: entry.expectedDraftRevision,
            }),
        });
        entry.applying = false;
        entry.remoteRequestId = hasText(result?.requestId) ? result.requestId : null;
        entry.remoteDraftStatus = textOr(result?.status, "unknown");
        entry.status =
            statusForApplyState(entry.remoteDraftStatus, entry.remoteRequestId) ??
            { kind: "", text: `Apply status: ${entry.remoteDraftStatus}.` };
        if (store.selectedBlueprint === filename) {
            renderDocument(entry, { preserveActive: true });
        }
        await loadDocument(filename);
    } catch (error) {
        entry.applying = false;
        entry.status = { kind: "error", text: error?.message ?? "Apply request failed." };
        if (store.selectedBlueprint === filename) {
            renderDocument(entry, { preserveActive: true });
        }
    }
}

async function refreshPreview() {
    const entry = selectedDocument();
    if (!entry) return;
    const token = ++store.previewToken;
    byId("preview-state").textContent = "Rendering preview locally…";
    byId("preview-state").className = "meta";
    const inlineStyleAllowed = await checkInlineStylePolicy();
    if (token !== store.previewToken) return;
    if (!inlineStyleAllowed) {
        await renderPreview({
            target: byId("preview-output"),
            markdown: entry.markdown,
            parseMarkdown: (markdown) => marked.parse(markdown),
            sanitizeHtml: (html) =>
                DOMPurify.sanitize(html, {
                    USE_PROFILES: { html: true },
                    FORBID_TAGS: ["script", "style"],
                    FORBID_ATTR: ["style", "onload", "onclick", "onerror"],
                }),
            renderMermaid: async () => {
                throw new Error("Mermaid preview requires inline styles in CSP.");
            },
        });
        if (token !== store.previewToken) return;
        byId("preview-state").textContent =
            "Preview blocked by CSP (style-src disallows inline styles).";
        byId("preview-state").className = "status error";
        return;
    }

    const colorMode = document.documentElement.dataset.colorMode ?? document.body.dataset.colorMode;
    mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: colorMode === "dark" ? "dark" : "default",
    });

    try {
        await renderPreview({
            target: byId("preview-output"),
            markdown: entry.markdown,
            parseMarkdown: (markdown) => marked.parse(markdown),
            sanitizeHtml: (html) =>
                DOMPurify.sanitize(html, {
                    USE_PROFILES: { html: true },
                    FORBID_TAGS: ["script", "style"],
                    FORBID_ATTR: ["style", "onload", "onclick", "onerror"],
                }),
            renderMermaid: (source, id) => mermaid.render(id, source),
        });
        if (token !== store.previewToken) return;
        byId("preview-state").textContent = "Preview rendered locally.";
        byId("preview-state").className = "status success";
    } catch (error) {
        if (token !== store.previewToken) return;
        byId("preview-state").textContent = `Preview failed: ${error?.message ?? "Unknown error."}`;
        byId("preview-state").className = "status error";
        byId("preview-output").replaceChildren();
    }
}

function changeEditorMode(mode) {
    if (!MODE_ORDER.includes(mode)) return;
    store.mode = mode;
    setEditorMode(document, mode);
    const entry = selectedDocument();
    if (!entry) return;
    if (mode === "source") {
        syncTextareaValue(byId("source-input"), entry.markdown, false);
    }
    if (mode === "preview") {
        void refreshPreview();
    }
}

async function selectBlueprint(filename) {
    try {
        const state = await request("/api/select", {
            method: "POST",
            body: JSON.stringify({ nonce, blueprint: filename }),
        });
        renderFlow(state);
    } catch (error) {
        const entry = selectedDocument();
        if (entry) {
            entry.status = { kind: "error", text: error?.message ?? "Blueprint selection failed." };
            renderDocument(entry, { preserveActive: true });
        } else {
            setDraftStatus("error", error?.message ?? "Blueprint selection failed.");
        }
    }
}

function openPanel(id) {
    const panel = byId(id);
    if (!panel) return;
    panel.open = true;
}

function moveMode(direction) {
    const index = MODE_ORDER.indexOf(store.mode);
    if (index < 0) return;
    const nextIndex = (index + direction + MODE_ORDER.length) % MODE_ORDER.length;
    const nextMode = MODE_ORDER[nextIndex];
    changeEditorMode(nextMode);
    byId(`mode-${nextMode}`)?.focus();
}

function bindUi() {
    byId("save-draft").addEventListener("click", () => { void saveDraft(); });
    byId("apply-draft").addEventListener("click", () => { void applyDraft(); });
    byId("toggle-help").addEventListener("click", () => {
        const panel = byId("panel-help");
        panel.open = !panel.open;
    });

    byId("goal-input").addEventListener("input", (event) => {
        handleSectionEdit("goal", event.target.value);
    });
    byId("active-criteria-input").addEventListener("input", (event) => {
        handleSectionEdit("activeCriteria", event.target.value);
    });
    byId("plan-summary-input").addEventListener("input", (event) => {
        handleSectionEdit("planSummary", event.target.value);
    });
    byId("source-input").addEventListener("input", (event) => {
        updateSelectedMarkdown(event.target.value);
    });

    byId("mode-sections").addEventListener("click", () => changeEditorMode("sections"));
    byId("mode-source").addEventListener("click", () => changeEditorMode("source"));
    byId("mode-preview").addEventListener("click", () => changeEditorMode("preview"));

    for (const mode of MODE_ORDER) {
        byId(`mode-${mode}`).addEventListener("keydown", (event) => {
            if (event.key === "ArrowRight") {
                event.preventDefault();
                moveMode(1);
            }
            if (event.key === "ArrowLeft") {
                event.preventDefault();
                moveMode(-1);
            }
        });
    }

    byId("jump-criterion").addEventListener("click", () => {
        changeEditorMode("sections");
        const criterionId = store.flow?.currentWork?.criterionId;
        const criteria = byId("active-criteria-input");
        const needle = hasText(criterionId) ? criterionId : null;
        if (needle && criteria.value.includes(needle)) {
            const start = criteria.value.indexOf(needle);
            criteria.focus();
            criteria.setSelectionRange(start, start + needle.length);
            return;
        }
        criteria.focus();
    });
    byId("open-evidence").addEventListener("click", () => openPanel("panel-evidence"));
    byId("open-agents").addEventListener("click", () => openPanel("panel-agents"));

    document.addEventListener("keydown", (event) => {
        const key = event.key.toLowerCase();
        const mod = event.metaKey || event.ctrlKey;
        if (mod && key === "s") {
            event.preventDefault();
            void saveDraft();
            return;
        }
        if (mod && event.shiftKey && key === "e") {
            event.preventDefault();
            changeEditorMode("sections");
            return;
        }
        if (mod && event.shiftKey && key === "m") {
            event.preventDefault();
            changeEditorMode("source");
            return;
        }
        if (mod && event.shiftKey && key === "p") {
            event.preventDefault();
            changeEditorMode("preview");
            return;
        }
        if (mod && event.shiftKey && key === "a") {
            event.preventDefault();
            void applyDraft();
            return;
        }
        const editableTarget =
            event.target instanceof HTMLTextAreaElement ||
            event.target instanceof HTMLInputElement ||
            event.target?.isContentEditable;
        if (!editableTarget && event.key === "?") {
            event.preventDefault();
            const panel = byId("panel-help");
            panel.open = !panel.open;
        }
    });
}

function connectEvents() {
    const events = new EventSource(`/events?nonce=${encodeURIComponent(nonce)}`);
    events.addEventListener("state", (event) => {
        const data = JSON.parse(event.data);
        renderFlow(data);
        byId("live-indicator").textContent = "Live";
        byId("live-indicator").className = "pill live";
    });
    events.onerror = () => {
        byId("live-indicator").textContent = "Reconnecting";
        byId("live-indicator").className = "pill";
    };
}

async function start() {
    bindUi();
    changeEditorMode("sections");
    try {
        const state = await request("/api/state");
        renderFlow(state);
        connectEvents();
    } catch (error) {
        byId("blueprint-title").textContent = "Canvas unavailable";
        byId("blueprint-status").textContent = textOr(error?.message, "State is unavailable.");
        byId("live-indicator").textContent = "Offline";
        setDraftStatus("error", textOr(error?.message, "Unable to load state."));
    }
}

void start();
