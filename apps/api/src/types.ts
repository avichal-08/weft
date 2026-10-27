import type { Db } from '@weft/db';
import type { LiveEntry, PublishJobData } from '@weft/queue';

export type LiveReader = {
  read: (runId: string, after: string, blockMs: number) => Promise<LiveEntry[]>;
  close: () => void;
};

export type AppDeps = {
  db: Db;
  enqueue: (runId: string) => Promise<void>;
  enqueuePublish: (job: PublishJobData) => Promise<void>;
  ready: () => Promise<Record<string, boolean>>;
  live: () => LiveReader;
  liveBlockMs?: number;
};
