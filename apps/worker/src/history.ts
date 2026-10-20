import type { Run } from '@weft/db';
import type { Message } from '@weft/llm';

const text = (t: string) => [{ type: 'text' as const, text: t }];

export function replyOf(turn: Run): string {
  if (turn.summary) return turn.summary;
  const why = turn.status === 'cancelled' ? 'cancelled' : (turn.failureKind ?? turn.status);
  return `(this turn ended without a reply: ${why})`;
}

export function buildHistory(previous: Run[]): Message[] {
  return previous.flatMap((turn): Message[] => [
    { role: 'user', content: text(turn.task) },
    { role: 'assistant', content: text(replyOf(turn)) },
  ]);
}

export function latestDiff(previous: Run[]): string | null {
  for (let i = previous.length - 1; i >= 0; i--) {
    const diff = previous[i]!.diff;
    if (diff !== null) return diff;
  }
  return null;
}
