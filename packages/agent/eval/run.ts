import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createProvider, LLMError, loadLLMConfig, withRetry, type Message } from '@weft/llm';
import { createSandbox, type Sandbox } from '@weft/sandbox';
import { createToolContext, runAgent } from '../src/index.ts';
import { cases, type EvalCase } from './cases.ts';
import { score, wrongLanguageSearches } from './score.ts';

const { values } = parseArgs({
  options: {
    provider: { type: 'string' },
    model: { type: 'string' },
    only: { type: 'string' },
    repeat: { type: 'string', default: '1' },
    label: { type: 'string', default: 'run' },
  },
});

const fixture = fileURLToPath(new URL('../fixtures/shop', import.meta.url));
const resultsDir = fileURLToPath(new URL('./results', import.meta.url));
const root = '/workspace/repo';
const image = process.env.SANDBOX_IMAGE ?? 'weft-sandbox:dev';

const config = loadLLMConfig({
  ...process.env,
  ...(values.provider ? { LLM_PROVIDER: values.provider } : {}),
  ...(values.model ? { LLM_MODEL: values.model } : {}),
});
const llm = withRetry(createProvider(config), {
  onRetry: ({ attempt, delayMs, error }) =>
    console.log(`    retry ${attempt} in ${(delayMs / 1000).toFixed(1)}s: ${error.kind}`),
});

const selected = cases((path) => readFileSync(join(fixture, path), 'utf8')).filter(
  (c) => !values.only || c.name.includes(values.only),
);

const text = (t: string) => [{ type: 'text' as const, text: t }];
const historyOf = (c: EvalCase): Message[] =>
  (c.history ?? []).flatMap(([user, assistant]): Message[] => [
    { role: 'user', content: text(user) },
    { role: 'assistant', content: text(assistant) },
  ]);

const snapshot = async (sandbox: Sandbox) =>
  (await sandbox.exec('git add -A && git diff --cached --binary && git reset -q', { cwd: root }))
    .stdout;

async function runCase(c: EvalCase) {
  const sandbox = await createSandbox({ image, owner: 'eval' });
  try {
    await sandbox.putFiles(fixture, root);
    await sandbox.exec(
      'git init -q -b main && git add -A && git -c user.name=weft -c user.email=weft@local commit -qm base',
      { cwd: root },
    );
    for (const [path, content] of Object.entries(c.prior ?? {})) {
      await sandbox.exec(['sh', '-c', 'cat > "$1"', 'sh', path], { cwd: root, stdin: content });
    }
    const before = await snapshot(sandbox);

    const started = performance.now();
    const res = await runAgent({
      llm,
      ctx: createToolContext({ sandbox, root, testCommand: null }),
      task: c.task,
      history: historyOf(c),
    });
    const seconds = (performance.now() - started) / 1000;

    const edited = (await snapshot(sandbox)) !== before;
    const testsPass =
      c.kind === 'change'
        ? (await sandbox.exec('node --test', { cwd: root })).exitCode === 0
        : null;
    const checkPass = c.expect.check
      ? (await sandbox.exec(['node', '--input-type=module', '-e', c.expect.check], { cwd: root }))
          .exitCode === 0
      : null;
    const observed = { status: res.status, reply: res.summary ?? '', edited, testsPass, checkPass };

    return {
      name: c.name,
      kind: c.kind,
      problems: score(c, observed),
      ...observed,
      steps: res.steps,
      tokens: res.usage.inputTokens + res.usage.outputTokens,
      seconds,
      wrongLanguage: wrongLanguageSearches(res.events),
      tools: res.events.flatMap((e) => (e.type === 'tool' ? [e.name] : [])),
    };
  } catch (err) {
    if (!(err instanceof LLMError)) throw err;
    return { name: c.name, kind: c.kind, problems: [`llm ${err.kind}`], llmError: true };
  } finally {
    await sandbox.destroy();
  }
}

type Result = Awaited<ReturnType<typeof runCase>>;

console.log(
  `weft eval | ${llm.provider}/${llm.model} | ${selected.length} cases x ${values.repeat}\n`,
);
const results: Result[] = [];
for (let round = 0; round < Number(values.repeat); round++) {
  for (const c of selected) {
    const r = await runCase(c);
    results.push(r);
    const stats =
      'steps' in r
        ? `${r.steps} steps, ${(r.tokens / 1000).toFixed(1)}k tok, ${r.seconds.toFixed(0)}s`
        : '';
    console.log(`${r.problems.length === 0 ? '✓' : '✗'} ${c.name.padEnd(22)} ${stats}`);
    for (const p of r.problems) console.log(`    ${p}`);
  }
}

const scored = results.filter((r) => !('llmError' in r));
const ran = scored.flatMap((r) => ('steps' in r ? [r] : []));
const passed = (kind: string) =>
  `${scored.filter((r) => r.kind === kind && r.problems.length === 0).length}/${scored.filter((r) => r.kind === kind).length}`;
const sum = (f: (r: (typeof ran)[number]) => number) => ran.reduce((n, r) => n + f(r), 0);

console.log(`
questions passed      ${passed('question')}
  without edits       ${ran.filter((r) => r.kind === 'question' && !r.edited).length}/${ran.filter((r) => r.kind === 'question').length}
changes passed        ${passed('change')}
all passed            ${scored.filter((r) => r.problems.length === 0).length}/${scored.length}
wrong-language search ${sum((r) => r.wrongLanguage)}
avg steps             ${(sum((r) => r.steps) / Math.max(1, ran.length)).toFixed(1)}
tokens                ${(sum((r) => r.tokens) / 1000).toFixed(1)}k
llm errors            ${results.length - scored.length}`);

await mkdir(resultsDir, { recursive: true });
const file = join(
  resultsDir,
  `${new Date().toISOString().slice(0, 19).replace(/:/g, '')}-${values.label}-${llm.model.replace(/\W+/g, '_')}.json`,
);
await writeFile(
  file,
  JSON.stringify(
    { provider: llm.provider, model: llm.model, label: values.label, results },
    null,
    2,
  ),
);
console.log(`\nsaved ${file}`);
