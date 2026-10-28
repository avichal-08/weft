import { listRuns, type Db } from '@weft/db';

type Job = { getState(): Promise<string>; remove(): Promise<void> };
export type JobLookup = { getJob(id: string): Promise<Job | undefined | null> };

const LIVE_STATES = new Set(['waiting', 'active', 'delayed', 'prioritized', 'waiting-children']);
const PAGE = 200;

export async function reconcileRuns(
  db: Db,
  queue: JobLookup,
  enqueue: (runId: string) => Promise<void>,
): Promise<string[]> {
  const active = [
    ...(await listRuns(db, { status: 'queued', limit: PAGE })),
    ...(await listRuns(db, { status: 'running', limit: PAGE })),
  ];
  const requeued: string[] = [];
  for (const run of active) {
    const job = await queue.getJob(run.id);
    if (job && LIVE_STATES.has(await job.getState())) continue;
    await job?.remove();
    await enqueue(run.id);
    requeued.push(run.id);
  }
  return requeued;
}
