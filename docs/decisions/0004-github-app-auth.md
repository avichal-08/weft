# 0004. GitHub App for repository access

- Status: Accepted
- Date: 2026-10-27

## Context

weft ends a turn with a diff. To ship work it has to push a branch and open a pull request, and
for private repositories it has to clone them in the first place. That needs credentials with
write access to a user's repositories, held by a system that runs untrusted code in sandboxes.

The ways production coding agents connect to GitHub: Claude Code on the web and Codex cloud each
use a GitHub App that the user installs on chosen repositories; GitHub's own Copilot coding agent
is first-party. All of them push a branch per task and let the user open or review the pull
request.

## Decision

weft authenticates as a **GitHub App**.

- The app has two repository permissions, **contents: write** and **pull requests: write**, and is
  installed by the user on the repositories weft may touch.
- The worker signs a short-lived app JWT (RS256, 9 minutes) with the app's private key, looks up
  the installation for the repository, and asks for an **installation token scoped to that one
  repository** with those two permissions. GitHub issues it for one hour; weft caches it until
  five minutes before expiry.
- Tokens stay in the worker process on the host. Pushes and API calls happen there, never in a
  sandbox, and the token is passed per command, not stored in a remote URL, git config or file.
- No webhook for now, so the app needs no public URL and works against a local weft.

The client is `@weft/github`, with no third-party dependencies.

## Alternatives considered

**Personal access token in `.env`.** The quickest start: one secret, no registration. But it is
long-lived, typically scoped far wider than one repository, always acts as one person, and does
not survive weft being used by anyone else. A fine-grained token narrows the scope but keeps the
other problems.

**OAuth app with user login.** Acts as the signed-in user, so pull requests are authored by them.
For private repositories the classic `repo` scope grants access to every repository the user can
reach, tokens are long-lived, and weft would need a login flow before anything else works.

**A GitHub App acting on behalf of the user** (user-to-server tokens). Lets pull requests show the
user as author while keeping the app's permission limits, but needs the login flow too. It can be
added on top of this later without changing how pushes work.

## Consequences

- The user registers the app once and installs it on each repository weft should open pull
  requests on. A repository without the installation gets a clear error naming it.
- Commits and pull requests are authored by the app's bot account, not the user.
- A leaked token is limited to one repository, two permissions and at most an hour.
- The app's private key is the long-lived secret. It lives outside the repository, readable only
  by its owner, and only the worker loads it.
- Private repositories can be cloned with the same token, so they come at no extra cost.
