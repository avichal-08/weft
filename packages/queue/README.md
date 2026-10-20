# @weft/queue

The contract between the API and the workers: one BullMQ queue, `runs`, whose jobs carry only
a run id. Everything else about a run lives in Postgres.

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
