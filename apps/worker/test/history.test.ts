import type { Run } from '@weft/db';
import { describe, expect, it } from 'vitest';
import { buildHistory, latestDiff, replyOf } from '../src/history.ts';

const turn = (over: Partial<Run>): Run =>
  ({
    turn: 1,
    task: 'question',
    status: 'succeeded',
    summary: null,
    diff: null,
    failureKind: null,
    ...over,
  }) as Run;

describe('replyOf', () => {
  it('uses the agent reply, or says why there was none', () => {
    expect(replyOf(turn({ summary: 'It adds numbers.' }))).toBe('It adds numbers.');
    expect(replyOf(turn({ status: 'cancelled' }))).toBe(
      '(this turn ended without a reply: cancelled)',
    );
    expect(replyOf(turn({ status: 'error', failureKind: 'llm_rate_limit' }))).toBe(
      '(this turn ended without a reply: llm_rate_limit)',
    );
  });
});

describe('buildHistory', () => {
  it('alternates user messages and agent replies in turn order', () => {
    expect(
      buildHistory([
        turn({ task: 'What does add do?', summary: 'It subtracts, which is a bug.' }),
        turn({ turn: 2, task: 'Fix it', summary: 'Fixed in src/math.js.' }),
      ]),
    ).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'What does add do?' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'It subtracts, which is a bug.' }] },
      { role: 'user', content: [{ type: 'text', text: 'Fix it' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Fixed in src/math.js.' }] },
    ]);
  });

  it('is empty for the first turn', () => {
    expect(buildHistory([])).toEqual([]);
  });
});

describe('latestDiff', () => {
  it('takes the most recent recorded diff, skipping turns that recorded none', () => {
    expect(
      latestDiff([
        turn({ diff: 'diff A' }),
        turn({ diff: 'diff AB' }),
        turn({ status: 'error', diff: null }),
      ]),
    ).toBe('diff AB');
  });

  it('keeps an empty diff from a question turn', () => {
    expect(latestDiff([turn({ diff: 'diff A' }), turn({ diff: '' })])).toBe('');
  });

  it('is null when nothing was ever changed', () => {
    expect(latestDiff([turn({ status: 'cancelled' })])).toBeNull();
  });
});
