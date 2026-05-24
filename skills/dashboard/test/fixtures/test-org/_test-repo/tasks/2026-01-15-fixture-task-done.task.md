# Task: fixture-task-done

Created: 2026-01-15  |  Status: implemented  |  Repo: test-org/test-repo

## Goal
A test task that is fully completed.

## Acceptance criteria (EARS-style, each must be independently testable)

- [x] When the user clicks save, the system shall persist data | VOI: decided-by-data
- [x] When the user clicks delete, the system shall remove the item | VOI: decided-by-data
- [ ] If no items exist, then the system shall show an empty state | VOI: decided-by-data

## Out of scope
- Nothing

## Constraints / non-negotiables
- Must be fast

## Decisions made
| Unknown | VOI level | Resolution | Source |
|---------|-----------|------------|--------|
| Database choice | decided-by-data | SQLite | Performance requirements |
