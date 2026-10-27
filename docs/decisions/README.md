# Architecture decisions

Each file records one significant design decision: the problem and the numbers behind it,
what was chosen, the alternatives that were considered, and what the choice costs. They are
written for an engineer new to weft who wants to know why something is the way it is before
changing it.

A decision is never edited to say something else. If it is revisited, a new record supersedes
it and the old one gets a `Superseded by` line.

| #                                                        | Decision                                                     | Status   |
| -------------------------------------------------------- | ------------------------------------------------------------ | -------- |
| [0001](0001-dependency-images.md)                        | Dependencies as copy-on-write image layers                   | Accepted |
| [0002](0002-session-sandboxes-and-clean-verification.md) | Persistent session sandboxes, verified in a clean one        | Accepted |
| [0003](0003-incremental-installs.md)                     | Incremental installs from the repo's newest dependency image | Accepted |

## Template

```md
# NNNN. Title

- Status: Proposed | Accepted | Superseded by NNNN
- Date: YYYY-MM-DD

## Context

## Decision

## Alternatives considered

## Consequences
```
