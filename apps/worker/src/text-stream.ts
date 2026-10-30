import type { TextEvent } from '@weft/llm';

export const TEXT_FLUSH_MS = 50;

export type TextChunk = { step: number; offset: number; text: string };

type Timers = {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function textStream(publish: (chunk: TextChunk) => void, timers: Timers = realTimers) {
  const steps = new Map<number, { full: string; sent: number }>();
  let timer: unknown;

  const flush = (step?: number) => {
    for (const [s, state] of steps) {
      if (step !== undefined && s !== step) continue;
      if (state.sent >= state.full.length) continue;
      publish({ step: s, offset: state.sent, text: state.full.slice(state.sent) });
      state.sent = state.full.length;
    }
  };
  const flushAll = () => {
    timer = undefined;
    flush();
  };

  return {
    push: (step: number, event: TextEvent) => {
      const state = steps.get(step) ?? { full: '', sent: 0 };
      steps.set(step, state);
      if (event.type === 'reset') {
        state.full = '';
        state.sent = 0;
        publish({ step, offset: 0, text: '' });
        return;
      }
      state.full += event.text;
      timer ??= timers.set(flushAll, TEXT_FLUSH_MS);
    },
    flush: (step: number) => {
      flush(step);
    },
    close: () => {
      if (timer !== undefined) timers.clear(timer);
      timer = undefined;
      flush();
    },
  };
}
