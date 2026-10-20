import { getRun, type Db } from '@weft/db';

export const DEFAULT_WATCH_INTERVAL_MS = 2000;

export function watchRun(
  db: Db,
  runId: string,
  attempt: number,
  intervalMs: number,
  onLost: () => void,
): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const tick = async () => {
    try {
      const run = await getRun(db, runId);
      if (!run || run.status !== 'running' || run.attempt !== attempt) {
        onLost();
        return;
      }
    } catch {
      // a transient db error is not a reason to abandon the run
    }
    if (!stopped) timer = setTimeout(() => void tick(), intervalMs);
  };

  timer = setTimeout(() => void tick(), intervalMs);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
