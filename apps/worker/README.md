# @weft/worker

Takes runs off the `runs` queue and executes them: clone, sandbox, agent, verification, diff.
Run as many workers as you like; each handles `WORKER_CONCURRENCY` runs at a time.

```bash
pnpm --filter @weft/worker dev
```

## What happens to a run

1. **Claim.** `claimRun` sets the run `running` and returns the next `attempt` (the fencing
   token). A cancelled or finished run is skipped.
2. **Clone on the host** with `git clone --depth 1` (the host has network, the sandbox doesn't).
   Only `https://` URLs are accepted, plus `file://` when `ALLOW_FILE_REPOS=true` for local
   development, since on a worker it means "read any path on this machine". Git's `ext::`
   transport and friends are refused.
3. **Sandbox.** A follow-up first tries the sandbox its session kept from the previous turn (see
   [Session sandboxes](#session-sandboxes)) and, when it can use it, skips straight to step 6.
   Otherwise a fresh container labelled with the worker id (`weft.owner`) and run id
   (`weft.run`); the checkout, `.git` included, is copied to `/workspace/repo`. A repo with
   dependencies gets network for the setup phase and larger limits (2 GB memory and disk). If the
   sandbox writes more than its disk limit, the disk watchdog kills it and the run ends as
   `disk_limit`, whatever phase it was in.
4. **Continue the conversation** (session turns after the first). The latest earlier turn that
   recorded a diff is applied with `git apply`. Diffs are cumulative from the base branch, so
   that one patch restores everything the agent changed so far. If it no longer applies (someone
   pushed to the branch meanwhile), the turn fails as `apply_failed` instead of quietly working
   on different code.
5. **Setup**, when `package.json` lists dependencies. The lockfile picks the command:

   | Found                                 | Runs                                           |
   | ------------------------------------- | ---------------------------------------------- |
   | `bun.lock` or `bun.lockb`             | `bun install --frozen-lockfile`                |
   | `pnpm-lock.yaml`                      | `pnpm install --frozen-lockfile`               |
   | `yarn.lock` (with `.yarnrc.yml`)      | `yarn install --immutable`                     |
   | `yarn.lock`                           | `yarn install --frozen-lockfile`               |
   | `package-lock.json`, `npm-shrinkwrap` | `npm ci`                                       |
   | no lockfile                           | `<packageManager> install`, else `npm install` |

   Without a lockfile, the `packageManager` field in `package.json` picks the tool, since npm
   can't install a Bun or pnpm workspace (`workspace:*` dependencies). Package caches live in
   `/workspace/.weft-cache`, on the same disk as `node_modules`, so pnpm and Bun hardlink files
   instead of copying them; the npm, pnpm and Bun caches are deleted after the install (Yarn's
   stays, Plug'n'Play reads packages from it).

   It runs inside the sandbox, never on the host, since install scripts are untrusted code. Then
   stray background processes are killed and the network is disconnected, so the agent works
   offline. npm gets `fetch-retries=5`, and an install that fails with a network error
   (`ECONNRESET`, `ETIMEDOUT`, ...) is retried once. A failed or timed-out install (5 min) ends
   the turn as `setup_failed` with the tail of the output. On `vercel/ms` the pnpm install takes about 80 s. A large monorepo (Expo plus
   Next.js, about 1.5 GB of `node_modules`) does not fit in 5 minutes and 2 GB on a home
   connection; see Known limits.

   **Install cache.** After a fresh install, and before the agent runs, every `node_modules`
   folder is tarred straight from the sandbox to `INSTALL_CACHE_DIR` on the worker host, and
   after the turn it becomes a dependency image in the background. The next turn (or chat) with
   the same dependency files starts its sandbox from that image, with no network and nothing to
   copy, or restores the tar if the image isn't ready. See [Install cache](#install-cache).

6. **Agent.** `runAgent` with the LLM from the run's `config` (`provider`, `model`), falling back
   to `.env`, and `maxSteps` (default 30). For later turns it also gets `history`: each earlier
   message with the agent's reply, or a note like "(this turn ended without a reply: cancelled)".
   After every step the worker saves steps and tokens with `recordProgress`. An Ask turn
   (`mode: 'ask'`) runs the agent read-only; if its diff still differs from the previous turn's,
   the turn ends as `ask_changed_files` without recording the changes, and it skips verification, since
   nothing changed.
7. **Diff.** `git add -A && git diff --cached --binary`, so new files and binary changes are
   included and the patch can be applied by the next turn. `node_modules` is always left out,
   even when the repo doesn't ignore it: it is added to the sandbox's `.git/info/exclude` (local
   to the clone, never part of a diff). An earlier version excluded it with a `':!node_modules'`
   pathspec instead, which makes `git add` fail when the repo already ignores `node_modules` and
   the folder exists; the failure went unchecked and turns on most real repos recorded an empty
   diff. A failed diff now fails the turn.
8. **Verify**, when the run has a `testCommand`: the worker reruns it itself instead of trusting
   the agent, and in a **fresh sandbox**: the dependency image (or the base image for a repo
   without dependencies), the clean checkout and the diff from step 7. Nothing the agent left
   outside the diff (a patched `node_modules`, files in its home directory, gitignored files,
   background processes) can affect the verdict
   ([ADR 0002](../../docs/decisions/0002-session-sandboxes-and-clean-verification.md)). Without
   clean dependencies (no image yet for the dependency files as this turn left them, e.g. right
   after a fresh install or when this turn changed a lockfile) it runs in the agent's sandbox and logs that. It runs even when the
   turn changed nothing, so "make the tests pass" with no change still fails as `tests_failed`.
   Without a test command (questions, repos without tests) there is nothing to rerun.
9. **Record** with `completeRun` (fenced), then always remove the sandbox and the checkout.

### Trace

Every agent event, each model call and each tool call, is stored in `run_events` with a
running `seq`, so the dashboard (and later the chat UI) can replay a run step by step. Events
are buffered and written once per model step on the same background chain as progress, so the
agent never waits on the database; whatever is left is written when the run ends. Long string
arguments (a `create_file` with a whole file) are cut to 2000 characters; tool output is already
capped by the agent. A failed trace write is logged and never fails the run.

### Install cache

Two tiers, looked up in order: a **dependency image** (`weft-deps:<key>`), then a **tar** of
every `node_modules` directory, then a fresh install. Why images, and what it costs: see
[ADR 0001](../../docs/decisions/0001-dependency-images.md).

```
fresh:   install online → tar node_modules → cut network → agent      (tar is the snapshot)
         after the turn, in the background: tar → image weft-deps:<key>, then delete the tar
cached:  image exists → sandbox starts from it, copy-on-write, nothing copied
         only the tar → restore it offline (the image is still building, or failed)
```

The key (`weft-install-v2`) is a SHA-256 of the repo URL, the sandbox image id, the install
command, and every dependency file in the repo (each `package.json`, the lockfile, `pnpm-workspace.yaml`, `.npmrc`,
`.yarnrc.yml`, `bunfig.toml`), with `.git` and `node_modules` skipped.

- **Only reproducible installs are cached.** Without a lockfile there is no key, so it installs
  every time.
- **Snapshotted before the agent runs**, so a cached copy is exactly what the install produced;
  the agent can't plant something in it for a later turn. Its own writes to `node_modules` stay
  in its container's writable layer and disappear with it.
- **Per repo.** Two repos with identical dependency files still get separate entries, since
  install scripts can read the rest of the repo.
- **Keyed on the dependency files the turn will actually have.** When the previous turn's diff
  changed any of them, the worker copies just the dependency files to a temporary folder,
  applies only those parts of the diff there (`git apply --include=package.json
--include=*/package.json ...`), and hashes and detects the install command from the result.
  So after the agent adds a dependency, the first turn installs and caches under the new key and
  every later turn hits it. An earlier version keyed on the clone and switched the cache off
  whenever the diff touched a dependency file; diffs are cumulative, so every later turn in that
  chat reinstalled from scratch. Verification uses the same function with this turn's diff to
  find a clean image.
- **One cache per worker process.** `main.ts` creates it once, because the background builder
  outlives a run: builds run one at a time, a key is never queued twice, and a failed build is
  logged and leaves the tar in place, so the next turn still has a cache. Images are built from
  the base image by id, matching the id in the key.
- **Every image records where it came from**, as labels: `weft.repo` (a hash of the repo URL),
  `weft.base` (the base image id), `weft.manager` and `weft.depth` (0 for a fresh install). The
  cache's `nearest({ repoUrl, base, manager })` returns the newest image matching all three and
  under depth 5, never one from another repo.
- **Incremental installs** ([ADR 0003](../../docs/decisions/0003-incremental-installs.md)). On a
  miss, an npm repo's setup sandbox starts from that nearest image and runs
  `npm install --no-save` on top of its `node_modules` (phase `incrementalInstall`). If that
  fails, every `node_modules` is removed and `npm ci` runs instead. The resulting image's depth is
  its base's plus one, or 0 after a fallback; at depth 5 the next miss installs fresh. pnpm, Yarn
  and Bun always install fresh until measured. On the 639 MB repo, adding one package took 10.3 s
  instead of about 275 s for `npm ci`.
- **Bounded.** Tars and images share `INSTALL_CACHE_MAX_MB` and are ranked by last use (a tar's
  mtime, an image's `<key>.used` marker). Tar writes go to a temporary file renamed into place.
  An image a running sandbox uses can't be removed, so it is skipped until the next eviction.
- **A broken tar is dropped.** If restoring fails, the entry is deleted and the turn fails as
  `setup_failed`; the next message installs fresh.
- A failed save is logged and never fails the turn. Yarn Plug'n'Play repos have no
  `node_modules` and are not cached.

On a repo with 639 MB of `node_modules`: `npm ci` takes 275 s and the tar 33 s; restoring the
tar takes 67 s (it was 35–47 s when `/workspace` was tmpfs); building the image takes 171 s in
the background; and a turn that starts from the image reaches the agent in 6.9 s, against 55 s
before. Numbers and trade-offs: [ADR 0001](../../docs/decisions/0001-dependency-images.md).

### Session sandboxes

A chat's sandbox outlives its turn, the way Claude Code on the web keeps a session's VM: the
next message continues in it instead of cloning, starting a container, copying and applying
the diff again. Why, and what it gives up:
[ADR 0002](../../docs/decisions/0002-session-sandboxes-and-clean-verification.md).

- **Kept only after a normal end.** A turn that succeeded or failed (tests, step limit) and was
  recorded leaves its sandbox, its host checkout and what it was set up with in the worker's
  pool. Errors, cancels, a lost run, a disk-limit kill, or a change to any dependency file
  (`package.json`, a lockfile, `.npmrc`, ...: the sandbox's `node_modules` would no longer
  match) destroy it as before.
- **Checked before use** (the `resume` phase): the latest recorded diff must be the one it ended
  with, `git ls-remote` must show the branch still at the commit it was cloned from, and it must
  still answer a command. Otherwise it is released and the turn starts cold.
- **Bounded.** At most `SESSION_SANDBOXES_MAX` per worker (the oldest session is evicted), each
  released after `SESSION_SANDBOX_IDLE_MS` without a turn and never kept past 45 minutes, below
  the janitor's 1 h limit. Shutdown releases all of them; after a crash the janitor reaps them.
- **A workspace, not a clean room.** Whatever the agent left (files in its home directory,
  background processes, tool caches) is there next turn. Verification still runs in a fresh
  sandbox, and the recorded diff stays the source of truth whenever the sandbox is rebuilt.
- The pool lives in one worker's memory: with several workers, a follow-up picked up by another
  worker starts cold.

On the 639 MB repo, a follow-up that resumes reaches the agent in 1.6 s, most of it the
`git ls-remote` round trip; a cold turn from the dependency image takes about 7 s.

### Publishing

`publishSession(deps, sessionId)` pushes a chat to a branch on GitHub
([ADR 0005](../../docs/decisions/0005-publishing-chats-as-branches.md)). It runs on the host,
never in a sandbox, with an installation token from `@weft/github`.

- **One branch per chat**, created from the base branch on the first push and named after the
  pull request's title, `weft/<title slug>-<session id>`, e.g.
  `weft/add-capitalize-string-utility-function-2510dee0`: the title is written before the first
  push, so the branch and the pull request say the same thing. The slug is cut at the last whole
  word within 40 characters; a chat pushed without a pull request is named after its first
  message.
- **One git commit per saved commit**
  ([ADR 0006](../../docs/decisions/0006-user-commits-with-generated-messages.md)): the user commits
  in the chat with a message they edited, and publishing pushes the commits that have no sha yet,
  in order, with the app's bot as author, then records each sha. A commit that turns out to
  change nothing gets no empty git commit.
- **How a commit is built**: clone the branch, undo the last pushed diff (`git apply -R`), apply
  the commit's diff (both are cumulative against the base), commit. The branch only ever moves
  forward; nothing is force-pushed. Commits someone else pushed to the branch are kept and built
  on; if they touched the same lines, publishing fails with git's error instead.
- **Checked before, not during.** Commits are refused while the latest turn is running, failed
  its tests or changed nothing, and Create PR is refused until every change is committed; the
  push itself doesn't recheck the latest turn, so sending a new message right after committing
  can't block it.
- **The publish job** (`handlePublish`, queue `publish`): marks the chat `pushing`, pushes, and
  when the job asks for it and the chat has no pull request yet, reuses an open one for the
  branch or opens one against the base branch (the repo's default branch when the chat has
  none). Failures are saved on the chat, never thrown, so a retry is just another job.
- **Title and description** come from the chat's own model: the turns and the changed files go
  in, a title line and a markdown body come out. A failed call or an unusable reply falls back to
  the chat title and the turns' summaries. The description reads like one a person wrote: it
  never mentions weft, the chat or sandboxes. When the repo has a test command, weft adds a
  `## Testing` section saying it passes; without one there is no testing section.
- **After the pull request exists**, a new commit is pushed as soon as it is saved. Turns are
  never pushed on their own.
- **The token never leaves the worker process**: git gets it as an extra header through
  `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0`/`GIT_CONFIG_VALUE_0`, scoped to `https://github.com/`, so
  it is not in the command line, the remote URL, git config or any file.

### Phase timings

Each phase is timed and stored on the run as `timings`, in the order it ran, and logged as one
line when the run ends (here a small repo without dependencies, from the integration tests):

```
run 4aa22721 timings: clone 0.1s, sandbox 0.9s, copy 0.3s, agent 1.6s, diff 0.2s, verifySandbox 1.3s, verify 0.6s
```

Phases: `resume` (checking a kept sandbox; when it can be used, the turn goes straight to
`agent`), `clone`, `cacheKey` (hashing dependency files), `sandbox` (create and start), `copy`
(repo into the sandbox), `apply` (previous turn's diff), then `cacheRestore` or `install` and
`cacheSave`, `agent`, `diff`, `verifySandbox` (start the clean sandbox, copy, apply the diff)
and `verify`. A phase that didn't run is absent; a run that failed
keeps the phases it got through, so a slow failure still shows where the time went. This is what
every sandbox speed change is measured against.

### Live progress

With `deps.live` set (`main.ts` wires it to `publishLive`), the worker also streams each phase
and every agent event to Redis the moment it happens, then `end` once the result is recorded.
Publishing is fire-and-forget: a slow or failed Redis write is logged and never holds up the
agent or fails the run. A worker that lost its run publishes nothing more. See `@weft/queue`.

### Logs

Every line is tagged with the run's short id, so a slow or failed run can be read straight from
the worker log:

```
run 1b1e4ee1 started (1b1e4ee1-65f1-40ad-a705-edbec9d7639d)
run 1b1e4ee1 #1 llm 2.8s in=1326 out=10
run 1b1e4ee1    ✗ run_tests 857ms
run 1b1e4ee1 llm retry 1 in 45.0s: rate_limit (429)
run 1b1e4ee1 #2 llm 1.4s in=738 out=21
run 1b1e4ee1    ✓ view_file 164ms
run 1b1e4ee1 succeeded in 14.9s
```

The retry policy (`withRetry`) is applied inside `executeRun` rather than by the caller, so each
retry is logged against its run. A result that was refused because the run was cancelled or
taken over is logged as such, never as `error`. Logging goes through `deps.log`, which tests
capture and a structured logger can replace later.

### Cancellation and takeover

A watcher re-reads the run every 2 s (`watchIntervalMs`). As soon as it is no longer `running`
with this worker's attempt (cancelled, or claimed by another worker), or a progress write is
fenced off, the worker:

- aborts the run's `AbortSignal`, which stops an in-flight model call and any retry wait, and
- removes the sandbox right away, which also kills a long tool command such as `run_tests`.

Nothing more is written for the run. Before this, a cancel was only noticed after the current
step, so a cancelled run stuck on a hanging model kept its worker and sandbox for 11 minutes;
now it stops within a couple of seconds. Polling is the simple version; a Redis pub/sub cancel
message would make it instant.

| Outcome     | When                                                                                                            |
| ----------- | --------------------------------------------------------------------------------------------------------------- |
| `succeeded` | The agent replied with `finish`, and the tests pass if there is a test command.                                 |
| `failed`    | `tests_failed`, or the agent stopped early (`max_steps`, `no_tool_call`, ...).                                  |
| `error`     | `clone_failed`, `apply_failed`, `setup_failed`, `disk_limit`, `llm_<kind>` (e.g. `llm_rate_limit`), `internal`. |

Failed runs keep the diff and the tail of the test output in `failure_detail`.

The janitor (`reapSandboxes`) runs on boot and every `JANITOR_INTERVAL_MS`. On SIGINT/SIGTERM
the worker stops taking jobs, lets active runs finish, then closes Redis and Postgres.

## Configuration

| Variable                                       | Default                                                |
| ---------------------------------------------- | ------------------------------------------------------ |
| `DATABASE_URL`                                 | required (Neon, pooled)                                |
| `REDIS_URL`                                    | `redis://localhost:6379`                               |
| `SANDBOX_IMAGE`                                | `weft-sandbox:dev`                                     |
| `WORKER_ID`                                    | `<hostname>-<random>`                                  |
| `WORKER_CONCURRENCY`                           | `1`                                                    |
| `ALLOW_FILE_REPOS`                             | `false`                                                |
| `JANITOR_INTERVAL_MS`                          | `60000`                                                |
| `INSTALL_CACHE_DIR`                            | `~/.cache/weft/installs`; empty disables the cache     |
| `INSTALL_CACHE_MAX_MB`                         | `10240`                                                |
| `SESSION_SANDBOXES_MAX`                        | `2`; sandboxes kept between turns, `0` disables        |
| `SESSION_SANDBOX_IDLE_MS`                      | `600000` (10 min)                                      |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY_PATH` | unset: publishing to GitHub is off. See `@weft/github` |
| `LLM_*`, API keys                              | see `@weft/llm`                                        |

## Known limits (M2)

- **The first install is still slow.** The cache helps every turn after it, not the first.
- **Every turn sets up dependencies, even a question.** "Summarise this repo" needs no `node_modules`, but
  still waits for the install (or the restore), and a large monorepo can fail setup before the
  agent reads a file.
- **Install scripts have network.** They run sandboxed, but online; egress is not yet limited
  to the package registries.
- **The agent can change the tests.** Verification runs in a fresh sandbox, but with the diff's
  version of the test files; restoring them from the base commit is still to do. The run also
  doesn't record whether verification ran fresh or fell back to the agent's sandbox.

## Testing

```bash
pnpm --filter @weft/worker test               # clone safety, no docker
pnpm --filter @weft/worker test:integration   # whole pipeline: PGlite, scripted LLM, real sandboxes
```

The integration tests drive real sandboxes against a local git copy of
`packages/agent/fixtures/add-bug`: a successful fix, failing tests, step budget, cancel before
start, dependency install with an offline agent afterwards (npm, and a Bun workspace with
`workspace:*` dependencies in `test/fixtures/bun-workspace`), the install cache round trip
(the second run restores offline), a failing install, cancel mid-run, cancel during a hanging model call and during a long tool command (both
must stop within seconds), takeover by another worker, clone failure, `file://` refusal, and
LLM failure, each checking that no sandbox is left behind.
