import type { AgentEvent } from '@weft/agent';
import type { LLMError } from '@weft/llm';
import type { RunOutcome } from './types.ts';

export const shortId = (runId: string) => runId.slice(0, 8);

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function describeEvent(event: AgentEvent): string {
  if (event.type === 'llm') {
    const { inputTokens, outputTokens } = event.usage;
    return `#${event.step} llm ${secs(event.latencyMs)} in=${inputTokens} out=${outputTokens}`;
  }
  return `   ${event.isError ? '✗' : '✓'} ${event.name} ${event.durationMs}ms`;
}

export function describeRetry(attempt: number, delayMs: number, error: LLMError): string {
  const status = error.status ? ` (${error.status})` : '';
  return `llm retry ${attempt} in ${secs(delayMs)}: ${error.kind}${status}`;
}

export function describeOutcome(outcome: RunOutcome): string {
  switch (outcome.kind) {
    case 'skipped':
      return 'skipped: already finished or cancelled';
    case 'fenced':
      return 'stopped: cancelled or taken over';
    case 'completed':
      return outcome.recorded
        ? outcome.status
        : `${outcome.status}, not recorded: cancelled or taken over`;
  }
}
