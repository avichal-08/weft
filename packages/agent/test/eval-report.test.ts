import { describe, expect, it } from 'vitest';
import type { EvalCase } from '../eval/cases.ts';
import { render, rescore, summarize } from '../eval/report.ts';
import type { Result } from '../eval/run.ts';

const run = (over: Partial<Result>): Result => ({
  name: 'c',
  category: 'bugfix',
  round: 1,
  problems: [],
  steps: 4,
  inputTokens: 1000,
  outputTokens: 200,
  cacheReadTokens: 0,
  costUsd: 0.001,
  seconds: 10,
  ...over,
});

describe('summarize', () => {
  const rows = [
    run({ name: 'fix', round: 1 }),
    run({ name: 'fix', round: 2, problems: ['hidden tests fail'], seconds: 30, costUsd: 0.003 }),
    run({ name: 'ask', category: 'question', round: 1, seconds: 20 }),
    run({ name: 'ask', category: 'question', round: 2 }),
    run({
      name: 'trap',
      category: 'trap',
      round: 1,
      problems: ['claims a change it did not make'],
      phantomEdit: true,
    }),
    run({ name: 'trap', category: 'trap', round: 2, llmError: 'quota per day' }),
  ];
  const s = summarize('base-model', rows);

  it('counts passes overall, per category and per case, leaving provider errors out', () => {
    expect(s).toMatchObject({
      runs: 5,
      passed: 3,
      llmErrors: 1,
      rounds: 2,
      cases: 3,
      consistent: 1,
    });
    expect(s.byCategory).toEqual({
      bugfix: { runs: 2, passed: 1 },
      question: { runs: 2, passed: 2 },
      trap: { runs: 1, passed: 0 },
    });
    expect(s.phantomEdits).toBe(1);
  });

  it('reports cost per task, median time and mean steps', () => {
    expect(s.meanCost).toBeCloseTo(0.0014);
    expect(s.totalCost).toBeCloseTo(0.007);
    expect(s.medianSeconds).toBe(10);
    expect(s.meanSteps).toBe(4);
  });

  it('counts rewritten tests only when every run has a known count', () => {
    expect(s.testsRewritten).toBeNull();
    const counted = summarize('x', [
      run({ testLinesRewritten: 0 }),
      run({ testLinesRewritten: 3 }),
    ]);
    expect(counted.testsRewritten).toBe(1);
  });

  it('counts runs that searched other languages when every run recorded it', () => {
    expect(s.wrongLanguage).toBeNull();
    expect(
      summarize('x', [run({ wrongLanguage: 0 }), run({ wrongLanguage: 2 })]).wrongLanguage,
    ).toBe(1);
  });

  it('gives no cost when a model has no known price', () => {
    expect(summarize('x', [run({ costUsd: null })]).meanCost).toBeNull();
  });
});

describe('render', () => {
  it('puts each run side by side, with the per-case breakdown', () => {
    const md = render(
      [
        summarize('base-a', [run({ name: 'fix' })]),
        summarize('fix-a', [run({ name: 'fix', problems: ['x'] })]),
      ],
      '2026-10-28',
    );
    expect(md).toContain('| Pass rate | 100% (1/1) | 0% (0/1) |');
    expect(md).toContain('| `fix` | 1/1 | 0/1 |');
    expect(md).toContain('Generated 2026-10-28');
  });
});

describe('rescore', () => {
  it('grades stored runs again with the current rules', () => {
    const recall: EvalCase = {
      name: 'recall',
      category: 'followup',
      task: 't',
      expect: { edits: false },
    };
    const stored = run({
      name: 'recall',
      category: 'followup',
      problems: ['claims a change it did not make'],
      phantomEdit: true,
      status: 'finished',
      reply: 'I added FREESHIP last time.',
      edited: false,
    });
    expect(rescore(stored, new Map([['recall', recall]]))).toMatchObject({
      problems: [],
      phantomEdit: false,
    });
    expect(rescore({ ...stored, llmError: 'x' }, new Map([['recall', recall]])).problems).toEqual(
      stored.problems,
    );
  });
});
