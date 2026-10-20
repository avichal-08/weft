import { fileURLToPath } from 'node:url';
import { createProvider, LLMError, loadLLMConfig, withRetry } from '@weft/llm';
import { createSandbox } from '@weft/sandbox';
import { createToolContext, runAgent, type AgentEvent } from '../src/index.ts';

const fixture = process.argv[2] ?? fileURLToPath(new URL('../fixtures/add-bug', import.meta.url));
const task =
  process.argv[3] ?? 'The test suite is failing. Find the bug and fix it so all tests pass.';
const root = '/workspace/repo';
const testCommand = 'node --test';

const llm = withRetry(createProvider(loadLLMConfig()), {
  onRetry: ({ attempt, delayMs, error }) =>
    console.log(`  retry ${attempt} in ${delayMs}ms: ${error.kind}`),
});

const oneLine = (s: string, max = 100) => s.replace(/\s+/g, ' ').trim().slice(0, max);

function print(e: AgentEvent) {
  if (e.type === 'llm') {
    const thought = e.text ? ` "${oneLine(e.text, 80)}"` : '';
    console.log(
      `\n#${e.step} llm ${e.latencyMs}ms in=${e.usage.inputTokens} out=${e.usage.outputTokens}${thought}`,
    );
  } else {
    const mark = e.isError ? '✗' : '✓';
    console.log(`   ${mark} ${e.name}(${oneLine(JSON.stringify(e.args), 90)}) ${e.durationMs}ms`);
    console.log(`     → ${oneLine(e.output)}`);
  }
}

console.log(`weft demo | ${llm.provider}/${llm.model} | ${fixture}`);
const started = performance.now();
const sandbox = await createSandbox({
  image: process.env.SANDBOX_IMAGE ?? 'weft-sandbox:dev',
  owner: 'demo',
});

try {
  await sandbox.putFiles(fixture, root);
  await sandbox.exec('git init -q && git add -A && git commit -qm base', { cwd: root });

  const ctx = createToolContext({ sandbox, root, testCommand });
  const res = await runAgent({ llm, ctx, task, onEvent: print });

  const verify = await sandbox.exec(testCommand, { cwd: root });
  const diff = await sandbox.exec('git diff', { cwd: root });

  console.log(
    `\nstatus: ${res.status} | steps: ${res.steps} | tokens in=${res.usage.inputTokens} out=${res.usage.outputTokens} cached=${res.usage.cacheReadTokens}`,
  );
  console.log(`summary: ${res.summary ?? '-'}`);
  console.log(`verification (${testCommand}): ${verify.exitCode === 0 ? 'PASS' : 'FAIL'}`);
  console.log(`wall time: ${((performance.now() - started) / 1000).toFixed(1)}s\n`);
  console.log(diff.stdout || '(no changes)');
} catch (err) {
  if (!(err instanceof LLMError)) throw err;
  console.error(`\nrun aborted: ${err.provider} ${err.kind} (${err.status ?? 'no status'})`);
  console.error(err.message.split('\n')[0]?.slice(0, 300));
  process.exitCode = 1;
} finally {
  await sandbox.destroy();
}
