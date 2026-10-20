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
   with `recordProgress`. If that matches zero rows, the run was cancelled or another worker
   took it over, so the agent is aborted.
5. **Verify.** The worker reruns `testCommand` itself instead of trusting the agent.
6. **Diff.** `git add -A && git diff --cached`, so new files are included.
7. **Record** with `completeRun` (fenced), then always remove the sandbox and the checkout.

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
start, cancel mid-run, takeover by another worker, clone failure, `file://` refusal, and LLM
failure, each checking that no sandbox is left behind.
