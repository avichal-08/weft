# 0002. Persistent session sandboxes, verified in a clean one

- Status: Accepted
- Date: 2026-10-26

## Context

With dependency images ([0001](0001-dependency-images.md)), a follow-up turn on a large repo
still spends about 7 s before the agent starts: clone 2.9 s, start a sandbox 3.1 s, copy the
repo 0.9 s, apply the previous diff. All of it rebuilds a sandbox that the previous turn just
threw away.

Until now every turn was a clean room: a fresh sandbox from the base commit, the previous
turn's diff and clean dependencies, so nothing an agent did in one turn could leak into the
next. The same sandbox also ran the final verification, so a turn's "tests pass" was only as
trustworthy as the agent's own environment: a library patched inside `node_modules`, or a file
the diff doesn't carry, could make tests pass that fail on the real change.

Claude Code on the web treats a session differently: one VM per session, kept across messages,
paused with its files saved when idle and restored on the next message, with a fresh VM only
when the paused one has been reclaimed. The agent's environment is a workspace that is allowed
to change; the branch it pushes is the output. weft's roadmap also has a live preview mode,
which needs a dev server that keeps running across turns, which a clean room per turn can't
offer.

## Decision

Split the two jobs a sandbox did:

1. **The agent's sandbox belongs to the session** and is kept between turns while the session
   is active (an idle timeout, a cap per worker, destroyed on shutdown). A follow-up continues in
   it. It is best effort: when it is gone, the turn rebuilds it from base commit, latest diff and
   dependencies, as before, so the recorded diff stays the source of truth.
2. **Verification runs in a fresh sandbox**: the dependency image (or the base image for a repo
   without dependencies), the clean checkout, and this turn's cumulative diff, then the test
   command. Whatever the agent left outside the diff (`node_modules`, its home directory,
   gitignored files, background processes) can't affect the verdict.

Verification still runs whenever the repo has a test command, including turns that changed
nothing, so "make the tests pass" with no change is still reported as `tests_failed`.

When there are no clean dependencies to verify with, the tests run in the agent's sandbox, as
before, and the worker logs it. That happens right after a fresh install (before its image is
built) and when the diff changes dependency files, since the image's `node_modules` would no
longer match.

Step one (this change) is the clean verification; keeping the session's sandbox is next.

## Alternatives considered

**Prepare the next turn's sandbox in advance ("standby").** After a turn, build a fresh sandbox
for the next one in the background (clone, image, copy, apply) and park it. It keeps the clean
room per turn with almost no new logic, since it is the cold path run early. Rejected because
it optimises for an architecture the preview mode can't use, and it still verified in the
agent's sandbox. It also spends work on follow-ups that never come.

**Reuse the sandbox but validate it** (`docker diff` against the image, reject any change outside
the repo or in `node_modules`). Keeps a clean room with reuse, but every rule is a judgement
call: tools legitimately write `node_modules/.vite` and `node_modules/.cache`, so it either
forces cold starts for those projects or needs an allow-list that is itself a hole.

**Keep verifying in the agent's sandbox.** No extra sandbox per turn, but "tests pass" would
keep depending on state the pull request doesn't contain, which matters more once the agent's
sandbox lives for the whole session.

## Consequences

- "Tests pass" now means the tests pass on base commit + diff with the cached dependencies,
  which is what a pull request's CI will see.
- Turns with a test command pay for a second sandbox at the end: start from the image, copy the
  repo, apply the diff. Turns without one pay nothing.
- Verification falls back to the agent's sandbox in the two cases above; the log says so. The
  run doesn't record which one was used yet.
- The agent can still change the tests themselves, and those changes are in the diff. Restoring
  test files for verification is a separate decision.
- Once session sandboxes land, an agent's changes to its environment persist for the rest of the
  session, like a developer's laptop, and are lost when the sandbox is rebuilt.
- A kept sandbox lives in one worker's memory. With several workers a follow-up can land on
  another worker and start cold; routing a session's turns to one worker would fix that.
