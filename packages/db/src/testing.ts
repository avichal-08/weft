import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { MIGRATIONS_DIR } from './migrate.ts';
import { schema } from './schema.ts';

export async function testDb() {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}

export type TestDb = Awaited<ReturnType<typeof testDb>>;

export const reset = (db: TestDb) => db.execute(sql`truncate table runs cascade`);
