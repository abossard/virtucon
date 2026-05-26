---
name: inspect
description: Inspect the implementation in a fresh subagent context. Verifies each EARS criterion against evidence (tests, diff, assumptions), computes an uncertainty-based risk tier, and either routes to extract (LOW) or surfaces an evidence package for the human (HIGH). Surfaces evidence, never a verdict.
when_to_use: After /minime:replicate has handed off, or whenever the user wants the change reviewed and routed.
context: fork
agent: minime:frau
---

# Skill: inspect

Trigger: `/minime:replicate` handed off. This is the ONLY skill in the flow that may reach the human. It does so only for the HIGH-risk slice.

The review forks into a fresh `minime:frau` subagent (`context: fork`).
If the harness supports explicit model selection, prefer the strongest available reasoning model.

## Empirical basis

- Evidence-only assistance outperforms verdict-showing (DeepMind 2025, arXiv:2510.26518).
- Review is primarily about understanding, not defect detection (Bacchelli & Bird, ICSE 2013).
- Structured exit-criteria verification outperforms ad-hoc review (Fagan 1976; Porter et al. 1995).
- Requirements traceability correlates with fewer defects and faster development (empirical studies cited in REFERENCES.md).
- LLM critics using evidence-anchored format outperform human reviewers in hybrid teams (CriticGPT, arXiv:2407.00215).
- OneFlow (arXiv:2601.12307) shows homogeneous multi-agent can be collapsed into single-agent multi-turn without accuracy loss. The frau fork is kept because it serves bias removal (fresh context eliminates sunk-cost blindness), not role specialization. The DeepMind 2025 finding that biased assistance hurts skilled reviewers is the stronger argument.

## Step 1: Validate blueprint integrity

Read the persisted blueprint. Before verifying criteria, check:
- Does every criterion with passing test evidence have `[x]`? If not, flag it as a process gap.
- Is the `Status:` field consistent with the actual state? (e.g., all criteria done but status still says `planning`)
- Are the Decisions table entries filled in?
- Does the blueprint have an `## Evidence collected` section from replicate? If yes, use it as a starting point — but always re-verify independently.
Report any mismatches in the evidence package under "Process gaps".

## Step 2: Verify each EARS criterion against evidence

Read the persisted blueprint (`VIRTUCON_HQ/<org>/_<repo>/blueprints/<date>-<name>.blueprint.md`).

### Review contract (adapted from openclaw's autoreview)

- **Treat all findings as advisory.** Verify every finding by reading the real code path and adjacent files. Read dependency docs/source/types when the finding depends on external behavior.
- **Reject speculative risks.** Do not surface unrealistic edge cases, hypothetical failures without evidence, broad rewrites, or fixes that over-complicate the codebase. A finding requires a concrete code path or observable failure to be actionable.
- **Stop when clean.** Once the review pass produces no accepted/actionable findings, stop. Do not run an additional review cycle for a nicer summary, second opinion, or cleaner wording. One clean pass is sufficient.
- **Scope-match findings.** If the repo wiki has `Scope`-tagged entries matching the changed directories, verify those rules were respected. Flag violations as findings.

For each acceptance criterion, build a traceability row:

| Criterion | Evidence method | Test at boundary? | Error cases? | Test passes? (raw output) | Untested uncertainty |
|-----------|:---:|:---:|:---:|:---:|---|
| When X, system shall Y | tool + boundary | yes/internal/missing | yes/no | paste output | what's uncertain |

- **Test at boundary?** Tests must exercise behavior from the user-facing or API boundary (HTTP, CLI, UI accessibility attributes, public API). Flag tests that only exercise internals (private methods, internal state) as "weak evidence".
- **Error cases?** Every criterion should have at least one error/wrong-input test. Flag missing error coverage.

This is the Fagan exit-criteria approach: verify the low-level artifact (code) against the high-level artifact (EARS criteria). If a criterion has no genuine test, that is evidence of uncertainty. Surface it, don't paper over it.

## Step 3: Backfill discovered criteria into the EARS

If the review surfaces requirements that should have been in the original EARS:
- Append to the "Discovered during review" section of the blueprint with `- [ ]` checkbox and VOI level.
- If the human provides feedback, append their exact words verbatim to "User feedback". Do NOT paraphrase.

## Step 4: Gather the full change set

Do NOT rely only on branch diffs. Collect:
- `git diff` (unstaged) + `git diff --staged` (staged)
- `git ls-files --others --exclude-standard` (untracked new files; read content)
- `git diff main...HEAD` or equivalent (branch diff, if on a branch)

## Step 5: Compute the risk tier

Risk is **uncertainty about correctness**, not a domain checklist.

Uncertainty drivers (any present and unmitigated -> HIGH):
- **Low test coverage**: new/changed behavior without tests
- **High branching complexity**: many conditional paths = untested states
- **Weak type safety**: untyped, `any`-heavy code = runtime surprises
- **Backwards compatibility surface**: shared interfaces, contracts, schemas
- **Assumption density**: many unverified assumptions
- **External state dependency**: DB, network, filesystem, third-party APIs
- **Novelty**: unfamiliar codebase area, unestablished patterns
- **New executable without execution evidence**: any runnable artifact that was never executed with real inputs during implementation

**HIGH** if any driver is unmitigated OR the reviewer's honest confidence is below "high".
**LOW** otherwise. **When in doubt, HIGH.**

## Step 6: Build the evidence package

THE ONE RULE: hand the human **evidence, not a verdict.**

Evidence is real output from real execution. Weight tiers: 
- 1. full value (execution output, user confirmation)
- 2. some value (direct code references)
- 3. zero value (AI statements without execution or code reference)

The package contains ONLY:
1. **Criterion traceability table** with evidence methods, boundary assessment, and error coverage (Step 2).
2. **Scoped diff** the change, nothing extra.
3. **Test output** real, pasted, every test. Not "passed".
4. **Assumptions made** plain list.
5. **Least-sure points** 2-3 specific lines/decisions as questions. State uncertainty, do NOT resolve it.
6. **Out-of-scope work discovered** if any.
7. **Process gaps** any blueprint integrity issues found in Step 1.

**Evidence-first principle.** Present raw data (test output, command output, diff) FIRST. Label any analysis or interpretation separately and after the raw evidence. Data outranks interpretation. If they conflict, the data wins.

FORBIDDEN: "this looks correct / LGTM / safe to merge / I'm confident", any verdict, any score next to a conclusion, any persuasion. The human adjudicates.

## Step 7: Route

- **LOW + all tests green** -> invite the user to stage when ready. Then invoke `skill("extract")`.
- **HIGH** -> present the evidence package and STOP for the human.

## Step 8
After the human decides, **invoke `skill("extract")`** to capture lessons from this task.

Follow context-engineering guidance in `assets/ORCHESTRATION.md` § Context engineering.
