# Architecture decisions

Each file records one significant design decision: the problem and the numbers behind it,
what was chosen, the alternatives that were considered, and what the choice costs. They are
written for an engineer new to weft who wants to know why something is the way it is before
changing it.

A decision is never edited to say something else. If it is revisited, a new record supersedes
it and the old one gets a `Superseded by` line.

| #                                                        | Decision                                                     | Status                             |
| -------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------- |
| [0001](0001-dependency-images.md)                        | Dependencies as copy-on-write image layers                   | Accepted                           |
| [0002](0002-session-sandboxes-and-clean-verification.md) | Persistent session sandboxes, verified in a clean one        | Accepted                           |
| [0003](0003-incremental-installs.md)                     | Incremental installs from the repo's newest dependency image | Accepted                           |
| [0004](0004-github-app-auth.md)                          | GitHub App for repository access                             | Accepted                           |
| [0005](0005-publishing-chats-as-branches.md)             | Publishing a chat as a branch with one commit per turn       | Superseded in part by 0006         |
| [0006](0006-user-commits-with-generated-messages.md)     | Commits made by the user, with generated messages            | Accepted                           |
| [0007](0007-agent-evals.md)                              | Evaluating the agent with a small suite of graded tasks      | Accepted                           |
| [0008](0008-ask-mode.md)                                 | Ask mode: read-only turns enforced by the tool set           | Accepted                           |
| [0009](0009-diff-checks.md)                              | Checking a chat's diff before it is committed or published   | Accepted                           |
| [0010](0010-token-budget.md)                             | A token budget per turn                                      | Accepted                           |
| [0011](0011-single-user-sign-in.md)                      | Single-user sign-in with a password and a signed cookie      | Accepted                           |
| [0012](0012-single-vm-deployment.md)                     | Deploying on one VM with Docker Compose                      | Accepted, cloud superseded by 0013 |
| [0013](0013-hosting-on-aws-ec2.md)                       | Hosting on AWS EC2, reached through Session Manager          | Accepted                           |
| [0014](0014-ssh-access.md)                               | SSH access with a key, restricted to the owner's IP          | Accepted                           |

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
