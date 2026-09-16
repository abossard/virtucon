import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { deriveRepository, repositoryBlueprintRoot } from "./blueprints.mjs";
import { readDocumentDraftState } from "./document-store.mjs";

const PHASES = new Set(["blueprint", "replicate", "inspect", "extract"]);

export function guardPhaseDispatch(input, { sessionId, blueprintRoot } = {}) {
    const args = input.toolArgs;
    if (input.toolName !== "task" ||
        (!PHASES.has(args?.name) && !["minime:frau", "minime:dr-evil"].includes(args?.agent_type))) {
        return;
    }
    try {
        const root = blueprintRoot ?? repositoryBlueprintRoot(deriveRepository(input.workingDirectory));
        for (const entry of readdirSync(root, { withFileTypes: true })) {
            if (!entry.isFile() || !entry.name.endsWith(".blueprint.md")) continue;
            const draft = readDocumentDraftState({
                draftRoot: root, documentPath: resolve(root, entry.name), sessionId,
            });
            if (draft?.status === "queued") {
                return {
                    permissionDecision: "deny",
                    permissionDecisionReason: `Pending blueprint correction ${draft.requestId}. Drain current workers, commit and reread the correction before dispatching a successor.`,
                };
            }
        }
    } catch (error) {
        if (error.code === "ENOENT") return;
        return {
            permissionDecision: "deny",
            permissionDecisionReason: `Cannot verify pending blueprint corrections: ${error.message}`,
        };
    }
}
