# @weft/db

Postgres schema and client for weft, with [Drizzle](https://orm.drizzle.team). The database is
hosted on Neon; tests run against an in-process Postgres (PGlite) instead.

```ts
import { claimRun, completeRun, createDb, createRun } from '@weft/db';

const { db, pool } = createDb(); // DATABASE_URL
const run = await createRun(db, {
  repoUrl,
  task: 'make the failing test pass',
  testCommand: 'npm test',
});

const attempt = await claimRun(db, run.id, workerId); // undefined if already finished
// ... run the agent ...
const applied = await completeRun(db, run.id, attempt!, { status: 'succeeded', diff });
if (!applied) {
  // a newer attempt owns this run, or it was cancelled: discard this result
}
await pool.end();
```

## Queries

All access to `runs` goes through these functions (`src/runs.ts`):

| Function                                 | Effect                                                            |
| ---------------------------------------- | ----------------------------------------------------------------- |
| `createRun(db, input)`                   | Inserts a `queued` run.                                           |
| `getRun(db, id)`                         | One run, or `undefined`.                                          |
| `listRuns(db, { status, limit })`        | Newest first; limit defaults to 50, capped at 200.                |
| `claimRun(db, id, workerId)`             | `queued`/`running` → `running`, increments `attempt`, returns it. |
| `recordProgress(db, id, attempt, usage)` | Updates steps and tokens if the attempt is current.               |
| `completeRun(db, id, attempt, outcome)`  | Records `succeeded`/`failed`/`error` if the attempt is current.   |
| `cancelRun(db, id)`                      | `queued`/`running` → `cancelled`.                                 |

### Fencing

If a worker stalls (a GC pause, a network partition), the queue hands its job to another worker.
`claimRun` gives the new worker a higher `attempt`. Every later write is an `UPDATE ... WHERE id
AND attempt = $attempt AND status = 'running'`, so when the stalled worker wakes up its writes
match zero rows and return `false`, and it knows to stop. The same condition keeps a worker from
overwriting a run that was cancelled or already completed. Each check is a single atomic
`UPDATE`, so no locks are needed, and concurrent claims always get distinct attempts.

## Tables

**`runs`**: one row per agent run.

| Column group | Columns                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------ |
| Identity     | `id` (uuid), `status` (`run_status` enum, default `queued`), `attempt`, `worker_id`        |
| Input        | `repo_url`, `base_ref`, `task`, `test_command`, `config` (jsonb: provider, model, budgets) |
| Timing       | `created_at`, `started_at`, `finished_at`, `timings`                                       |
| Usage        | `steps`, `input_tokens`, `output_tokens`, `cache_read_tokens`                              |
| Outcome      | `summary`, `diff`, `failure_kind`, `failure_detail`                                        |

Indexed on `(status, created_at)` for "next queued runs" and on `created_at desc` for the
dashboard's run list. `timings` is how long each phase of the run took, as an ordered list of
`{ phase, ms }` (a list, not an object, because `jsonb` does not keep key order). `attempt` and `worker_id` are there for crash recovery: a re-delivered
run gets a new attempt, and updates will be fenced on it.

**`sessions`**: a chat with the agent about one repository: `title` (from the first message),
`repo_url`, `base_ref`, an optional `test_command`, `config`, and `updated_at` for ordering.
Each message is a run in that session (`runs.session_id`, `runs.turn` = 1, 2, 3, …), so turns
reuse the whole run pipeline. Deleting a session deletes its runs. Once the chat is published
to GitHub it also holds `branch`, `pushed_turn` (the last turn pushed), `pushed_sha` and
`publish_error` (why the last attempt failed, cleared by the next successful push),
`publish_state` (`queued`, `pushing`, `pushed`, `failed`) and the pull request's `pr_number` and
`pr_url`. `publishRefusal(turns)` is the one rule for whether a chat can be published, shared by
the API and the worker.

Each turn has a `mode`, `code` (default) or `ask` (read-only, see
[ADR 0008](../../docs/decisions/0008-ask-mode.md)). An Ask turn records the same cumulative diff
as the turn before it, and commits, pull requests and the publish rules judge `latestWork(turns)`,
the latest Code turn, so a question asked after a change neither blocks nor hides it. Only a turn
still running blocks publishing whatever its mode.

`runs.checks` holds the findings of `@weft/checks` for the turn's diff. Because diffs are
cumulative, the latest Code turn's findings cover the whole chat: `publishRefusal` refuses with
their messages while any of them is blocking
([ADR 0009](../../docs/decisions/0009-diff-checks.md)); warnings don't block.

Two indexes guard the conversation: `(session_id, turn)` is unique, and a partial unique index on
`session_id` where `status in ('queued', 'running')` allows at most one active turn per session.
The second one is what makes "don't accept a message while the agent is working" hold even for
messages sent at the same instant from two tabs: one insert wins, the other hits the index.
Verified on Neon with four simultaneous messages, five rounds: one accepted, three busy, every
time.

| Function                                                                           | Effect                                                                                   |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `createSession(db, { repoUrl, message, baseRef, testCommand, config })`            | Creates the session and its first turn in one transaction.                               |
| `addTurn(db, sessionId, message)`                                                  | Next turn, or `{ ok: false, reason: 'busy' }` while a turn is active (or `'not_found'`). |
| `getSession(db, id)`                                                               | The session with its turns in order.                                                     |
| `listSessions(db, limit)`                                                          | Most recently active first, with turn count and latest status.                           |
| `recordPush(db, id, { branch, pushedTurn, pushedSha })`                            | Saves what was pushed and clears `publish_error`.                                        |
| `recordPublishError(db, id, error)`                                                | Saves why publishing failed.                                                             |
| `setPublishState(db, id, state)`, `recordPullRequest(db, id, { prNumber, prUrl })` | Publish progress and the pull request it opened.                                         |

**`commits`**: commits the user made in a chat, in order: the `turn` whose changes they cover,
the `message`, and the `sha` once pushed (empty until then). Deleted with their session.
`getSession` returns them with the turns; `commitRefusal(session)` adds "nothing has changed since
the last commit" to the publish rules, and `lastCommittedDiff(session)` is the diff the last commit
covered.

**`run_events`**: the step-by-step trace of a run, one row per model call (`llm`) or tool call
(`tool`), keyed by `(run_id, attempt, seq)`. `data` holds the details as JSON (tokens, latency
and text for `llm`; name, args, error flag, duration and output for `tool`). Rows are deleted
with their run.

| Function                                                 | Effect                                                                                 |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `appendRunEvents(db, runId, attempt, events)`            | Inserts a batch; rows already stored are skipped, so a re-sent batch never duplicates. |
| `listRunEvents(db, runId, { attempt, afterSeq, limit })` | One attempt's events in order; `afterSeq` pages forward (limit 500, max 1000).         |

Events are not fenced: each row carries its `attempt`, and readers ask for the current one.

## Migrations

The schema in `src/schema.ts` is the source of truth. Migrations are plain SQL files in
`migrations/`, generated from it and committed:

```bash
pnpm db:generate --name <change>   # schema.ts → migrations/NNNN_<change>.sql (review it!)
pnpm db:migrate                    # apply pending migrations to Neon
```

`db:migrate` uses `DATABASE_URL_UNPOOLED`. Neon's pooler runs PgBouncer in transaction mode,
which doesn't suit a migration's session-level locks; the app itself uses the pooled
`DATABASE_URL`. Applied migrations are recorded in `drizzle.__drizzle_migrations`, so running it
again is a no-op.

## Testing

```bash
pnpm --filter @weft/db test
```

Tests apply the real migration files to [PGlite](https://pglite.dev), Postgres compiled to
WebAssembly running inside the test process: real SQL semantics (enums, constraints, jsonb),
no server, and the shared Neon database is never touched. Booting it takes several seconds, so
each test file shares one instance and truncates between tests.
