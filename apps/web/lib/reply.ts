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
