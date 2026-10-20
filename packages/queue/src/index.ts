import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

export const RUNS_QUEUE = 'runs';

export type RunJobData = { runId: string };

export function createRedis(url = process.env.REDIS_URL ?? 'redis://localhost:6379') {
  return new Redis(url, { maxRetriesPerRequest: null });
}

export function createRunsQueue(connection: Redis) {
  return new Queue<RunJobData>(RUNS_QUEUE, { connection });
}

export async function enqueueRun(queue: Queue<RunJobData>, runId: string): Promise<void> {
  await queue.add(
    'run',
    { runId },
    { jobId: runId, removeOnComplete: { count: 1000 }, removeOnFail: { count: 5000 } },
  );
}
