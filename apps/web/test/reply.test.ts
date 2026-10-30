import { describe, expect, it } from 'vitest';
import { applyText, replyFrom, streamingReply } from '../lib/reply';
import type { RunEvent } from '../lib/types';

const tool = (name: string, args: Record<string, unknown> = {}): RunEvent => ({
  seq: 1,
  step: 1,
  type: 'tool',
  data: { name, args, isError: false, durationMs: 1, output: '' },
  createdAt: '',
});
const llm = (text: string, stopReason = 'end', step = 1): RunEvent => ({
  seq: 1,
  step,
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

describe('applyText', () => {
  it('places each chunk at its offset, so replays overwrite instead of appending', () => {
    let texts = applyText({}, { step: 2, offset: 0, text: 'It ' });
    texts = applyText(texts, { step: 2, offset: 3, text: 'adds.' });
    texts = applyText(texts, { step: 2, offset: 3, text: 'adds.' });
    expect(texts).toEqual({ 2: 'It adds.' });
    expect(applyText(texts, { step: 2, offset: 0, text: '' })).toEqual({ 2: '' });
  });
});

describe('streamingReply', () => {
  it("shows the latest step's text while it streams or once it ends without tools", () => {
    expect(streamingReply([], { 1: 'It ad' })).toBe('It ad');
    expect(streamingReply([llm('It adds.', 'end', 2)], { 1: 'Looking.', 2: 'It adds.' })).toBe(
      'It adds.',
    );
  });

  it('hides text that turned out to be a note before tool calls, and empty text', () => {
    expect(streamingReply([llm('Looking.', 'tool_use', 1)], { 1: 'Looking.' })).toBeNull();
    expect(streamingReply([], { 1: '  ' })).toBeNull();
    expect(streamingReply([], {})).toBeNull();
  });
});
