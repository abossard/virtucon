---
name: blueprint
description: "Blueprint a coding task from inline context or an existing blueprint. Reads the per-repo corrections wiki (score-and-verify, never dump-all), thinks silently, self-challenges, and hands off to replicate. No human review gate. The blueprint is consumed by replicate and is never signed off."
when_to_use: "When the user has a task to plan, whether as an existing blueprint file, inline conversation context, or a verbal description. This skill starts the orchestration flow."
allowed-tools: Read Edit Grep Glob Bash(git remote get-url *) Bash(git log *) Bash(git status) Bash(ls *) Bash(mkdir *) Write
---

# Skill: blueprint

Runs first in the four-phase flow. **No human review gate.** Your plan is an input the next skill consumes, not a document anyone signs off.

## Steps

1. **Persist the living blueprint FIRST. This is non-negotiable.**
   Derive `<org>` and `<repo>` from `git remote get-url origin`. Use VIRTUCON_HQ from the session nudge (falls back to env var, then `~/.minime`).
   Create the blueprint at `VIRTUCON_HQ/<org>/_<repo>/blueprints/<YYYY-MM-DD>-<short-name>.blueprint.md`.
   Run `mkdir -p` to ensure the directory exists, then write the file.
   **Do NOT write the blueprint to the working directory.** The blueprint must go to VIRTUCON_HQ, not the repo.
   Use the template from `VIRTUCON_HQ/templates/blueprint.template.md`. Set all criteria as `- [ ]` (unchecked) and assign a VOI level to each:
   - **decided-by-data**: resolvable from code/docs/tests/specs
   - **needs-research**: resolvable but needs evidence gathering
   - **undecidable-now**: value tradeoff/policy, needs a human decision through `ask_user`
   This file evolves through all phases and is the cross-phase record.
   If the file already exists (re-planning), edit it in place. Do not create a duplicate.
   **STOP and verify**: read the file back from disk to confirm it was written. If it wasn't, fix the path and retry before proceeding.

2. **Accept the blueprint from wherever it lives.**
   - If a blueprint file exists in the working directory, use it.
   - If no blueprint exists but the user gave inline context (conversation text, a pasted description, a table of requirements), use that directly. Do NOT block on a missing file.
   - If neither exists, use `ask_user` to request either an inline task description or a file path. Include `evidence` that no usable task source exists yet, `suggestions` with confidence and reasoning, and a `free_text` override.
   **Preserve user words verbatim.** Copy the user's exact original request into the "User's original request" section of the blueprint. Do not paraphrase, reword, or interpret. The raw signal is the ground truth.
   Then nudge for EARS completeness: if acceptance criteria are vague or non-EARS, use `ask_user` for the minimum refinement needed. Show the evidence, provide concise suggestions with confidence and reasoning, and include a `free_text` override. Nudge, do not block on perfection.
   **Evidence method (mandatory).** Each criterion MUST include an evidence method, for example: `| Evidence: <how this will be verified>`. The evidence method specifies: (1) what tool or framework, (2) at what boundary (API, CLI, UI accessibility attributes, public interface), (3) what constitutes pass vs fail. If a criterion has no evidence method, BLOCK. Do not proceed until one is defined. Tests must target the user-facing or API boundary, not internal implementation details.

3. **Locate wiki sources (user-home only).** Open `VIRTUCON_HQ/<org>/_<repo>/wiki.md` directly. Also load `VIRTUCON_HQ/<org>/wiki.md` when present. If the repo wiki file is absent, the session-start hook should have created it; tell the user to check their plugin installation.

4. **Discover domain-specific skills and agents.** Scan for other installed skills and agents that could be relevant to this task:
   - Check the current repo for `.agents/`, `.skills/`, `agents/`, `skills/` directories.
   - Check other installed plugins visible in the environment.
   - If a discovered skill or agent is relevant to the task (e.g., a testing framework skill, a deployment agent), mention it in the plan so the implement phase can use it.
   This bridges generic orchestration to domain-specific tooling.

5. **Run a VOI/decidability triage before full planning.**
   For each open unknown in the blueprint:
   - If it is **decidable-by-data**, resolve it with evidence and record it in the Decisions table.
   - If it is **needs-research**, dispatch `general-purpose` subagents with strict return contracts: evidence first, interpretation second. Return: (1) raw proof — URLs, exact quotes, code paths, command outputs, (2) citations with page/section, (3) then ≤5 bullets of conclusions. No statements without backing evidence. No summaries without raw output. Then record the resolution.
   - If it is **undecidable-now**, call `ask_user` as described in `assets/ORCHESTRATION.md` § Ask_user rule. Show the evidence, present options with tradeoffs plus confidence and reasoning, include a `free_text` override, then record the outcome.
   Update the VOI level on each criterion in the persisted blueprint as you resolve unknowns.

   **File research answers into the wiki (Karpathy compound-knowledge principle).**
   When a "needs-research" item is resolved with evidence (citations, code references, API docs, upstream behavior), the resolved answer is a wiki entry candidate. Do not write it to the wiki directly (that is harvest's job). Instead, append it to a `## Research resolved` section in the blueprint with:
   - The question that was resolved
   - The answer with citations
   - A suggested `Trigger` for future retrieval
   - A suggested `Scope` if directory-specific
   Harvest will evaluate these candidates using its write-filtering policy and persist the worthy ones. This ensures research compounds across tasks instead of evaporating into chat history.

6. **Score wiki entries for relevance. Do not dump them all in.**
   Rank by: `Scope` match > trigger match > `Status: active` > higher `Confidence`/`ValueScore` > more recent `LastVerified` > `Origin: human-correction`. Select only entries needed for this task.

7. **Verify before trusting.** Each selected wiki entry cites a code location. Open it. If the code no longer matches, the entry is stale. Ignore it and flag for `/minime:extract`. Never plan on an unverified memory.

8. **Plan silently — and persist.** Internal implementation plan: files to touch, order, which criteria each step satisfies, tests to prove each one.

   Write a `## Plan summary` section into the blueprint containing: files to touch, implementation order, test strategy, fix-shape decisions, and resolved wiki constraints. This section is the handoff to replicate — it must be complete enough for a fresh agent with no prior context to execute.

   **Fix-shape decision (mandatory).** Per change area, choose:
   - **Clean bounded refactor** (default): move ownership to right boundary, delete stale abstractions.
   - **Smallest patch**: only when scope is narrow and existing structure is sound.
   State choice and one-line rationale. Record in the plan summary.

9. **Test strategy critique (mandatory, before implementation).**
   Dispatch to a rubber-duck agent to verify: every criterion has an evidence method, methods test at user-facing boundary, error cases covered, methods concrete enough for another agent to write tests.

10. **Self-challenge (keep it short).** Answer:
   - Riskiest assumption?
   - When would this approach be wrong?
   - What is ambiguous? If blocking, ask ONE question. Otherwise state assumption and proceed.

11. **Hand off.** Instruct: **now invoke `skill("replicate")`** to start the test-driven implementation loop. Pass the persisted blueprint path.

## Rules
- Do not produce a plan document for human approval. No plan-review gate.
- Prefer the smallest plan that satisfies the blueprint. Avoid process stages not tied to executable evidence.
- If wiki and live code disagree, the live code wins.
- **Preserve raw signal.** User-written sentences are never reworded or interpreted. Copy them verbatim into the blueprint. Derive actions separately, assess with evidence, do not add interpretation.
- **Data over interpretation.** Evidence weight tiers: full (execution output, user confirmation), some (direct code references), zero (AI statements without execution or code reference). When evidence and interpretation conflict, the evidence wins.
- Follow context-engineering guidance in `assets/ORCHESTRATION.md` § Context engineering.
