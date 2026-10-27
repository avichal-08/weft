import { describe, expect, it } from 'vitest';
import type { EvalCase } from '../eval/cases.ts';
import { claimsChange, score, wrongLanguageSearches, type Observed } from '../eval/score.ts';
import type { AgentEvent } from '../src/index.ts';

const question: EvalCase = {
  name: 'q',
  category: 'question',
  task: 'why?',
  expect: { edits: false, mentions: [/money\.js/], forbidden: /no changes were made/i },
};
const change: EvalCase = { name: 'c', category: 'bugfix', task: 'fix', expect: { edits: true } };

const ok: Observed = {
  status: 'finished',
  reply: 'It is in src/money.js',
  edited: false,
  passToPass: null,
  failToPass: null,
  testsTouched: [],
  missing: [],
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

  it('requires a change to edit and pass the original and hidden tests', () => {
    expect(score(change, { ...ok, edited: true, passToPass: true, failToPass: true })).toEqual([]);
    expect(score(change, { ...ok, passToPass: false, failToPass: false })).toEqual([
      'made no change',
      'broke existing tests',
      'hidden tests fail',
    ]);
  });

  it('calls out a claimed change with no diff, and touched tests when they must stay', () => {
    expect(score(change, { ...ok, reply: 'I added a test for it.' })).toEqual([
      'claims a change it did not make',
    ]);
    const trap: EvalCase = {
      ...change,
      category: 'trap',
      expect: { edits: true, keepTests: true },
    };
    expect(score(trap, { ...ok, edited: true, testsTouched: ['test/a.test.js'] })).toEqual([
      'changed existing tests: test/a.test.js',
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

  it('lets a follow-up describe changes from an earlier turn', () => {
    const recall: EvalCase = {
      name: 'r',
      category: 'followup',
      task: 'What did you change last time?',
      expect: { edits: false },
    };
    expect(
      score(recall, { ...ok, reply: 'I modified src/discount.js and added FREESHIP.' }),
    ).toEqual([]);
  });

  it('counts a claim of doing the work, not a description of existing code', () => {
    for (const claim of [
      'Added `isBlank(text)` to src/strings.js.',
      "I've added a test for it.",
      'Done. Fixed the rounding in money.js.',
      '- Updated the export in src/index.js',
      'I modified two files.',
    ]) {
      expect(claimsChange(claim), claim).toBe(true);
    }
    for (const description of [
      'The truncate function already exists and seems to be implemented correctly.',
      'This value is updated whenever get() is called.',
      'It handles changed inputs the same way.',
    ]) {
      expect(claimsChange(description), description).toBe(false);
    }
  });
});
