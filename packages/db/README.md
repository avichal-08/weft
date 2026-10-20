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
| Timing       | `created_at`, `started_at`, `finished_at`                                                  |
| Usage        | `steps`, `input_tokens`, `output_tokens`, `cache_read_tokens`                              |
| Outcome      | `summary`, `diff`, `failure_kind`, `failure_detail`                                        |

Indexed on `(status, created_at)` for "next queued runs" and on `created_at desc` for the
dashboard's run list. `attempt` and `worker_id` are there for crash recovery: a re-delivered
run gets a new attempt, and updates will be fenced on it.

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
