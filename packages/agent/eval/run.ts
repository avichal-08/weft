import { readFileSync } from 'node:fs';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createProvider, LLMError, loadLLMConfig, withRetry, type Message } from '@weft/llm';
import { createSandbox, type Sandbox } from '@weft/sandbox';
import { createToolContext, runAgent } from '../src/index.ts';
import { cases, type EvalCase, type Fixture } from './cases.ts';
import { costUsd } from './pricing.ts';
import { isPhantomEdit, score, wrongLanguageSearches } from './score.ts';

const { values } = parseArgs({
  options: {
    provider: { type: 'string' },
    model: { type: 'string' },
    only: { type: 'string' },
    repeat: { type: 'string', default: '1' },
    label: { type: 'string', default: 'run' },
    'max-steps': { type: 'string', default: '15' },
    resume: { type: 'boolean', default: false },
  },
});

const fixtures: Record<Fixture, string> = {
  shop: fileURLToPath(new URL('../fixtures/shop', import.meta.url)),
  playground: fileURLToPath(new URL('../fixtures/playground', import.meta.url)),
};
const resultsDir = fileURLToPath(new URL('./results', import.meta.url));
const root = '/workspace/repo';
const image = process.env.SANDBOX_IMAGE ?? 'weft-sandbox:dev';
const identity = ['-c', 'user.name=weft', '-c', 'user.email=weft@local'];

const config = loadLLMConfig({
  ...process.env,
  ...(values.provider ? { LLM_PROVIDER: values.provider } : {}),
  ...(values.model ? { LLM_MODEL: values.model } : {}),
});
const llm = withRetry(createProvider(config), {
  onRetry: ({ attempt, delayMs, error }) =>
    console.log(`    retry ${attempt} in ${(delayMs / 1000).toFixed(1)}s: ${error.kind}`),
});

const selected = cases((fixture, path) =>
  readFileSync(join(fixtures[fixture], path), 'utf8'),
).filter((c) => !values.only || c.name.includes(values.only));

const text = (t: string) => [{ type: 'text' as const, text: t }];
const historyOf = (c: EvalCase): Message[] =>
  (c.history ?? []).flatMap(([user, assistant]): Message[] => [
    { role: 'user', content: text(user) },
    { role: 'assistant', content: text(assistant) },
  ]);

const lines = (out: string) => out.split('\n').filter(Boolean);

async function write(sandbox: Sandbox, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    await sandbox.exec(['sh', '-c', 'mkdir -p "$(dirname "$1")" && cat > "$1"', 'sh', path], {
      cwd: root,
      stdin: content,
    });
  }
}

async function commit(sandbox: Sandbox, message: string) {
  await sandbox.exec(['git', 'add', '-A'], { cwd: root });
  await sandbox.exec(['git', ...identity, 'commit', '-qm', message, '--allow-empty'], {
    cwd: root,
  });
}

const DAILY_QUOTA = /per ?day|daily/i;

export type Result = {
  model?: string;
  label?: string;
  name: string;
  category: EvalCase['category'];
  round: number;
  problems: string[];
  llmError?: string;
  status?: string;
  edited?: boolean;
  phantomEdit?: boolean;
  testsTouched?: string[];
  missing?: string[];
  passToPass?: boolean | null;
  failToPass?: boolean | null;
  steps?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  costUsd?: number | null;
  seconds?: number;
  modelSeconds?: number;
  toolErrors?: number;
  wrongLanguage?: number;
  tools?: string[];
  reply?: string;
};

async function runCase(c: EvalCase, round: number): Promise<Result> {
  const sandbox = await createSandbox({ image, owner: 'eval' });
  try {
    await sandbox.putFiles(fixtures[c.fixture ?? 'shop'], root);
    await sandbox.exec(['git', 'init', '-q', '-b', 'main'], { cwd: root });
    await write(sandbox, c.seed ?? {});
    await commit(sandbox, 'base');
    await write(sandbox, c.prior ?? {});
    await commit(sandbox, 'prior');
    const existingTests = lines(
      (await sandbox.exec(['git', 'ls-files', '--', 'test'], { cwd: root })).stdout,
    );

    const started = performance.now();
    const res = await runAgent({
      llm,
      ctx: createToolContext({ sandbox, root, testCommand: null }),
      task: c.task,
      history: historyOf(c),
      maxSteps: Number(values['max-steps']),
    });
    const seconds = (performance.now() - started) / 1000;

    await sandbox.exec(['git', 'add', '-A'], { cwd: root });
    const changed = lines(
      (await sandbox.exec(['git', 'diff', '--cached', '--name-only'], { cwd: root })).stdout,
    );
    await sandbox.exec(['git', 'reset', '-q'], { cwd: root });
    const edited = changed.length > 0;
    const testsTouched = changed.filter((f) => existingTests.includes(f));
    const missing: string[] = [];
    for (const [path, re] of Object.entries(c.expect.files ?? {})) {
      const content = await sandbox.readFile(`${root}/${path}`).catch(() => '');
      if (!re.test(content)) missing.push(`${path} lacks /${re.source}/`);
    }

    const grade = c.expect.edits || edited;
    let passToPass: boolean | null = null;
    let failToPass: boolean | null = null;
    if (grade && existingTests.length > 0) {
      await sandbox.exec(['git', 'checkout', 'HEAD', '--', ...existingTests], { cwd: root });
      passToPass =
        (await sandbox.exec(['node', '--test', ...existingTests], { cwd: root })).exitCode === 0;
    }
    if (c.hidden) {
      await write(sandbox, c.hidden);
      failToPass =
        (await sandbox.exec(['node', '--test', ...Object.keys(c.hidden)], { cwd: root }))
          .exitCode === 0;
    }

    const observed = {
      status: res.status,
      reply: res.summary ?? '',
      edited,
      passToPass,
      failToPass,
      testsTouched,
      missing,
    };
    return {
      name: c.name,
      category: c.category,
      round,
      problems: score(c, observed),
      ...observed,
      phantomEdit: isPhantomEdit(c, observed),
      steps: res.steps,
      inputTokens: res.usage.inputTokens,
      outputTokens: res.usage.outputTokens,
      cacheReadTokens: res.usage.cacheReadTokens,
      costUsd: costUsd(llm.model, res.usage),
      seconds,
      modelSeconds:
        res.events.reduce((n, e) => n + (e.type === 'llm' ? (e.latencyMs ?? 0) : 0), 0) / 1000,
      toolErrors: res.events.filter((e) => e.type === 'tool' && e.isError).length,
      wrongLanguage: wrongLanguageSearches(res.events),
      tools: res.events.flatMap((e) => (e.type === 'tool' ? [e.name] : [])),
    };
  } catch (err) {
    if (!(err instanceof LLMError)) throw err;
    return { name: c.name, category: c.category, round, problems: [], llmError: err.message };
  } finally {
    await sandbox.destroy();
  }
}

await mkdir(resultsDir, { recursive: true });
const file = join(resultsDir, `${values.label}-${llm.model.replace(/\W+/g, '_')}.jsonl`);
const done = new Set<string>();
if (values.resume) {
  const previous = await readFile(file, 'utf8').catch(() => '');
  for (const line of lines(previous)) {
    const r = JSON.parse(line) as Result;
    if (!r.llmError) done.add(`${r.name}#${r.round}`);
  }
}

console.log(
  `weft eval | ${llm.provider}/${llm.model} | ${selected.length} cases x ${values.repeat} | ${file}` +
    (done.size ? ` | resuming, ${done.size} done` : '') +
    '\n',
);

let stopped = false;
for (let round = 1; round <= Number(values.repeat) && !stopped; round++) {
  for (const c of selected) {
    if (done.has(`${c.name}#${round}`)) continue;
    const r = await runCase(c, round);
    await appendFile(file, `${JSON.stringify({ model: llm.model, label: values.label, ...r })}\n`);
    const stats =
      r.steps === undefined
        ? ''
        : `${r.steps} steps, ${(((r.inputTokens ?? 0) + (r.outputTokens ?? 0)) / 1000).toFixed(1)}k tok, ${r.seconds!.toFixed(0)}s`;
    const mark = r.llmError ? '!' : r.problems.length === 0 ? '✓' : '✗';
    console.log(`${mark} ${`${c.name} #${round}`.padEnd(28)} ${stats}`);
    for (const p of r.problems) console.log(`    ${p}`);
    if (r.llmError) {
      console.log(`    llm error: ${r.llmError.slice(0, 200)}`);
      if (DAILY_QUOTA.test(r.llmError)) {
        console.log('\ndaily quota reached; run again with --resume to continue');
        stopped = true;
        break;
      }
    }
  }
}
console.log(`\nresults in ${file}; summarize with: pnpm --filter @weft/agent eval:report`);
