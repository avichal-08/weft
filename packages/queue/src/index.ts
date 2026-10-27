import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

export const RUNS_QUEUE = 'runs';

export type RunJobData = { runId: string };

export const PUBLISH_QUEUE = 'publish';

export type PublishJobData = { sessionId: string; turn: number; openPullRequest: boolean };

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

export function createPublishQueue(connection: Redis) {
  return new Queue<PublishJobData>(PUBLISH_QUEUE, { connection });
}

export async function enqueuePublish(
  queue: Queue<PublishJobData>,
  data: PublishJobData,
): Promise<void> {
  await queue.add('publish', data, {
    jobId: `${data.sessionId}-${data.turn}-${data.openPullRequest ? 'pr' : 'push'}`,
    removeOnComplete: true,
    removeOnFail: true,
  });
}

export {
  LIVE_ENDED_TTL_SECONDS,
  LIVE_MAXLEN,
  LIVE_TTL_SECONDS,
  liveKey,
  publishLive,
  readLive,
  type LiveEntry,
  type LiveEvent,
  type LiveMessage,
  type LivePhase,
} from './live.ts';
