# Orchestration

Dr. Evil owns the workflow. Phase workers complete their assigned work and return evidence to the caller.

## Phase isolation

Dispatch each phase through a fresh native task named `blueprint`, `replicate`, `inspect`, or `extract`. Use a general-purpose or project specialist for blueprint, replicate, and extract; use `minime:frau` for inspect.

Explicit dispatch establishes the fresh context. Skill metadata alone does not establish it in every runtime. A direct phase invocation returns to its caller without starting another phase.

The persisted blueprint is the sole cross-phase state bus. Keep task decisions and evidence there so the next worker can proceed without the previous conversation.

## Phase transition ownership

1. **Blueprint:** obtain a persisted plan with checkable criteria and evidence methods.
2. **Replicate:** obtain the task-scoped changes, execution output, and updated blueprint.
3. **Inspect:** obtain fresh verification and a risk tier. Route HIGH-risk findings through the [decision rule](#ask_user-rule). Archive accepted criteria and return unfinished work to replicate.
4. **Extract:** dispatch at the [terminal boundary](#terminal-extract-boundary).

After three attempts on one criterion without new execution evidence, present the obstacle through the decision rule.

## Boundary approval

Boundary decisions cover responsibility owners, cross-boundary contracts, dependencies, and state/effect ownership.

Record approved boundary decisions in Decisions made. Ask again before changing agreed boundaries; private refinements and cosmetic diagram edits need no new approval.

**Boundary drift:** return disagreements between code and approved decisions to the owner. Fix implementation mistakes within the agreed design; get a user decision for a design change. Unresolved drift blocks completion even when behavioral tests pass.

## Result contract

Each phase returns all of these fields. The status describes that phase, not the whole workflow.

| Field | Value |
|-------|-------|
| `status` | `done`, `blocked`, or `failed` |
| `blueprint_path` | Absolute persisted path, or `null` |
| `changed_files[]` | Sorted repository-relative paths changed by this phase for the task |
| `blocking_issue` | Actionable reason, or `null` |
| `evidence_excerpts[]` | Compact raw proof or direct observations |

Use empty arrays for empty collections. Store durable proof in the blueprint; excerpts identify the evidence needed for the next step.

## Correction queue contract

Keep the user's draft separate from the applied blueprint that workers read.

When the user applies a correction, stop dispatching successors and let active workers reach their boundary. Recover current worker state before applying after a reconnect; unknown state is not evidence that work has stopped. An idle worker has finished its current turn.

The owner then:

1. Reads the applied document, proposed correction, and available base version.
2. Reconciles concurrent changes while preserving the user's submission and worker evidence.
3. Applies the result through the available revision-checked operation.
4. Reads back the persisted result and resumes unfinished criteria.

On conflict, retain both versions and identify the next action. Discover operation names and inputs from current runtime capabilities. Private storage edits are not a recovery interface.

The user-correction interface protects the original request and accepted archive. The owner maintains routine evidence and archives through normal file tools after rereading the blueprint. An already-applied notification is a receipt, not a new task.

## Living blueprint lifecycle

Keep only the current correction's new, failed, or invalidated criteria active, with a reference to its verbatim source. A checked active criterion records passing implementation evidence; it is not yet an accepted archive record.

After fresh inspection accepts a criterion, move its ID, requirement, and proof reference to the [criteria archive](blueprint.template.md#criteria-archive). Keep raw evidence reachable.

Recheck accepted requirements when behavior or boundaries change, or their evidence no longer establishes them. Limit rechecks to affected requirements.

## Inspection scope

Give inspect the current-task delta, active criteria, and any accepted requirements affected by it. If that boundary is missing or ambiguous, resolve it before inspection.

The inspector evaluates only that scope. Its [skill](../skills/inspect/SKILL.md) owns verification methods, risk assessment, and the evidence package.

## Terminal extract boundary

Keep extract pending through correction loops. Dispatch it at most once, when the task completes or the session explicitly ends, with no active criteria or blocker.

## Progress tracking

Use native plans, todos, and task status for execution visibility. They reflect the blueprint; they do not replace it.

For an orchestrated run, the owner creates one item per phase and keeps one phase in progress. For a direct invocation, track only that phase. Update assignments and dependencies at handoffs, and finish substeps before marking the phase done. If no native planning tool exists, continue with the blueprint.

Distinguish unfinished work from a blocker. A blocked update must name the impediment, affected work, next action, and action owner. Say when the user must act. Unrun verification is pending work.

For canvas presentation, editing, or verification, read [Canvas guidance](CANVAS.md). When an external tracker would help, obtain permission before maintaining it as another view of progress.

## Value of Information -> VOI

| Unknown | Response |
|---------|----------|
| `decided-by-data` | Resolve from code, documentation, tests, or specifications. |
| `needs-research` | Gather evidence, using a bounded worker when warranted. |
| `undecidable-now` | Ask the user to choose a value tradeoff or policy. |

Record the resolution beside its source in the blueprint.

## Ask_user rule

Use the native question tool for undecidable tradeoffs, a missing task source, or a concrete obstacle that needs the user's action.

Show the evidence, recommended options with confidence and reasons, and a free-text override. Adapt this information to the tool's actual schema. Ask one focused question at a time, then resume the work after the answer.

Keep permission requests separate from routine handoffs. A completed plan needs no extra approval question unless the [boundary approval rule](#boundary-approval) applies.

## Evidence value chain

Evidence weight has three tiers:

1. Execution output or user confirmation: full value.
2. Direct code references: supporting value.
3. AI assertions without execution or code references: no value.

Match the proof to the claimed boundary. A local or mocked check does not establish native host, browser, or cloud behavior.

## Reasoning invariant

Respect the user's current model, reasoning, and context settings. Supply explicit task overrides only when the user selected them for this task.

Use strong reasoning under those settings. A faster validation route narrows scope and time, not inspection independence.

## Git mutation boundary

Keep changes unstaged unless the user authorizes the specific current-task Git operation. Permission is phase-bound, not standing authorization. Staging is not a prerequisite for verification or completion.

## Shared knowledge contract

Resolve `VIRTUCON_HQ` from the session nudge, then the environment, then `~/.minime`. Derive repository identity from its configured origin.

```text
VIRTUCON_HQ/
  raw/<org>/<repo>/
  wiki/
    index.md
    log.md
    orgs/<org>/<repo>/
    patterns/
  schema.md
  templates/
  _TEMPLATE.md
  <org>/_<repo>/blueprints/
```

| Layer | Purpose and boundary |
|-------|----------------------|
| Raw | Immutable, append-only source material: user feedback, curated findings, decisions, and useful failed approaches. Keep bulk logs in execution artifacts. |
| Wiki | Maintained guidance derived from raw sources. Keep repository topics in their repository scope and reusable cross-repository rules in patterns. |
| Schema | Naming and linking conventions for the knowledge base. Use live code to resolve conflicting claims. |
| Blueprints | Living task plans and handoffs, kept under the owning repository's blueprint directory. |

The wiki index is a catalog; the log records ingest, query, and lint activity. Topic pages use `_TEMPLATE.md` at the knowledge root. Prefer the global wiki tree; legacy per-repository wiki files are compatibility inputs.

During ingest, preserve the raw source, then maintain affected topics and navigation. During query, select relevant topics before reading deeply. During lint, check citations, contradictions, duplicate guidance, and orphan scopes.

## Context engineering

Preserve user wording verbatim. Redact secrets, tokens, credentials, and customer data before persisting it, and identify the redaction.

Rank knowledge by scope match, relevance, active status, citation quality, recency, and user-correction origin. Read a small relevant set, then open its cited code before treating a claim as guidance. Uncited claims are leads; flag stale claims for extract.

On entering a new work area, check for applicable scoped guidance. Keep research returns evidence-first, with source paths, URLs, or exact quotes ahead of interpretation.

## Topic ownership

| Responsibility | Authoritative source |
|----------------|----------------------|
| Workflow, boundary approval, corrections, shared knowledge, and handoffs | This guide |
| Planning and acceptance-criterion writing | [Blueprint](../skills/blueprint/SKILL.md) |
| Blueprint document shape and archive records | [Blueprint template](blueprint.template.md) |
| Design visuals and simplification | [Visual design](../skills/blueprint/visual-design.md) |
| Implementation and test scope | [Replicate](../skills/replicate/SKILL.md) |
| Independent verification and risk | [Inspect](../skills/inspect/SKILL.md) |
| Knowledge capture and maintenance | [Extract](../skills/extract/SKILL.md) |
| Canvas interaction | [Canvas guidance](CANVAS.md) |

Reference the owning guidance instead of copying it. Runtime schemas and source code own callable interfaces, supported values, and implementation details.
