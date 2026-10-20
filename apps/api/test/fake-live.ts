import type { LiveEntry, LiveMessage } from '@weft/queue';
import type { LiveReader } from '../src/types.ts';

const n = (id: string) => Number(id.split('-')[0]);

export function fakeLive() {
  const streams = new Map<string, LiveEntry[]>();
  const waiters = new Set<() => void>();
  let next = 0;
  let open = 0;
  const after = (runId: string, cursor: string) =>
    (streams.get(runId) ?? []).filter((e) => n(e.id) > n(cursor));

  return {
    get open() {
      return open;
    },
    publish(runId: string, message: LiveMessage) {
      streams.set(runId, [...(streams.get(runId) ?? []), { id: `${++next}-0`, message }]);
      for (const wake of waiters) wake();
    },
    reader(): LiveReader {
      open++;
      let closed = false;
      return {
        read: (runId, cursor, blockMs) =>
          new Promise((resolve) => {
            const ready = after(runId, cursor);
            if (ready.length > 0) return resolve(ready);
            const done = (entries: LiveEntry[]) => {
              clearTimeout(timer);
              waiters.delete(wake);
              resolve(entries);
            };
            const wake = () => {
              const entries = after(runId, cursor);
              if (entries.length > 0) done(entries);
            };
            const timer = setTimeout(() => done([]), blockMs);
            waiters.add(wake);
          }),
        close: () => {
          if (closed) return;
          closed = true;
          open--;
        },
      };
    },
  };
}
