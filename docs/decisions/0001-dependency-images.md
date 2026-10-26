# 0001. Dependencies as copy-on-write image layers

- Status: Accepted
- Date: 2026-10-26

## Context

Every turn of a chat runs in a fresh sandbox: the repo is cloned, the previous turn's diff is
applied, dependencies are installed, and only then does the agent start. Turns 2, 3, 4… of a
conversation almost always have the same lockfile, so they are the common case for the install
cache, which so far stored a tar of every `node_modules` directory and streamed it back into
the next sandbox.

Measured on a repo with 494 packages (639 MB, 22,642 files in `node_modules`), on a 4-CPU WSL2
machine with Docker 29:

| Phase before the agent starts | Cached turn | Fresh turn |
| ----------------------------- | ----------- | ---------- |
| clone, hash, start, copy      | 8.4 s       | 5.2 s      |
| restore tar (stream in)       | 46.9 s      |            |
| `npm ci`                      |             | 274.9 s    |
| save tar                      |             | 33.2 s     |
| total                         | 55 s        | 313 s      |

The restore was 85% of a cached turn's wait. It is a full copy, so it grows with the size of
`node_modules`, and it varied from 35 s to 47 s with load on the machine.

## Decision

Keep installed dependencies as an image layer and start sandboxes from it, so the container
runtime shares the files copy-on-write instead of copying them.

- **Fresh turn, unchanged on the critical path.** The install runs online, `node_modules` is
  tarred to the host before the agent starts, the network is cut, and the agent runs in the same
  container. The tar is the snapshot of exactly what the install produced.
- **After the turn, in the background**, the worker unpacks the tar into a helper container of
  the base image, `docker commit`s it as `weft-deps:<key>`, then deletes the tar. One build runs
  at a time and a key is never queued twice.
- **Cached turn.** If `weft-deps:<key>` exists, the sandbox starts from it with no network and
  there is no restore step. If only the tar exists (the image is still being built, or its build
  failed), the tar is restored as before. Otherwise it is a fresh install.
- **The key is unchanged**: repo URL, base image id, install command and every dependency file.
  The image is built from the base image by id, not by tag, so a rebuilt `weft-sandbox:dev`
  can never be mixed with dependencies keyed to the old one.
- **Eviction.** Tars and images share the `INSTALL_CACHE_MAX_MB` budget and are ranked together
  by last use (a tar's mtime, an image's `<key>.used` marker). Docker refuses to remove an image a
  running sandbox uses; that entry is skipped and retried on the next eviction.

This mirrors how hosted coding agents describe their environments: OpenAI's Codex caches the
container state after its setup script and checks out the task's branch on top, which is the
same split as a post-install image plus the turn's code.

Measured with the same repo: starting a sandbox from the dependency image takes 3.6–4.1 s,
and writing into `node_modules` inside it works and only copies up the touched file.

## Alternatives considered

**`docker commit` on the critical path.** The obvious version: commit the container right
after the install. Measured at 173 s for this repo, because Docker's containerd image store
diffs, compresses and then unpacks every file again, plus about 5 s of fixed cost per commit.
That would make every fresh turn three minutes slower. An uncompressed BuildKit build was
slower still (239 s), which shows the cost is in handling 22,642 small files several times,
not in gzip.

**Switch Docker to the classic `overlay2` storage driver**, where a commit is roughly one pass
over the files. A host-wide Docker setting is the wrong place for an application to depend on,
and it only makes the build faster, not free.

**Mount the cache read-only (volume or bind mount).** Instant, but tools write into
`node_modules`: Vite and Vitest keep `node_modules/.vite`, Babel and ESLint keep
`node_modules/.cache`. Tests would break or behave differently from a normal checkout.

**Mount the cache writable and share it.** Instant, but every turn and every chat on the repo
would write into one directory. An agent that patches a library to make a test pass would leave
that patch for every later turn, while the diff (and so the pull request) would not contain it,
so "the tests pass" would stop meaning anything. Two chats would also write the same files at
once, and a prompt-injected change would persist across chats.

**Host overlayfs or btrfs/ZFS snapshots.** The same copy-on-write idea done by weft instead of
Docker: a cached directory as the lower layer and an empty directory per turn as the upper one.
Flexible and fast, but mounting needs root on the host (the rootless `fuse-overlayfs` is
slower), snapshots need a btrfs or ZFS disk, and weft would have to clean up mounts left by a
crashed worker.

**Keep the sandbox alive between turns.** Removes the setup cost entirely for quick follow-ups
and is planned on top of this, but it holds memory while idle, needs routing back to the same
worker, and needs a cold path to fall back on. This decision is that cold path.

## Consequences

- A cached turn no longer copies dependencies. The expected time before the agent starts is the
  fixed part of the table above (about 8 s); the measured result is recorded below once taken.
- Fresh turns are not faster. Install time is network-bound and is a separate problem.
- A follow-up sent within about three minutes of a fresh install still restores from the tar,
  because the image is not ready yet.
- **The root filesystem is no longer read-only.** `/workspace` has to live on the container's
  writable layer: a tmpfs mounted there would hide the dependencies baked into the image, and
  Docker's read-only mode removes the writable layer altogether. The sandbox still runs as
  uid 1000 with no capabilities, so it can only write to `/workspace` and its home; the image's
  world-writable directories (`/tmp`, `/var/tmp`, `/run/lock`) each get a size-capped tmpfs.
  The lost layer of defence is planned to be replaced by running sandboxes under gVisor.
- **Workspace writes go to disk, uncapped.** Docker can only cap a writable layer on xfs with
  project quotas; on ext4 it cannot. `workspaceMb` needs a watchdog that measures the layer and
  kills the sandbox. Until then a runaway process can fill the host disk. On the other hand,
  `node_modules` no longer counts against the sandbox's memory limit, as it did in tmpfs.
- Dependency images take disk until evicted (about the size of `node_modules` each), and their
  build costs about 3 minutes of background IO per new lockfile.
- An image a sandbox is using cannot be evicted, so the cache can sit above its budget until that
  sandbox is gone.
- Two workers on one host building the same key at once would both commit, and the losing image
  becomes untagged. With one worker per host this cannot happen; it needs a lock or a prune of
  dangling `weft.deps` images before running several.
- The images are ordinary images, so a later version can push them to a registry and share them
  between machines, with the local image as the first tier.
