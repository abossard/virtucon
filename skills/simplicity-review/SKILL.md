---
name: simplicity-review
description: Review code or proposed changes using Grokking Simplicity's data, calculations, actions, shared-value ownership, and effect timing across languages.
---

# Simplicity review

Accept a question, proposal, code scope, or diff. Treat implementation and tests as read-only; save only requested review artifacts in the permitted output scope.

## 1. Trace the changed behavior

Read affected operations, callers, and required outcomes. Identify inputs, shared values, state owners, and external effects.

When available, invoke `ponytail-review` for a diff, or `ponytail-audit` for an explicitly requested whole-repository complexity audit. Pass the requested scope and mutation limits. Otherwise continue this review directly.

Treat Ponytail's findings as complexity input; apply the correctness criteria and verification below even when it finds nothing to cut.

Complete when the scope and material behavior are known or their gaps are explicit.

## 2. Apply the review criteria

Apply the criteria below to actual operations, reachable calls, aliases, and nested values. Interpret language guarantees at their actual scope.

Complete when each relevant operation has a supported classification and source-backed ownership/timing checks, or explicit uncertainty.

## 3. Verify the relevant cases

Use existing tests and project tools through production interfaces or existing internal access. Exercise parameterized decision cases, input preservation where mutation is a risk, and relevant effect/failure paths. Single-threaded decision cases do not establish concurrent action behavior.

Complete when the affected claims have observed evidence or an explicit verification gap.

## 4. Return the review

Report concrete findings with source references, behavior impact, the smallest useful refactoring proposals, and remaining uncertainty. Keep proposed extraction within existing owners and interfaces.

Finish when the scoped operations are accounted for.

## Review criteria

### Data

Treat shared data as immutable. Return new values for updates, copying changed nested paths and protecting values passed to mutating code. Local mutation of fresh, unshared values can stay private. Check aliasing before treating a mutability annotation as proof.

### Calculations

Calculations return results from explicit value inputs or immutable constants. Keep them free of mutable external reads and effects. An action can call a calculation without making that helper an action. Keep unknown callees uncertain.

### Actions

Actions depend on when or how often they run: mutable reads, I/O, time, and randomness. Inspect default arguments, getters, callbacks, and injected implementations for hidden effects. Receiving an effectful service is different from invoking it.

For moved actions, check lock, transaction, retry, and cancellation scopes and required ordering, frequency, errors, and concurrency. Record intentional changes or unresolved risks.
