# 0005. Publishing a chat as a branch with one commit per turn

- Status: Accepted; superseded in part by [0006](0006-user-commits-with-generated-messages.md)
  (commits are made by the user, and turns are no longer pushed automatically)
- Date: 2026-10-27

## Context

A chat produces a cumulative diff per turn: each turn's diff is against the base commit and
includes everything earlier turns changed. To ship that work weft has to put it on GitHub, where
people review and merge it. The questions are what the branch looks like, when it is created,
what happens on follow-ups, and what weft refuses to publish.

Claude Code on the web pushes a branch at a stopping point and lets the user open the pull
request; Codex cloud has a "Create PR" button and pushes later changes to the same pull
request; GitHub's Copilot agent opens a draft pull request and commits to it as it works.

## Decision

- **The user publishes**, with a "Create PR" button. Questions and exploratory turns never create
  branches on their own. Once a chat is published, later turns are pushed to the same branch.
- **One branch per chat**, `weft/<title slug>-<first 8 characters of the session id>`.
- **One commit per succeeded turn**, holding only that turn's changes and its summary as the
  message, authored by the GitHub App's bot. The commit is built by cloning the branch, undoing
  the last pushed cumulative diff, and applying the turn's cumulative diff, so each commit's tree
  is exactly base + that turn's diff and the history reads like ordinary work.
- **Forward only.** Nothing is ever force-pushed. Commits someone else adds to the branch stay;
  weft builds on top of them, and fails with git's error if they touched the same lines.
- **Blocked while the tests fail.** Publishing is refused if the chat's latest turn failed its
  tests, is still running, or didn't finish. A repository without a test command can still be
  published; nothing verified it.
- **On the host, never in a sandbox.** Clones and pushes run in the worker process with a
  repository-scoped installation token ([0004](0004-github-app-auth.md)), handed to git through
  `GIT_CONFIG_*` environment variables.

## Alternatives considered

**Squash the whole chat into one commit and force-push it each time.** Simpler (no reverse
apply), but rewrites history under anyone reviewing the pull request, loses which turn did what,
and destroys commits others pushed to the branch.

**Push every turn automatically from the first change** (Copilot-style draft pull requests).
Zero clicks, but creates branches for experiments the user never meant to ship, and puts a
public artifact out before anyone looked at the result.

**Open a draft pull request when tests fail.** Lets work in progress be shared, but makes "weft
opened a pull request" ambiguous about whether it works. A draft can be added later as an
explicit choice.

**A commit per turn including failed ones.** Records every step, but leaves commits on the
branch that don't pass tests; the next succeeded commit carries those changes anyway.

## Consequences

- The pull request's history matches the conversation: one commit per accepted step.
- A turn's diff must reverse-apply on the branch. That holds as long as only weft edits those
  lines; when someone else does, publishing stops with a clear error rather than guessing.
- Turns still start from the base branch plus the latest diff, not from the published branch.
  If the base moves, a later turn can be built on a newer base than the branch it is pushed to;
  making the branch the source of truth for later turns is a separate step.
- Commits show the app's bot as author, not the user.
