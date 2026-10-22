# Blueprint: <short-name>

Repo: <org>/<repo> | Created: <YYYY-MM-DD>

## Inputs

- **I1** (<YYYY-MM-DD HH:MM>):
  > <verbatim user message>

## Criteria

- **C1** (I1): When <trigger>, <owner> shall <observable response>.

## Boundaries

| ID | Owner | Contract | Change | Criteria |
|----|-------|----------|--------|----------|
| B1 | `<path>` <function or module> | <input> → <output>; <guarantee or error behavior> | <new, changed or unchanged> | C1 |

## Tests

| ID | Criterion | Boundary | Cases | Check | Result |
|----|-----------|----------|-------|-------|--------|
| T1 | C1 | B1 | <normal case>; <edge or error case> | `<command run from the repo root>` | pending |

## Decisions

| ID | Question | Answer | Source |
|----|----------|--------|--------|
| D1 | <unknown> | <answer> | <data, research or user>: <path:line, wiki page, URL or input ID> |

## Constraints

- <behavior or interface that must not change> (<source>)

## Out of scope

- <explicit non-goal> (<source>)
