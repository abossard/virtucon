---
name: plan
description: Plan a coding task from a task.md brief or inline context. Reads the per-repo corrections wiki (score-and-verify, never dump-all), thinks silently, self-challenges, and hands off to implement. No human review gate. The plan is consumed by implement and is never signed off.
when_to_use: When the user has a task to plan: either as a task.md file, inline conversation context, or a verbal description. This skill starts the orchestration flow.
allowed-tools: Read Edit Grep Glob Bash(git remote get-url *) Bash(git log *) Bash(git status) Bash(ls *) Bash(mkdir *) Write
---

# Skill: plan

Runs first in the four-phase flow. **No human review gate.** Your plan is an input the next skill consumes, not a document anyone signs off.

## Steps

1. **Persist the living task brief FIRST. This is non-negotiable.**
   Derive `<org>` and `<repo>` from `git remote get-url origin`. Create the task brief at:
   `MINIME_HOME/<org>/_<repo>/tasks/<YYYY-MM-DD>-<short-name>.task.md`
   Use `mkdir -p` to ensure the directory exists, then write the file.
   Use the template from `MINIME_HOME/templates/task.template.md`. Set all criteria as `- [ ]` (unchecked) and assign a VOI level to each:
   - **decided-by-data**: resolvable from code/docs/tests/specs
   - **needs-research**: resolvable but needs evidence gathering
   - **undecidable-now**: value tradeoff/policy, needs human decision
   This file evolves through all phases and is the cross-phase task record.
   If the file already exists (re-planning), edit it in place. Do not create a duplicate.
   (MINIME_HOME is resolved by the SessionStart hook. See the minime-workflow-nudge in your context.)
   **STOP and verify**: confirm the file exists on disk before proceeding to step 2.

2. **Accept the task brief from wherever it lives.**
   - If `task.md` exists in the working directory, use it.
   - If no `task.md` exists but the user gave inline context (conversation text, a pasted description, a table of requirements), use that directly. Do NOT block on a missing file.
   - If neither exists, ask the user to describe the task or point to a file.
   **Preserve user words verbatim.** Copy the user's exact original request into the "User's original request" section of the task brief. Do not paraphrase, reword, or interpret. The raw signal is the ground truth.
   Then nudge for EARS completeness: if acceptance criteria are vague or non-EARS, ask for a concise refinement using EARS patterns. Nudge, don't block on perfection: ask for the minimum edits needed to make criteria independently testable.
   **Evidence method (mandatory).** Each criterion MUST include an evidence method, for example: `| Evidence: <how this will be verified>`. The evidence method specifies: (1) what tool or framework, (2) at what boundary (API, CLI, UI accessibility attributes, public interface), (3) what constitutes pass vs fail. If a criterion has no evidence method, BLOCK. Do not proceed until one is defined. Tests must target the user-facing or API boundary, not internal implementation details.

3. **Locate wiki sources (user-home only).** Run `git remote get-url origin`, derive `<org>` and `<repo>`, and open `MINIME_HOME/<org>/_<repo>/wiki.md` directly. Also load `MINIME_HOME/<org>/wiki.md` when present. If the repo wiki file is absent, tell the user to run `/minime:init-orchestration` once.

4. **Discover domain-specific skills and agents.** Scan for other installed skills and agents that could be relevant to this task:
   - Check the current repo for `.agents/`, `.skills/`, `agents/`, `skills/` directories.
   - Check other installed plugins visible in the environment.
   - If a discovered skill or agent is relevant to the task (e.g., a testing framework skill, a deployment agent), mention it in the plan so the implement phase can use it.
   This bridges generic orchestration to domain-specific tooling.

5. **Run a VOI/decidability triage before full planning.**
   For each open unknown in the task brief:
   - If it is **decidable-by-data**, resolve it with evidence and record it in the Decisions table.
   - If it is **needs-research**, dispatch research and then record it.
   - If it is **undecidable-now**, prepare one explicit user decision with options and tradeoffs, then record the outcome.
   Update the VOI level on each criterion in the persisted task brief as you resolve unknowns.

6. **Score wiki entries for relevance. Do not dump them all in.**
   Rank candidates with this priority order:
   - Trigger match strength to the current task brief
   - `Status: active` over stale/superseded
   - Higher `Confidence` and `ValueScore`
   - More recent `LastVerified`
   - `Origin: human-correction` over weaker signals when tied
   Select only the entries needed for this task after ranking.

7. **Verify before trusting (citation check).** Each selected entry cites a code location. Open that location. If the code no longer matches the entry, the entry is stale. Ignore it and flag it for `/minime:harvest` to fix. Never plan on an unverified memory.

8. **Plan silently.** Produce an internal implementation plan: files to touch, order of work, which acceptance criteria each step satisfies, and the tests that will prove each one. Working state, not a deliverable.

9. **Test strategy critique (mandatory, before implementation).**
   Dispatch the test strategy to a rubber-duck agent for critique. The rubber-duck must verify:
   - Every criterion has an evidence method defined.
   - Evidence methods test at the user-facing or API boundary, not internals.
   - Error cases and wrong-input cases are covered, not just happy paths.
   - The evidence method is concrete enough that a different agent could write the test without guessing.
   Adopt findings that surface genuine gaps. This is the "tests planned before implementation" gate.

10. **Self-challenge (write this down, keep it short).** Answer:
   - What is the riskiest assumption in this plan?
   - Under what condition would this approach be wrong?
   - What in the task brief is ambiguous? If genuinely blocking, ask the user ONE question. Otherwise state the assumption and proceed.

11. **Hand off.** Tell the user the plan is ready, then instruct: **now invoke `skill("implement")`** to start the test-driven implementation loop. Pass the path to the persisted task brief.

## Rules
- Do not produce a plan document for human approval. No plan-review gate.
- Prefer the smallest plan that satisfies the task brief. Avoid process stages not tied to executable evidence.
- If wiki and live code disagree, the live code wins.
- **Preserve raw signal.** User-written sentences are never reworded or interpreted. Copy them verbatim into the task brief. Derive actions separately, assess with evidence, do not add interpretation.
- **Data over interpretation.** Raw data and evidence outrank interpretation. When evidence and interpretation conflict, the evidence wins. This is a scientific principle, not a preference.
