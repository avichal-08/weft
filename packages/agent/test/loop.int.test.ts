import { fileURLToPath } from 'node:url';
import { createMockProvider, type ContentBlock } from '@weft/llm';
import { createSandbox, type Sandbox } from '@weft/sandbox';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runAgent } from '../src/loop.ts';
import { createToolContext } from '../src/tools/execute.ts';

const image = process.env.SANDBOX_IMAGE ?? 'weft-sandbox:dev';
const fixture = fileURLToPath(new URL('../fixtures/add-bug', import.meta.url));
const root = '/workspace/repo';
let sandbox: Sandbox;

const call = (name: string, input: unknown): { content: ContentBlock[] } => ({
  content: [{ type: 'tool_call', id: name, name, input }],
});

beforeAll(async () => {
  sandbox = await createSandbox({ image });
  await sandbox.putFiles(fixture, root);
});

afterAll(async () => {
  await sandbox.destroy();
});

describe('runAgent against a real sandbox', () => {
  it('fixes the add-bug fixture when driven by a scripted model', async () => {
    const llm = createMockProvider([
      call('run_tests', {}),
      call('grep', { pattern: 'function add', mode: 'content' }),
      call('view_file', { path: 'src/math.js' }),
      call('str_replace_edit', { path: 'src/math.js', old_str: 'a - b', new_str: 'a + b' }),
      call('run_tests', {}),
      call('finish', { summary: 'add subtracted instead of adding' }),
    ]);
    const ctx = createToolContext({ sandbox, root, testCommand: 'node --test' });

    const res = await runAgent({ llm, ctx, task: 'Make the failing tests pass.' });

    expect(res).toMatchObject({ status: 'finished', steps: 6 });
    const tools = res.events.flatMap((e) => (e.type === 'tool' ? [[e.name, e.isError]] : []));
    expect(tools).toEqual([
      ['run_tests', true],
      ['grep', false],
      ['view_file', false],
      ['str_replace_edit', false],
      ['run_tests', false],
      ['finish', false],
    ]);
    expect(await sandbox.readFile(`${root}/src/math.js`)).toContain('return a + b;');
  });
});
