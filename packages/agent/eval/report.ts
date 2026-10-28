import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { cases, type Category, type EvalCase, type Fixture } from './cases.ts';
import { PRICES_SOURCE } from './pricing.ts';
import type { Result } from './run.ts';
import { isPhantomEdit, rewrittenTestLines, score } from './score.ts';

const CATEGORIES: Category[] = ['question', 'bugfix', 'feature', 'followup', 'trap'];

export type Summary = {
  key: string;
  runs: number;
  passed: number;
  llmErrors: number;
  rounds: number;
  byCategory: Record<string, { runs: number; passed: number }>;
  cases: number;
  consistent: number;
  phantomEdits: number;
  testsTouched: number;
  testsRewritten: number | null;
  wrongLanguage: number | null;
  meanCost: number | null;
  totalCost: number | null;
  medianSeconds: number;
  meanSteps: number;
  meanTokens: number;
  perCase: Record<string, { runs: number; passed: number }>;
};

export function rescore(r: Result, byName: Map<string, EvalCase>): Result {
  const c = byName.get(r.name);
  if (!c || r.llmError || r.edited === undefined) return r;
  const observed = {
    status: r.status ?? '',
    reply: r.reply ?? '',
    edited: r.edited,
    passToPass: r.passToPass ?? null,
    failToPass: r.failToPass ?? null,
    testsTouched: r.testsTouched ?? [],
    missing: r.missing ?? [],
  };
  const testLinesRewritten =
    r.testDiff !== undefined
      ? rewrittenTestLines(r.testDiff)
      : observed.testsTouched.length === 0
        ? 0
        : undefined;
  return {
    ...r,
    problems: score(c, observed),
    phantomEdit: isPhantomEdit(c, observed),
    ...(testLinesRewritten === undefined ? {} : { testLinesRewritten }),
  };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function summarize(key: string, rows: Result[]): Summary {
  const scored = rows.filter((r) => !r.llmError);
  const pass = (r: Result) => r.problems.length === 0;
  const byCategory: Summary['byCategory'] = {};
  const perCase: Summary['perCase'] = {};
  for (const r of scored) {
    const cat = (byCategory[r.category] ??= { runs: 0, passed: 0 });
    const one = (perCase[r.name] ??= { runs: 0, passed: 0 });
    cat.runs++;
    one.runs++;
    if (pass(r)) {
      cat.passed++;
      one.passed++;
    }
  }
  const costs = scored.flatMap((r) => (typeof r.costUsd === 'number' ? [r.costUsd] : []));
  const priced = costs.length === scored.length && scored.length > 0;
  return {
    key,
    runs: scored.length,
    passed: scored.filter(pass).length,
    llmErrors: rows.length - scored.length,
    rounds: Math.max(0, ...rows.map((r) => r.round)),
    byCategory,
    cases: Object.keys(perCase).length,
    consistent: Object.values(perCase).filter((c) => c.passed === c.runs).length,
    phantomEdits: scored.filter((r) => r.phantomEdit).length,
    testsTouched: scored.filter((r) => (r.testsTouched ?? []).length > 0).length,
    testsRewritten: scored.every((r) => r.testLinesRewritten !== undefined)
      ? scored.filter((r) => r.testLinesRewritten! > 0).length
      : null,
    wrongLanguage: scored.every((r) => r.wrongLanguage !== undefined)
      ? scored.filter((r) => r.wrongLanguage! > 0).length
      : null,
    meanCost: priced ? mean(costs) : null,
    totalCost: priced ? costs.reduce((a, b) => a + b, 0) : null,
    medianSeconds: median(scored.map((r) => r.seconds ?? 0)),
    meanSteps: mean(scored.map((r) => r.steps ?? 0)),
    meanTokens: mean(scored.map((r) => (r.inputTokens ?? 0) + (r.outputTokens ?? 0))),
    perCase,
  };
}

const pct = (passed: number, runs: number) =>
  runs ? `${Math.round((passed / runs) * 100)}% (${passed}/${runs})` : '–';
const usd = (n: number | null) => (n === null ? 'n/a' : `$${n.toFixed(4)}`);

export function render(summaries: Summary[], generated: string): string {
  const head = ['', ...summaries.map((s) => `\`${s.key}\``)];
  const row = (label: string, cells: string[]) => `| ${[label, ...cells].join(' | ')} |`;
  const table = [
    row(head[0]!, head.slice(1)),
    row(
      '---',
      summaries.map(() => '---'),
    ),
    row(
      'Pass rate',
      summaries.map((s) => pct(s.passed, s.runs)),
    ),
    ...CATEGORIES.map((c) =>
      row(
        `  ${c}`,
        summaries.map((s) => pct(s.byCategory[c]?.passed ?? 0, s.byCategory[c]?.runs ?? 0)),
      ),
    ),
    row(
      'Cases passing every repeat',
      summaries.map((s) => `${s.consistent}/${s.cases}`),
    ),
    row(
      'Phantom edits',
      summaries.map((s) => String(s.phantomEdits)),
    ),
    row(
      'Runs that removed or rewrote existing test lines',
      summaries.map((s) => (s.testsRewritten === null ? 'n/a' : String(s.testsRewritten))),
    ),
    row(
      'Runs that edited existing test files (adding tests counts)',
      summaries.map((s) => String(s.testsTouched)),
    ),
    row(
      'Runs that searched other languages (`*.py` in a JS repo)',
      summaries.map((s) => (s.wrongLanguage === null ? 'n/a' : String(s.wrongLanguage))),
    ),
    row(
      'Cost per task (list price)',
      summaries.map((s) => usd(s.meanCost)),
    ),
    row(
      'Median time per task',
      summaries.map((s) => `${s.medianSeconds.toFixed(0)} s`),
    ),
    row(
      'Mean steps',
      summaries.map((s) => s.meanSteps.toFixed(1)),
    ),
    row(
      'Mean tokens',
      summaries.map((s) => `${(s.meanTokens / 1000).toFixed(1)}k`),
    ),
    row(
      'Runs / repeats',
      summaries.map((s) => `${s.runs} / ${s.rounds}`),
    ),
    row(
      'Provider errors (not scored)',
      summaries.map((s) => String(s.llmErrors)),
    ),
  ];
  const names = [...new Set(summaries.flatMap((s) => Object.keys(s.perCase)))].sort();
  const cases = [
    row(
      'Case',
      summaries.map((s) => `\`${s.key}\``),
    ),
    row(
      '---',
      summaries.map(() => '---'),
    ),
    ...names.map((n) =>
      row(
        `\`${n}\``,
        summaries.map((s) => (s.perCase[n] ? `${s.perCase[n].passed}/${s.perCase[n].runs}` : '–')),
      ),
    ),
  ];
  return `# weft agent eval

Generated ${generated}. Each column is one run of the eval (\`label-model\`); stored runs are
re-scored with the current graders, so a grading fix never needs a new model run. A task passes when
every check holds: the agent finished, it edited files only when it should, its reply mentions
what it must, the original tests still pass after any test edits are undone, and the hidden tests
the agent never saw pass. Cost is computed from recorded tokens at list price
(${PRICES_SOURCE}), whatever tier the runs used.

${table.join('\n')}

## Per case (passed / runs)

${cases.join('\n')}
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: { label: { type: 'string', multiple: true }, out: { type: 'string' } },
  });
  const dir = fileURLToPath(new URL('./results', import.meta.url));
  const fixtureDir = (f: Fixture) => fileURLToPath(new URL(`../fixtures/${f}`, import.meta.url));
  const byName = new Map(
    cases((f, path) => readFileSync(join(fixtureDir(f), path), 'utf8')).map((c) => [c.name, c]),
  );
  const groups = new Map<string, Result[]>();
  for (const name of (await readdir(dir)).filter((f) => f.endsWith('.jsonl')).sort()) {
    for (const line of (await readFile(join(dir, name), 'utf8')).split('\n').filter(Boolean)) {
      const r = rescore(JSON.parse(line) as Result, byName);
      if (values.label?.length && !values.label.includes(r.label ?? '')) continue;
      const key = `${r.label}-${r.model}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
  }
  const order = (key: string) => {
    const i = values.label?.findIndex((l) => key.startsWith(`${l}-`)) ?? -1;
    return i === -1 ? Infinity : i;
  };
  const summaries = [...groups]
    .sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
    .map(([key, rows]) => summarize(key, rows))
    .filter((s) => s.runs > 0);
  const out = values.out ?? fileURLToPath(new URL('./REPORT.md', import.meta.url));
  await writeFile(out, render(summaries, new Date().toISOString().slice(0, 10)));
  console.log(`wrote ${out} (${summaries.map((s) => s.key).join(', ') || 'no results'})`);
}
