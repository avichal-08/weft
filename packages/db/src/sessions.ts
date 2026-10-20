import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { runs, sessions } from './schema.ts';
import type {
  AddTurnResult,
  CreateSessionInput,
  Db,
  Run,
  Session,
  SessionSummary,
  SessionWithTurns,
} from './types.ts';

const TITLE_CHARS = 80;

export function titleFrom(message: string): string {
  const line = message.replace(/\s+/g, ' ').trim();
  return line.length > TITLE_CHARS ? `${line.slice(0, TITLE_CHARS - 1)}…` : line;
}

function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err; e; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: string }).code === '23505') return true;
  }
  return false;
}

const turnValues = (session: Session, message: string, turn: number) => ({
  sessionId: session.id,
  turn,
  repoUrl: session.repoUrl,
  baseRef: session.baseRef,
  testCommand: session.testCommand,
  config: session.config,
  task: message,
});

export async function createSession(
  db: Db,
  input: CreateSessionInput,
): Promise<{ session: Session; run: Run }> {
  return db.transaction(async (tx) => {
    const [session] = await tx
      .insert(sessions)
      .values({
        title: titleFrom(input.message),
        repoUrl: input.repoUrl,
        baseRef: input.baseRef ?? null,
        testCommand: input.testCommand ?? null,
        config: input.config ?? {},
      })
      .returning();
    const [run] = await tx
      .insert(runs)
      .values(turnValues(session!, input.message, 1))
      .returning();
    return { session: session!, run: run! };
  });
}

export async function addTurn(db: Db, sessionId: string, message: string): Promise<AddTurnResult> {
  try {
    return await db.transaction(async (tx) => {
      const [session] = await tx.select().from(sessions).where(eq(sessions.id, sessionId));
      if (!session) return { ok: false, reason: 'not_found' } as const;

      const [last] = await tx
        .select({ turn: runs.turn })
        .from(runs)
        .where(eq(runs.sessionId, sessionId))
        .orderBy(desc(runs.turn))
        .limit(1);

      const [run] = await tx
        .insert(runs)
        .values(turnValues(session, message, (last?.turn ?? 0) + 1))
        .returning();
      await tx
        .update(sessions)
        .set({ updatedAt: sql`now()` })
        .where(eq(sessions.id, sessionId));
      return { ok: true, run: run! } as const;
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, reason: 'busy' };
    throw err;
  }
}

export async function getSession(db: Db, id: string): Promise<SessionWithTurns | undefined> {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, id));
  if (!session) return undefined;
  const turns = await db.select().from(runs).where(eq(runs.sessionId, id)).orderBy(asc(runs.turn));
  return { ...session, turns };
}

export async function listSessions(db: Db, limit = 50): Promise<SessionSummary[]> {
  const list = await db
    .select()
    .from(sessions)
    .orderBy(desc(sessions.updatedAt))
    .limit(Math.min(limit, 200));
  if (list.length === 0) return [];

  const turns = await db
    .select({ sessionId: runs.sessionId, turn: runs.turn, status: runs.status })
    .from(runs)
    .where(
      inArray(
        runs.sessionId,
        list.map((s) => s.id),
      ),
    )
    .orderBy(asc(runs.turn));

  const latest = new Map<string, { turns: number; status: Run['status'] }>();
  for (const t of turns) {
    latest.set(t.sessionId!, { turns: t.turn ?? 0, status: t.status });
  }
  return list.map((s) => ({
    ...s,
    turns: latest.get(s.id)?.turns ?? 0,
    lastStatus: latest.get(s.id)?.status ?? null,
  }));
}
