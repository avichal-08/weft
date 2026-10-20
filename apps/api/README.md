# @weft/api

HTTP API for creating and following agent runs. Express 5, validated with Zod, backed by
`@weft/db` (Neon) and `@weft/queue` (BullMQ on Redis).

```bash
pnpm --filter @weft/api dev     # http://localhost:3001, reloads on change
```

```bash
curl -X POST localhost:3001/runs -H 'content-type: application/json' -d '{
  "repoUrl": "https://github.com/you/repo",
  "task": "Make the failing test pass",
  "testCommand": "npm test",
  "config": { "provider": "gemini", "maxSteps": 30 }
}'
```

## Routes

| Route                         | Response                                                                                                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /runs`                  | `201 { run }` with `Location`; `400` invalid body; `503` queue unavailable                                                                                        |
| `GET /runs`                   | `{ runs }`, newest first. `?status=queued` and `?limit=1..200`                                                                                                    |
| `GET /runs/:id`               | `{ run }`; `404` unknown; `400` not a uuid                                                                                                                        |
| `GET /runs/:id/events`        | `{ attempt, status, events }`: the run's step trace, current attempt by default; `?afterSeq=` returns only newer events; `?attempt=`, `?limit=`                   |
| `POST /runs/:id/cancel`       | `{ run }` now `cancelled`; `409` if it had already finished                                                                                                       |
| `POST /sessions`              | `201 { session, run }`: a chat about a repo, with its first message as turn 1 (enqueued). Body: `repoUrl`, `message`, optional `baseRef`, `testCommand`, `config` |
| `POST /sessions/:id/messages` | `201 { run }`: the next turn; `409 busy` while the previous one is still queued or running; `404` unknown session                                                 |
| `GET /sessions`               | `{ sessions }`: most recently active first, each with `turns` and `lastStatus`; `?limit=`                                                                         |
| `GET /sessions/:id`           | `{ session }` with its `turns` in order                                                                                                                           |
| `GET /healthz`                | `200` while the process is up                                                                                                                                     |
| `GET /readyz`                 | `{ db, redis }`; `503` if either check fails                                                                                                                      |

Errors are JSON: `{ error: 'invalid_request', issues: [{ path, message }] }`,
`{ error: 'invalid_json' }`, `{ error: 'not_found' }`, `{ error: 'internal' }`.

`POST /runs` body: `repoUrl` (https or file URL), `task`, `testCommand`, optional `baseRef`,
optional `config` (`provider`, `model`, `maxSteps` 1–100). Unknown fields are rejected.

A turn is a run, so a turn's trace and cancellation use `GET /runs/:id/events` and
`POST /runs/:id/cancel`. The `409 busy` comes from the database's one-active-turn index, so it
holds even for messages sent at the same moment.

## Design notes

- **Dependencies are injected.** `createApp({ db, enqueue, ready })` builds nothing itself;
  `server.ts` wires Neon and Redis, tests wire PGlite and a fake queue.
- **Idempotent enqueue.** Jobs use the run id as BullMQ `jobId`, so enqueueing a run twice
  creates one job.
- **Cancel leaves the queued job alone.** A worker that picks it up gets nothing from `claimRun`
  (the run isn't active) and skips it; fencing covers it without touching Redis.
- **Known gap: the dual write.** The run row and the queue job are two separate writes. If
  Redis fails in between, the API answers `503` and the run stays `queued` with no job. A
  reconciler that re-enqueues such runs is planned (M3).
- **Graceful shutdown.** On SIGINT/SIGTERM it stops accepting requests, then closes the queue,
  Redis and the Postgres pool.

## Configuration

| Variable       | Default                  |
| -------------- | ------------------------ |
| `PORT`         | `3001`                   |
| `DATABASE_URL` | required (Neon, pooled)  |
| `REDIS_URL`    | `redis://localhost:6379` |

## Testing

```bash
pnpm --filter @weft/api test
```

Requests go to the real Express app on a random port, with `@weft/db/testing` (PGlite) as the
database and an in-memory fake queue.
