# 0009. Checking a chat's diff before it is committed or published

- Status: Accepted
- Date: 2026-10-28

## Context

Before this, the only gate between the agent's diff and a public pull request was the test
rerun. Three problems got through:

- **Secrets.** The sandbox holds no credentials, but the agent can copy a key it finds in the
  repository into new code, or create a `.env` file. GitHub's push protection catches some token
  formats, but only at push time, after the user has committed, and with a git error.
- **Workflow files.** The GitHub App has no `workflows` permission
  ([0004](0004-github-app-auth.md)), so a diff touching `.github/workflows/` fails at push with a
  git error.
- **Weakened tests.** The eval ([0007](0007-agent-evals.md)) measures rewritten test lines, but
  the product never told the user.

## Decision

- **A small package, `@weft/checks`**, with `checkDiff(diff)`: pure functions over the
  `git diff --binary` the worker already collects. Findings have a kind, a severity (`block` or
  `warn`), a file, an optional line and a message.
- **Blocking:** added lines matching high-confidence token formats, any added or changed `.env`
  file except templates, and any change under `.github/workflows/`.
- **Warnings:** rewritten lines in existing test files (the eval's rule, moved here so both use
  one implementation) and files adding over 1 MB.
- **Run once per turn, stored on the run.** The worker checks the diff when it records the turn.
  Diffs are cumulative from the base branch, so the latest Code turn's findings cover the whole
  chat; commit, pull request and the UI all read the same stored result.
- **Blocking findings stop commit and publish, not the turn.** The turn did what was asked; the
  user sees why it can't be committed and can ask for the fix in the chat, and the next turn's
  diff is checked again.
- **Messages never repeat a secret**, only where it is and what it looks like.

## Alternatives considered

**gitleaks or another scanner.** Far more rules, but a Go binary in every worker, and its
broader, entropy-based rules flag test fixtures and hashes; a false block with no override would
leave the user stuck. A handful of exact token formats catches the common leaks with almost no
false positives.

**Rely on GitHub secret scanning and push protection.** Free and maintained, but it runs after
the push or rejects it with a git error, and doesn't cover private keys in all cases, `.env` files
or workflows.

**Check at commit time in the API.** No migration, but the UI couldn't show findings on the turn,
and the API and the worker's publish job would each have to run the checks.

**Fail the turn on a blocking finding.** Simpler to show, but it marks a turn failed that did what
was asked, and an Ask turn after it would hide nothing either way.

**Allow overriding a block.** Useful for a false positive, but deferred until one shows up in
real use; until then the fix is a message to the agent.

## Consequences

- No commit or pull request can carry a recognised token, an environment file or a workflow change.
- Pattern matching misses secrets in formats it doesn't know; it is a guard against common
  mistakes, not a guarantee.
- A blocked chat needs one more turn to remove the problem.
- The test-rewrite rule is shared, so improving it improves both the eval and the product.
