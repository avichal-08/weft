# @weft/queue

The contract between the API and the workers, over Redis: one BullMQ queue, `runs`, whose jobs
carry only a run id, and a live stream per run that carries its progress as it happens.
Everything durable about a run lives in Postgres.

```ts
import { createRedis, createRunsQueue, enqueueRun } from '@weft/queue';

const redis = createRedis(); // REDIS_URL
const queue = createRunsQueue(redis);
await enqueueRun(queue, run.id);
```

| Export                   | What it is                                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `RUNS_QUEUE`             | `'runs'`, the queue name                                                                                                   |
| `RunJobData`             | `{ runId: string }`                                                                                                        |
| `createRedis(url?)`      | An ioredis connection with `maxRetriesPerRequest: null`, which BullMQ workers require                                      |
| `createRunsQueue(redis)` | A typed BullMQ `Queue<RunJobData>`                                                                                         |
| `enqueueRun(queue, id)`  | Adds a job with `jobId = runId`, so the same run is never queued twice; keeps the last 1000 completed and 5000 failed jobs |

Jobs stay small on purpose: Postgres is the source of truth for a run, and Redis only says
"this run needs a worker".

## Publish queue

`publish` carries `{ sessionId, turn, openPullRequest }` jobs from the API (the "Create PR"
button) and from the worker itself (a turn finished in a chat that already has a pull request).
The job id is `<session>-<turn>-<pr|push>`, so asking twice for the same turn queues one job.
Finished jobs are removed whether they succeeded or failed: BullMQ ignores a new job whose id
matches one it still keeps, which would make a retry after a failure silently do nothing. The
outcome lives on the session (`publish_state`, `publish_error`), not on the job.

## Live stream

While a run executes, the worker appends to a Redis Stream, `weft:live:<runId>`, so the chat can
show each step the moment it happens instead of polling the database.

```ts
await publishLive(redis, runId, { kind: 'phase', attempt, phase: 'setup', detail: 'npm ci' });
await publishLive(redis, runId, { kind: 'event', attempt, event }); // a run_events row
await publishLive(redis, runId, { kind: 'end', attempt });

const entries = await readLive(reader, runId, '0', 5000); // blocks up to 5 s for new entries
```

| Message | When                                                                                            |
| ------- | ----------------------------------------------------------------------------------------------- |
| `phase` | The run moves on: `clone`, `sandbox`, `restore`, `setup` (with the command), `agent`, `verify`. |
| `event` | Every model call and tool call, the same shape as a `run_events` row plus `createdAt`.          |
| `end`   | The result is in Postgres. Not sent by a worker that lost the run (cancelled, taken over).      |

- **Streams, not pub/sub.** Pub/sub drops messages nobody is listening for, so a reader that
  connects mid-run would miss the start. A stream keeps the whole run, so a reader replays it
  from `0` and then blocks for more, and each entry id is a cursor for resuming.
- **Ephemeral.** Capped at about 5000 entries; expires 24 h after the last write, or 1 h after
  `end`. Postgres stays the source of truth: phases are only in the stream, events are in both.
- **`attempt` on every message.** If another worker takes the run over, its messages carry the
  new attempt, so a reader can drop what the old attempt still sent.
- `readLive` uses `XREAD BLOCK`, which holds its connection while it waits, so give each reader
  its own connection (`redis.duplicate()`).

## Testing

```bash
docker compose -f infra/compose.yml up -d redis
pnpm --filter @weft/queue test:integration   # real Redis at REDIS_URL
```
