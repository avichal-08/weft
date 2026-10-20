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
3. **Sandbox.** A fresh container labelled with the worker id (`weft.owner`) and run id
   (`weft.run`); the checkout, `.git` included, is copied to `/workspace/repo`.
4. **Agent.** `runAgent` with the LLM from the run's `config` (`provider`, `model`), falling back
   to `.env`, and `maxSteps` (default 30). After every step the worker saves steps and tokens
   with `recordProgress`.
5. **Verify.** The worker reruns `testCommand` itself instead of trusting the agent.
6. **Diff.** `git add -A && git diff --cached`, so new files are included.
7. **Record** with `completeRun` (fenced), then always remove the sandbox and the checkout.

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

| Outcome     | When                                                                           |
| ----------- | ------------------------------------------------------------------------------ |
| `succeeded` | The agent called `finish` and the tests pass.                                  |
| `failed`    | `tests_failed`, or the agent stopped early (`max_steps`, `no_tool_call`, ...). |
| `error`     | `clone_failed`, `llm_<kind>` (e.g. `llm_rate_limit`, `llm_auth`), `internal`.  |

Failed runs keep the diff and the tail of the test output in `failure_detail`.

The janitor (`reapSandboxes`) runs on boot and every `JANITOR_INTERVAL_MS`. On SIGINT/SIGTERM
the worker stops taking jobs, lets active runs finish, then closes Redis and Postgres.

## Configuration

| Variable              | Default                  |
| --------------------- | ------------------------ |
| `DATABASE_URL`        | required (Neon, pooled)  |
| `REDIS_URL`           | `redis://localhost:6379` |
| `SANDBOX_IMAGE`       | `weft-sandbox:dev`       |
| `WORKER_ID`           | `<hostname>-<random>`    |
| `WORKER_CONCURRENCY`  | `1`                      |
| `ALLOW_FILE_REPOS`    | `false`                  |
| `JANITOR_INTERVAL_MS` | `60000`                  |
| `LLM_*`, API keys     | see `@weft/llm`          |

## Known limits (M2)

- **No dependency install.** The sandbox has no network and running `npm install` on the host
  would execute untrusted install scripts there, so only repos whose tests need no packages
  work for now. M2 adds a separate setup phase with network, before the agent runs offline.
- **Verification runs in the agent's sandbox.** M2 moves it to a fresh sandbox with the test
  files restored, so the agent can't game it.

## Testing

```bash
pnpm --filter @weft/worker test               # clone safety, no docker
pnpm --filter @weft/worker test:integration   # whole pipeline: PGlite, scripted LLM, real sandboxes
```

The integration tests drive real sandboxes against a local git copy of
`packages/agent/fixtures/add-bug`: a successful fix, failing tests, step budget, cancel before
start, cancel mid-run, cancel during a hanging model call and during a long tool command (both
must stop within seconds), takeover by another worker, clone failure, `file://` refusal, and
LLM failure, each checking that no sandbox is left behind.
