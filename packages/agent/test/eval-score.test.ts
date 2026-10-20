import { describe, expect, it } from 'vitest';
import type { EvalCase } from '../eval/cases.ts';
import { score, wrongLanguageSearches, type Observed } from '../eval/score.ts';
import type { AgentEvent } from '../src/index.ts';

const question: EvalCase = {
  name: 'q',
  kind: 'question',
  task: 'why?',
  expect: { edits: false, mentions: [/money\.js/], forbidden: /no changes were made/i },
};
const change: EvalCase = { name: 'c', kind: 'change', task: 'fix', expect: { edits: true } };

const ok: Observed = {
  status: 'finished',
  reply: 'It is in src/money.js',
  edited: false,
  testsPass: null,
  checkPass: null,
};

const tool = (name: string, args: Record<string, unknown>): AgentEvent => ({
  type: 'tool',
  step: 1,
  id: 'x',
  name,
  args,
  isError: false,
  durationMs: 1,
  output: '',
});

describe('score', () => {
  it('passes a question answered from the code without edits', () => {
    expect(score(question, ok)).toEqual([]);
  });

  it('flags every way a question can go wrong', () => {
    expect(
      score(question, { ...ok, status: 'max_steps', edited: true, reply: 'No changes were made.' }),
    ).toEqual([
      'stopped: max_steps',
      'edited files',
      'reply lacks /money\\.js/',
      'reply says "No changes were made"',
    ]);
  });

  it('requires a change to edit and pass its checks', () => {
    expect(score(change, { ...ok, edited: true, testsPass: true, checkPass: true })).toEqual([]);
    expect(score(change, { ...ok, testsPass: false, checkPass: false })).toEqual([
      'made no change',
      'tests fail',
      'check fails',
    ]);
  });
});

describe('wrongLanguageSearches', () => {
  it('counts searches aimed at other languages', () => {
    const events = [
      tool('grep', { pattern: 'parse', glob: '*.py' }),
      tool('glob', { pattern: '**/*.go' }),
      tool('grep', { pattern: 'parse', glob: '*.js' }),
      tool('view_file', { path: 'setup.py' }),
    ];
    expect(wrongLanguageSearches(events)).toBe(2);
  });
});
