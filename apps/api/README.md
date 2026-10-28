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

| Route                              | Response                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /runs`                       | `201 { run }` with `Location`; `400` invalid body; `503` queue unavailable                                                                                                                                                                                                                                                                           |
| `GET /runs`                        | `{ runs }`, newest first. `?status=queued` and `?limit=1..200`                                                                                                                                                                                                                                                                                       |
| `GET /runs/:id`                    | `{ run }`; `404` unknown; `400` not a uuid                                                                                                                                                                                                                                                                                                           |
| `GET /runs/:id/events`             | `{ attempt, status, events }`: the run's step trace, current attempt by default; `?afterSeq=` returns only newer events; `?attempt=`, `?limit=`                                                                                                                                                                                                      |
| `GET /runs/:id/stream`             | Server-sent events: the run's progress live, then `end`. See [Live stream](#live-stream)                                                                                                                                                                                                                                                             |
| `POST /runs/:id/cancel`            | `{ run }` now `cancelled`; `409` if it had already finished                                                                                                                                                                                                                                                                                          |
| `POST /sessions`                   | `201 { session, run }`: a chat about a repo, with its first message as turn 1 (enqueued). Body: `repoUrl`, `message`, optional `mode` (`code` or `ask`), `baseRef`, `testCommand`, `config`                                                                                                                                                          |
| `POST /sessions/:id/messages`      | `201 { run }`: the next turn, body `{ message, mode? }` (`code` by default, `ask` for a read-only turn); `409 busy` while the previous one is still queued or running; `404` unknown session                                                                                                                                                         |
| `POST /sessions/:id/publish`       | `202 { session }`: queues a push of the chat to its branch and opening a pull request (`publish_state` becomes `queued`); `409 not_publishable` with the reason when the latest turn is still running, didn't finish, or its tests fail, or its diff has a blocking check (a secret, a workflow file), or nothing changed yet; `404` unknown session |
| `POST /sessions/:id/commits/draft` | `200 { message }`: a suggested commit message for what changed since the last commit, written by the chat's model from the changed files and the messages sent since (falls back to `Update <files>`); `409 nothing_to_commit` with the reason; `404`                                                                                                |
| `POST /sessions/:id/commits`       | `201 { commit }`: saves a commit `{ message }` (the draft, edited or not) covering the latest turn; it stays in weft until the chat is published, and once the chat has a pull request it is pushed right away; `409 nothing_to_commit`, `400` empty message, `404`                                                                                  |
| `GET /sessions`                    | `{ sessions }`: most recently active first, each with `turns` and `lastStatus`; `?limit=`                                                                                                                                                                                                                                                            |
| `GET /sessions/:id`                | `{ session }` with its `turns` in order                                                                                                                                                                                                                                                                                                              |
| `GET /healthz`                     | `200` while the process is up                                                                                                                                                                                                                                                                                                                        |
| `GET /readyz`                      | `{ db, redis }`; `503` if either check fails                                                                                                                                                                                                                                                                                                         |

Errors are JSON: `{ error: 'invalid_request', issues: [{ path, message }] }`,
`{ error: 'invalid_json' }`, `{ error: 'not_found' }`, `{ error: 'internal' }`.

`POST /runs` body: `repoUrl` (https or file URL), `task`, `testCommand`, optional `baseRef`,
optional `config` (`provider`, `model`, `maxSteps` 1–100). Unknown fields are rejected.

A turn is a run, so a turn's trace and cancellation use `GET /runs/:id/events` and
`POST /runs/:id/cancel`. The `409 busy` comes from the database's one-active-turn index, so it
holds even for messages sent at the same moment.

## Live stream

`GET /runs/:id/stream` is a `text/event-stream` that a browser reads with `EventSource`:

```
event: phase
data: {"phase":"setup","detail":"pnpm install --frozen-lockfile"}

event: event
id: 1.0
data: {"seq":0,"type":"llm","step":1,"data":{...},"createdAt":"..."}

event: end
data: {"status":"succeeded"}
```

| Event     | Meaning                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------- |
| `phase`   | The run moved on: `clone`, `sandbox`, `restore`, `setup`, `agent`, `verify`.                      |
| `event`   | One model call or tool call, as in `GET /runs/:id/events`; `id` is `<attempt>.<seq>`.             |
| `attempt` | Another worker took the run over: drop the events you have, the new attempt follows.              |
| `end`     | The run is over and its result is in Postgres. Close the `EventSource` (it reconnects otherwise). |

- **Resumable.** Pass `?attempt=&after=` (the last `seq` you have, e.g. from a server render)
  to get only newer events. A reconnecting `EventSource` sends `Last-Event-ID`, which wins.
- **Redis first, Postgres as the truth.** A running run is replayed from its Redis stream from
  the start (so a page opened mid-run sees every phase) and then followed with a blocking read;
  events are deduplicated by `seq`. A finished run is replayed from `run_events`.
- **A heartbeat every 5 s** (`liveBlockMs`) when nothing happens: a `: ping` comment keeps
  proxies from closing the connection, the run is re-read, events missing from Redis are
  backfilled from Postgres, and a run that ended without an `end` message (cancelled, or a
  crashed worker) ends the stream.
- **One Redis connection per viewer**, because `XREAD BLOCK` holds its connection while it
  waits. It is closed as soon as the client goes away. Fine at this scale; a single reader
  fanning out to all viewers of a run is the next step if it isn't.

## Design notes

- **Dependencies are injected.** `createApp({ db, enqueue, ready, live })` builds nothing
  itself; `server.ts` wires Neon and Redis, tests wire PGlite, a fake queue and an in-memory
  live stream (`test/fake-live.ts`).
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
database and an in-memory fake queue. `test/stream.test.ts` reads the SSE endpoint like a
browser would: replay, resume, live delivery, takeover, cancel, Postgres fallback and cleanup.
