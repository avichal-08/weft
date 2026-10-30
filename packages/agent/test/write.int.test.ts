import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolCallBlock } from '@weft/llm';
import { createSandbox, type Sandbox } from '@weft/sandbox';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createToolContext, executeTool } from '../src/tools/execute.ts';
import { parseToolCall } from '../src/tools/parse.ts';
import type { ToolContext, ToolOutput } from '../src/types.ts';

const image = process.env.SANDBOX_IMAGE ?? 'weft-sandbox:dev';
const root = '/workspace/repo';
let sandbox: Sandbox;
let fixture: string;
let ctx: ToolContext;

async function call(name: string, input: unknown): Promise<ToolOutput> {
  const block: ToolCallBlock = { type: 'tool_call', id: 'c', name, input };
  const parsed = parseToolCall(block);
  if (!parsed.ok) return { isError: true, content: parsed.error };
  return executeTool(ctx, parsed);
}

beforeAll(async () => {
  fixture = await mkdtemp(join(tmpdir(), 'weft-write-'));
  await writeFile(join(fixture, 'math.js'), 'export const add = (a, b) => a - b;\n');
  await writeFile(
    join(fixture, 'test.sh'),
    'grep -q "a + b" math.js && echo "1 passing" || { echo "add is broken"; exit 1; }\n',
  );
  await writeFile(join(fixture, 'run.sh'), '#!/bin/sh\necho v1\n');
  await chmod(join(fixture, 'run.sh'), 0o755);
  sandbox = await createSandbox({ image });
  await sandbox.putFiles(fixture, root);
  ctx = createToolContext({ sandbox, root, testCommand: 'sh test.sh', testTimeoutMs: 10_000 });
});

afterAll(async () => {
  await sandbox.destroy();
  await rm(fixture, { recursive: true, force: true });
});

describe('the edit loop', () => {
  it('fails tests, views, edits, then passes tests', async () => {
    const before = await call('run_tests', {});
    expect(before.isError).toBe(true);
    expect(before.content).toMatch(/^Tests failed\.\nexit code: 1\nstdout:\nadd is broken/);

    expect((await call('view_file', { path: 'math.js' })).isError).toBe(false);
    const edit = await call('str_replace_edit', {
      path: 'math.js',
      old_str: 'a - b',
      new_str: 'a + b',
    });
    expect(edit).toEqual({
      isError: false,
      content:
        'Edited math.js. Around line 1 now:\n     1\texport const add = (a, b) => a + b;\n     2\t',
    });

    const after = await call('run_tests', {});
    expect(after).toEqual({
      isError: false,
      content: 'Tests passed.\nexit code: 0\nstdout:\n1 passing',
    });
  });

  it('allows consecutive edits without viewing again', async () => {
    await call('str_replace_edit', { path: 'math.js', old_str: 'add', new_str: 'sum' });
    expect(await sandbox.readFile(`${root}/math.js`)).toBe('export const sum = (a, b) => a + b;\n');
  });
});

describe('str_replace_edit guards', () => {
  it('requires viewing the file first', async () => {
    const out = await call('str_replace_edit', { path: 'run.sh', old_str: 'v1', new_str: 'v2' });
    expect(out).toMatchObject({
      isError: true,
      content: 'View run.sh with view_file before editing it.',
    });
  });

  it('refuses edits when the file changed after it was viewed', async () => {
    await call('view_file', { path: 'run.sh' });
    await sandbox.exec(`sed -i 's/v1/v1-external/' ${root}/run.sh`);
    const out = await call('str_replace_edit', { path: 'run.sh', old_str: 'v1', new_str: 'v2' });
    expect(out.content).toMatch(/changed since you last viewed it/);
  });

  it('keeps the executable bit', async () => {
    await call('view_file', { path: 'run.sh' });
    await call('str_replace_edit', { path: 'run.sh', old_str: 'v1-external', new_str: 'v2' });
    expect((await sandbox.exec('./run.sh', { cwd: root })).stdout).toBe('v2\n');
  });
});

describe('create_file', () => {
  it('creates nested files that can be edited right away', async () => {
    const out = await call('create_file', {
      path: 'lib/util/str.js',
      content: 'export const x = 1;\n',
    });
    expect(out).toEqual({ isError: false, content: 'Created lib/util/str.js (1 lines).' });
    const edit = await call('str_replace_edit', {
      path: 'lib/util/str.js',
      old_str: '1',
      new_str: '2',
    });
    expect(edit.isError).toBe(false);
  });

  it('refuses to overwrite', async () => {
    const out = await call('create_file', { path: 'math.js', content: '' });
    expect(out.content).toMatch(/already exists/);
    expect(await sandbox.readFile(`${root}/math.js`)).toContain('sum');
  });

  it('refuses paths outside the repository', async () => {
    expect((await call('create_file', { path: '../evil.js', content: 'x' })).content).toMatch(
      /outside the repository/,
    );
  });
});

describe('run_command', () => {
  it('reports output and exit code', async () => {
    const out = await call('run_command', { command: 'echo hi; echo oops >&2; exit 2' });
    expect(out).toEqual({
      isError: true,
      content: 'exit code: 2\nstdout:\nhi\nstderr:\noops',
    });
  });

  it('says when a command timed out', async () => {
    const out = await call('run_command', { command: 'sleep 30', timeout_sec: 1 });
    expect(out.content).toMatch(/^\[timed out after 1s and was killed\]\nexit code: 124/);
  });

  it('clips huge output but keeps the end', async () => {
    const out = await call('run_command', { command: 'seq 1 20000; echo THE_END' });
    expect(out.content.length).toBeLessThan(31_000);
    expect(out.content).toContain('characters omitted');
    expect(out.content.endsWith('THE_END')).toBe(true);
  });
});
