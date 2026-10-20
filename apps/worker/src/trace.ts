import type { AgentEvent } from '@weft/agent';
import type { NewRunEvent } from '@weft/db';

export const MAX_ARG_CHARS = 2000;

export function capArgs(value: unknown, max = MAX_ARG_CHARS): unknown {
  if (typeof value === 'string') {
    return value.length > max
      ? `${value.slice(0, max)}… [${value.length - max} more characters]`
      : value;
  }
  if (Array.isArray(value)) return value.map((v) => capArgs(v, max));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, capArgs(v, max)]));
  }
  return value;
}

export function toRunEvent(event: AgentEvent, seq: number): NewRunEvent {
  if (event.type === 'llm') {
    return {
      seq,
      type: 'llm',
      step: event.step,
      data: {
        stopReason: event.stopReason,
        usage: event.usage,
        latencyMs: event.latencyMs,
        text: event.text,
      },
    };
  }
  return {
    seq,
    type: 'tool',
    step: event.step,
    data: {
      id: event.id,
      name: event.name,
      args: capArgs(event.args),
      isError: event.isError,
      durationMs: event.durationMs,
      output: event.output,
    },
  };
}
