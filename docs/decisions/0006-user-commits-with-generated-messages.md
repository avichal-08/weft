# 0006. Commits made by the user, with generated messages

- Status: Accepted
- Date: 2026-10-27
- Supersedes the commit-per-turn and push-every-turn parts of [0005](0005-publishing-chats-as-branches.md)

## Context

[0005](0005-publishing-chats-as-branches.md) turned every succeeded turn into a commit, with the
first line of the agent's reply as its message, and pushed every later turn to an open pull
request automatically. Using it on a real repository showed two problems:

- The history followed the chat, not the work. "Rename that", "try again" and small corrections
  each became a commit.
- The messages were the agent's replies ("Added the `isBlank(text)` function to `src/strings.js`
  to check…"), not commit messages.

People commit when a piece of work is ready and write the message themselves, often with help.

## Decision

- **The user makes commits** with a Commit button. A commit records the latest turn's changes and
  a message; it stays in weft until the chat is published.
- **The message is drafted, then edited.** `POST /sessions/:id/commits/draft` asks the chat's model
  for a commit message, given only what changed since the last commit (per file: newly changed,
  changed again with its earlier and current version, or reverted) and the messages sent since.
  The reply is cleaned up (fences, quotes, prefixes, a trailing period, a subject over 72
  characters); without a model, or when it fails, the draft is `Update <files>`. The user edits
  the draft before saving.
- **Same quality bar as publishing**: no commit while the latest turn is running, didn't finish or
  fails its tests, and none when nothing changed since the last commit.
- **Create PR needs everything committed.** The API refuses with `uncommitted` otherwise, so the
  UI can offer the commit dialog first. Publishing pushes the saved commits in order, one git
  commit each, built the same way as before (undo the last pushed diff, apply the commit's).
- **After the pull request exists, a commit is pushed right away.** Nothing is pushed without one:
  the automatic push after every turn is gone.
- The message is drafted by the API, not the worker, because the user is waiting for it in a
  dialog; it needs no checkout, only the recorded diffs.

## Alternatives considered

**Keep a commit per turn with better messages.** Less work and no extra click, but the history
still mirrors the conversation, and the user never decides what a unit of work is.

**Squash the chat into one commit.** Simple, and many teams squash-merge anyway, but multi-step
work loses its structure and there is still no message the user chose.

**Let the agent commit inside the sandbox** (as Claude Code does) and replay its commits. Natural
for the agent, but it decides when to commit, and models tend to commit too often or mid-change.

**Push each commit to a branch as soon as it is made.** Simpler, but puts branches on GitHub
before the user decided to open a pull request.

## Consequences

- The pull request's history is what the user committed, with messages they approved.
- Opening a pull request takes a commit first; the UI makes that one dialog, not two steps.
- A commit can't be split or amended yet; a later commit is the way to change something.
- Turns still start from the base branch plus the latest diff, not from the published branch.
