import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { runs } from './schema.ts';
import type {
  CompleteRunInput,
  CreateRunInput,
  Db,
  ListRunsOptions,
  Run,
  RunUsage,
} from './types.ts';

const ACTIVE = ['queued', 'running'] as const;

export async function createRun(db: Db, input: CreateRunInput): Promise<Run> {
  const [run] = await db.insert(runs).values(input).returning();
  return run!;
}

export async function getRun(db: Db, id: string): Promise<Run | undefined> {
  const [run] = await db.select().from(runs).where(eq(runs.id, id));
  return run;
}

export async function listRuns(db: Db, opts: ListRunsOptions = {}): Promise<Run[]> {
  return db
    .select()
    .from(runs)
    .where(opts.status ? eq(runs.status, opts.status) : undefined)
    .orderBy(desc(runs.createdAt))
    .limit(Math.min(opts.limit ?? 50, 200));
}

export async function claimRun(db: Db, id: string, workerId: string): Promise<number | undefined> {
  const [row] = await db
    .update(runs)
    .set({
      status: 'running',
      attempt: sql`${runs.attempt} + 1`,
      workerId,
      startedAt: sql`now()`,
    })
    .where(and(eq(runs.id, id), inArray(runs.status, ACTIVE)))
    .returning({ attempt: runs.attempt });
  return row?.attempt;
}

const fenced = (id: string, attempt: number) =>
  and(eq(runs.id, id), eq(runs.attempt, attempt), eq(runs.status, 'running'));

export async function recordProgress(
  db: Db,
  id: string,
  attempt: number,
  usage: RunUsage,
): Promise<boolean> {
  const rows = await db
    .update(runs)
    .set(usage)
    .where(fenced(id, attempt))
    .returning({ id: runs.id });
  return rows.length === 1;
}

export async function completeRun(
  db: Db,
  id: string,
  attempt: number,
  input: CompleteRunInput,
): Promise<boolean> {
  const rows = await db
    .update(runs)
    .set({ ...input, finishedAt: sql`now()` })
    .where(fenced(id, attempt))
    .returning({ id: runs.id });
  return rows.length === 1;
}

export async function cancelRun(db: Db, id: string): Promise<boolean> {
  const rows = await db
    .update(runs)
    .set({ status: 'cancelled', finishedAt: sql`now()` })
    .where(and(eq(runs.id, id), inArray(runs.status, ACTIVE)))
    .returning({ id: runs.id });
  return rows.length === 1;
}
