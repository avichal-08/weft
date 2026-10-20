import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR } from '../src/migrate.ts';
import { runs } from '../src/schema.ts';
import { reset, testDb, type TestDb } from '../src/testing.ts';

let db: TestDb;

const pgError = (promise: Promise<unknown>) =>
  promise.then(
    () => '',
    (err: Error) => (err.cause instanceof Error ? err.cause.message : err.message),
  );

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await reset(db);
});

const newRun = {
  repoUrl: 'https://github.com/avichal-08/weft-fixture',
  task: 'make the failing test pass',
  testCommand: 'npm test',
};

describe('runs table', () => {
  it('fills in defaults for a new run', async () => {
    const [run] = await db.insert(runs).values(newRun).returning();
    expect(run).toMatchObject({
      status: 'queued',
      attempt: 0,
      steps: 0,
      inputTokens: 0,
      config: {},
      workerId: null,
      startedAt: null,
    });
    expect(run!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(run!.createdAt).toBeInstanceOf(Date);
  });

  it('round-trips the config as json', async () => {
    const config = { provider: 'gemini', model: 'gemini-3.5-flash', maxSteps: 30 };
    const [inserted] = await db
      .insert(runs)
      .values({ ...newRun, config })
      .returning();
    const run = await db.query.runs.findFirst({ where: eq(runs.id, inserted!.id) });
    expect(run?.config).toEqual(config);
  });

  it('rejects unknown statuses at the database level', async () => {
    const message = await pgError(
      db.execute(
        sql`insert into runs (repo_url, task, test_command, status) values ('r', 't', 'c', 'bogus')`,
      ),
    );
    expect(message).toMatch(/invalid input value for enum run_status/);
  });

  it('requires the task fields', async () => {
    const message = await pgError(
      db.execute(sql`insert into runs (repo_url, test_command) values ('r', 'c')`),
    );
    expect(message).toMatch(/null value in column "task"/);
  });

  it('can be migrated twice without changes', async () => {
    await expect(migrate(db, { migrationsFolder: MIGRATIONS_DIR })).resolves.toBeUndefined();
  });
});
