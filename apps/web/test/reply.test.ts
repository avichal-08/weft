import { describe, expect, it } from 'vitest';
import { replyFrom } from '../lib/reply';
import type { RunEvent } from '../lib/types';

const tool = (name: string, args: Record<string, unknown> = {}): RunEvent => ({
  seq: 1,
  step: 1,
  type: 'tool',
  data: { name, args, isError: false, durationMs: 1, output: '' },
  createdAt: '',
});
const llm = (text: string, stopReason = 'end'): RunEvent => ({
  seq: 1,
  step: 1,
  type: 'llm',
  data: { text, stopReason },
  createdAt: '',
});

describe('replyFrom', () => {
  it('takes the reply from a closing finish call or a plain-text answer', () => {
    expect(replyFrom([tool('view_file'), tool('finish', { summary: 'It adds.' })])).toBe(
      'It adds.',
    );
    expect(replyFrom([tool('grep'), llm('  The answer.  ')])).toBe('The answer.');
  });

  it('gives nothing when the reply is missing, cut short in the trace, or not the last step', () => {
    expect(replyFrom([])).toBeNull();
    expect(replyFrom([tool('finish', { summary: 'x'.repeat(2000) })])).toBeNull();
    expect(replyFrom([llm('let me look', 'tool_use')])).toBeNull();
    expect(replyFrom([tool('finish', { summary: 'done' }), tool('grep')])).toBeNull();
  });
});
