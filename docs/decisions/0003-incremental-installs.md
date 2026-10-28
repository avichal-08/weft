# 0003. Incremental installs from the repo's newest dependency image

- Status: Accepted
- Date: 2026-10-27

## Context

With dependency images ([0001](0001-dependency-images.md)) and kept session sandboxes
([0002](0002-session-sandboxes-and-clean-verification.md)), a turn only installs when no image
exists for its exact dependency files: the first time weft sees a repo, or when a lockfile
changes, upstream or because the agent added a dependency.

That install was always a full one. On a repo with 494 packages, `npm ci` took about 275 s on a
4-CPU development machine on a residential connection. Measured separately (1 CPU, 2 GB, like the setup
sandbox):

| Part of `npm ci`              | Time   | Notes                                                                           |
| ----------------------------- | ------ | ------------------------------------------------------------------------------- |
| download packages             | ~134 s | 115 MB at about 0.86 MB/s                                                       |
| extract 18,566 files (467 MB) | 114 s  | measured from a warm cache, offline                                             |
| install scripts               | 116 s+ | `electron` 107 s (downloads its binary), `esbuild` 5 s; `node-pty` not measured |

The parts overlap inside `npm ci`, so they add up to more than 275 s, but each is roughly a third.
No single trick removes all three, and caching downloads only touches the first.

Two problems made it worse. The cache key was computed from the clone, before the previous
turn's diff, so the cache was switched off whenever that diff touched a dependency file; diffs
are cumulative, so after the agent added a dependency every later turn reinstalled from scratch.
And a single dropped connection (`ECONNRESET`) failed the whole install.

## Decision

1. **Key on the dependency files after the diff.** The worker copies only the dependency files
   to a temporary folder, applies the dependency parts of the previous diff there
   (`git apply --include=package.json --include=*/package.json ...`), and computes the install
   command and the cache key (`weft-install-v2`) from the result. After a dependency change only
   the next turn installs; later turns hit its image.
2. **Install incrementally from the nearest image.** Every dependency image is labelled with the
   repo (a hash of its URL), the base image id, the package manager and a depth. On a cache miss,
   the setup sandbox starts from the newest image with the same repo, base image and manager and
   runs `npm install --no-save` on top of its `node_modules`, instead of `npm ci` from nothing.
   npm reconciles the tree with the lockfile: it adds what is new, replaces changed versions,
   removes what is gone, and only runs install scripts for packages it touched. `--no-save` keeps
   it from rewriting `package.json` or the lockfile, which would otherwise leak into the diff.
3. **Fall back, never fail worse.** If the incremental install fails, every `node_modules` is
   removed and the normal fresh install runs in the same sandbox.
4. **Limit the chain.** An image built incrementally has the depth of its base plus one; images
   at depth 5 are not offered as a base, so the next miss installs fresh and starts a new chain.
5. **Retry the network.** npm gets `fetch-retries=5`, and an install that fails with a network
   error (`ECONNRESET`, `ETIMEDOUT`, `EAI_AGAIN`, ...) is retried once.

npm only, for now. pnpm, Yarn and Bun keep installing fresh until each is measured: weft deletes
the pnpm store after an install to save space, and pnpm's incremental install may want it back.

This is weft's version of what Codex calls a maintenance script ("useful when the setup script
ran on an older commit and dependencies need to be updated") and Claude Code on the web does
with a SessionStart hook that installs based on dependency-file hashes; the difference is that
weft picks the base and the command itself.

Measured on the same repo, starting from its dependency image:

| Install                                     | Time   |
| ------------------------------------------- | ------ |
| `npm ci` from nothing (before)              | ~275 s |
| `npm install --no-save`, lockfile unchanged | 19.2 s |
| `npm install --no-save`, one new package    | 10.3 s |

The unchanged run is npm checking the existing tree against the lockfile; it was the first run
in the container, so part of it is the disk cache warming up.

## Alternatives considered

**A package proxy (Verdaccio) shared by all installs.** Removes repeated downloads across repos,
about a third of a fresh install at best, and only for packages seen before. It does nothing for
writing 18k files or for install scripts that download from elsewhere (Electron fetches its
binary from GitHub, not npm). It is worth having as the egress allowlist for installs, which is
how Claude Code and Codex use their proxies, so it moves to the security work.

**Always `npm ci`, just faster** (`--prefer-offline`, a shared npm cache mounted into every
setup sandbox). A shared writable cache is a cross-repo poisoning risk, since install scripts run
with write access to it, and it still pays for extracting every file and every install script.

**Skip install scripts (`--ignore-scripts`).** Removes Electron's 107 s, but breaks native modules
and anything that needs a postinstall step, so tests would behave differently from a real
checkout.

**Start the agent while the install runs.** Hides the wait instead of shrinking it, including
for the very first install, which caching can't help. Neither Claude Code nor Codex does this. It
stays on the roadmap, with the agent limited to reading while the network is on.

## Consequences

- A lockfile change costs seconds of install instead of minutes. The turn still saves a tar of
  the result before the agent starts (about 33 s on this repo), so the first turn after a change
  is roughly 45–55 s instead of about 5 minutes; later turns hit the new image or resume.
- The first install of a repo is unchanged.
- An incremental result can differ slightly from a clean `npm ci` (a stale file a package left
  behind, hoisting order). It only ever builds on images from the same repo, base image and
  manager; the depth limit forces a fresh install every few changes; and clean verification
  runs on the resulting image.
- Images built before the labels existed are never used as a base. The key change to
  `weft-install-v2` also made every older image miss once.
- A tar restored without its image (a failed build, a worker restart) is rebuilt as depth 0, so
  the depth limit can be reset in that rare case.
- The fallback can take two installs' worth of time (each with its own 5 minute timeout) when the
  incremental one fails late.
