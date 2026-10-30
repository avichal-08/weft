import type { RunEvent } from './types';

const TRACE_ARG_LIMIT = 2000;

export function replyFrom(events: RunEvent[]): string | null {
  const last = events.at(-1);
  if (last?.type === 'tool' && last.data.name === 'finish') {
    const summary = last.data.args?.summary;
    return typeof summary === 'string' && summary.length < TRACE_ARG_LIMIT ? summary : null;
  }
  if (last?.type === 'llm' && last.data.stopReason !== 'tool_use')
    return last.data.text?.trim() || null;
  return null;
}

export type StepTexts = Record<number, string>;
export type TextChunk = { step: number; offset: number; text: string };

export function applyText(texts: StepTexts, chunk: TextChunk): StepTexts {
  const current = texts[chunk.step] ?? '';
  return { ...texts, [chunk.step]: current.slice(0, chunk.offset) + chunk.text };
}

export function streamingReply(events: RunEvent[], texts: StepTexts): string | null {
  const step = Math.max(-1, ...Object.keys(texts).map(Number));
  const text = texts[step]?.trim();
  if (!text) return null;
  const done = events.find((e) => e.type === 'llm' && e.step === step);
  if (done?.type === 'llm' && done.data.stopReason === 'tool_use') return null;
  return text;
}
