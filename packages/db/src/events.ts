import { and, asc, eq, gt } from 'drizzle-orm';
import { runEvents } from './schema.ts';
import type { Db, ListRunEventsOptions, NewRunEvent, RunEvent } from './types.ts';

export async function appendRunEvents(
  db: Db,
  runId: string,
  attempt: number,
  events: NewRunEvent[],
): Promise<void> {
  if (events.length === 0) return;
  await db
    .insert(runEvents)
    .values(events.map((e) => ({ ...e, runId, attempt })))
    .onConflictDoNothing();
}

export async function listRunEvents(
  db: Db,
  runId: string,
  opts: ListRunEventsOptions,
): Promise<RunEvent[]> {
  return db
    .select()
    .from(runEvents)
    .where(
      and(
        eq(runEvents.runId, runId),
        eq(runEvents.attempt, opts.attempt),
        opts.afterSeq === undefined ? undefined : gt(runEvents.seq, opts.afterSeq),
      ),
    )
    .orderBy(asc(runEvents.seq))
    .limit(Math.min(opts.limit ?? 500, 1000));
}
