import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { commits, runs, sessions } from './schema.ts';
import type {
  AddTurnResult,
  Commit,
  CreateSessionInput,
  Db,
  PublishState,
  Run,
  RunMode,
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

const turnValues = (session: Session, message: string, turn: number, mode: RunMode) => ({
  sessionId: session.id,
  turn,
  repoUrl: session.repoUrl,
  baseRef: session.baseRef,
  testCommand: session.testCommand,
  config: session.config,
  task: message,
  mode,
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
      .values(turnValues(session!, input.message, 1, input.mode ?? 'code'))
      .returning();
    return { session: session!, run: run! };
  });
}

export async function addTurn(
  db: Db,
  sessionId: string,
  message: string,
  mode: RunMode = 'code',
): Promise<AddTurnResult> {
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
        .values(turnValues(session, message, (last?.turn ?? 0) + 1, mode))
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
  const made = await db
    .select()
    .from(commits)
    .where(eq(commits.sessionId, id))
    .orderBy(asc(commits.createdAt));
  return { ...session, turns, commits: made };
}

export async function createCommit(
  db: Db,
  commit: { sessionId: string; turn: number; message: string },
): Promise<Commit> {
  const [row] = await db.insert(commits).values(commit).returning();
  return row!;
}

export async function recordCommitSha(db: Db, id: string, sha: string): Promise<void> {
  await db.update(commits).set({ sha }).where(eq(commits.id, id));
}

export function latestWork(turns: Run[]): Run | undefined {
  return turns.filter((t) => t.mode !== 'ask').at(-1);
}

export function lastCommittedDiff(session: SessionWithTurns): string {
  const last = session.commits.at(-1);
  return last ? (session.turns.find((t) => t.turn === last.turn)?.diff ?? '') : '';
}

export function commitRefusal(session: SessionWithTurns): string | null {
  const why = publishRefusal(session.turns);
  if (why) return why;
  if (latestWork(session.turns)!.diff === lastCommittedDiff(session)) {
    return 'nothing has changed since the last commit';
  }
  return null;
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

export async function recordPush(
  db: Db,
  id: string,
  push: { branch: string; pushedTurn: number; pushedSha: string },
): Promise<void> {
  await db
    .update(sessions)
    .set({ ...push, publishError: null })
    .where(eq(sessions.id, id));
}

export async function recordPublishError(db: Db, id: string, error: string): Promise<void> {
  await db
    .update(sessions)
    .set({ publishError: error, publishState: 'failed' })
    .where(eq(sessions.id, id));
}

export async function setPublishState(db: Db, id: string, state: PublishState): Promise<void> {
  await db.update(sessions).set({ publishState: state }).where(eq(sessions.id, id));
}

export async function recordPullRequest(
  db: Db,
  id: string,
  pr: { prNumber: number; prUrl: string },
): Promise<void> {
  await db.update(sessions).set(pr).where(eq(sessions.id, id));
}

export function publishRefusal(turns: Run[]): string | null {
  const latest = turns.at(-1);
  if (!latest) return 'the chat has no turns yet';
  if (latest.status === 'queued' || latest.status === 'running') {
    return 'the agent is still working on the latest message';
  }
  const work = latestWork(turns);
  if (!work) return 'nothing in this chat has changed any files yet';
  if (work.status === 'failed' && work.failureKind === 'tests_failed') {
    return "the latest turn's tests fail, so there is nothing to publish yet";
  }
  if (work.status !== 'succeeded') return "the latest turn didn't finish";
  if (!turns.some((t) => t.status === 'succeeded' && t.diff)) {
    return 'nothing in this chat has changed any files yet';
  }
  return null;
}

export type Refusal = { error: 'not_publishable' | 'uncommitted'; message: string };

export function pullRequestRefusal(session: SessionWithTurns): Refusal | null {
  const why = publishRefusal(session.turns);
  if (why) return { error: 'not_publishable', message: why };
  if (
    session.commits.length === 0 ||
    latestWork(session.turns)!.diff !== lastCommittedDiff(session)
  ) {
    return { error: 'uncommitted', message: 'commit your changes before opening a pull request' };
  }
  return null;
}
