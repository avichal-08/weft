# @weft/db

Postgres schema and client for weft, with [Drizzle](https://orm.drizzle.team). The database is
hosted on Neon; tests run against an in-process Postgres (PGlite) instead.

```ts
import { createDb, runs } from '@weft/db';

const { db, pool } = createDb(); // DATABASE_URL
const [run] = await db
  .insert(runs)
  .values({ repoUrl, task: 'make the failing test pass', testCommand: 'npm test' })
  .returning();
await pool.end();
```

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
