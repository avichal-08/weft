import type { Db } from '@weft/db';

export type AppDeps = {
  db: Db;
  enqueue: (runId: string) => Promise<void>;
  ready: () => Promise<Record<string, boolean>>;
};
