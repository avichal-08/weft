import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSandbox, type Sandbox } from '@weft/sandbox';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { grep, glob, viewFile } from '../src/tools/read.ts';
import type { ToolContext } from '../src/types.ts';

const image = process.env.SANDBOX_IMAGE ?? 'weft-sandbox:dev';
const root = '/workspace/repo';
let sandbox: Sandbox;
let fixture: string;
let ctx: ToolContext;

const grepArgs = {
  path: '.',
  mode: 'files' as const,
  context: 0,
  ignore_case: false,
  head_limit: 100,
};

beforeAll(async () => {
  fixture = await mkdtemp(join(tmpdir(), 'weft-read-'));
  const files: Record<string, string | Buffer> = {
    'src/config.ts': 'export function parseConfig(raw: string) {\n  return JSON.parse(raw);\n}\n',
    'src/server.ts': Array.from({ length: 120 }, (_, i) => `// line ${i + 1}`).join('\n') + '\n',
    'test/config.test.ts': "import { parseConfig } from '../src/config';\n",
    'dist/bundle.js': 'function parseConfig(){}\n',
    '.gitignore': 'dist/\n',
    'README.md': '# fixture\n',
    'empty.txt': '',
    'logo.bin': Buffer.from([0, 1, 2, 0, 255]),
    'min.js': 'x'.repeat(5000) + '\n',
  };
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(fixture, path, '..'), { recursive: true });
    await writeFile(join(fixture, path), content);
  }
  sandbox = await createSandbox({ image });
  await sandbox.putFiles(fixture, root);
  await sandbox.exec('git init -q', { cwd: root });
  ctx = { sandbox, root };
});

afterAll(async () => {
  await sandbox.destroy();
  await rm(fixture, { recursive: true, force: true });
});

describe('grep', () => {
  it('lists matching files, skipping gitignored ones', async () => {
    const out = await grep(ctx, { ...grepArgs, pattern: 'parseConfig' });
    expect(out).toEqual({ isError: false, content: 'src/config.ts\ntest/config.test.ts' });
  });

  it('shows matching lines with numbers and context', async () => {
    const out = await grep(ctx, { ...grepArgs, pattern: 'JSON', mode: 'content', context: 1 });
    expect(out.content).toBe(
      'src/config.ts-1-export function parseConfig(raw: string) {\n' +
        'src/config.ts:2:  return JSON.parse(raw);\n' +
        'src/config.ts-3-}',
    );
  });

  it('counts matches per file', async () => {
    const out = await grep(ctx, { ...grepArgs, pattern: 'line', mode: 'count', path: 'src' });
    expect(out.content).toBe('src/server.ts:120');
  });

  it('cuts long output with a hint', async () => {
    const out = await grep(ctx, { ...grepArgs, pattern: 'line', mode: 'content', head_limit: 3 });
    expect(out.content.split('\n')).toHaveLength(4);
    expect(out.content).toMatch(/\[showing 3 of 120 lines; narrow with/);
  });

  it('reports no matches without an error', async () => {
    expect(await grep(ctx, { ...grepArgs, pattern: 'nothing_here' })).toEqual({
      isError: false,
      content: 'No matches.',
    });
  });

  it('treats a shell-looking pattern as plain text', async () => {
    await grep(ctx, { ...grepArgs, pattern: '"; touch /tmp/pwned; echo "' });
    expect((await sandbox.exec('test -e /tmp/pwned')).exitCode).toBe(1);
  });

  it('reports invalid regexes as errors', async () => {
    const out = await grep(ctx, { ...grepArgs, pattern: '(unclosed' });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/regex/i);
  });

  it('refuses paths outside the repository', async () => {
    const out = await grep(ctx, { ...grepArgs, pattern: 'root', path: '../../etc' });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/outside/);
  });
});

describe('glob', () => {
  it('finds files by pattern', async () => {
    const out = await glob(ctx, { pattern: '**/*.ts', path: '.' });
    expect(out.content.split('\n').sort()).toEqual([
      'src/config.ts',
      'src/server.ts',
      'test/config.test.ts',
    ]);
  });

  it('reports when nothing matches', async () => {
    expect((await glob(ctx, { pattern: '*.py', path: '.' })).content).toBe('No files found.');
  });
});

describe('view_file', () => {
  it('shows numbered lines', async () => {
    const out = await viewFile(ctx, { path: 'src/config.ts', offset: 1, limit: 500 });
    expect(out.content).toBe(
      '     1\texport function parseConfig(raw: string) {\n' +
        '     2\t  return JSON.parse(raw);\n' +
        '     3\t}',
    );
  });

  it('reads a range and says how to continue', async () => {
    const out = await viewFile(ctx, { path: 'src/server.ts', offset: 40, limit: 3 });
    expect(out.content).toBe(
      '    40\t// line 40\n    41\t// line 41\n    42\t// line 42\n' +
        '[lines 40-42 of 120; use offset=43 to read more]',
    );
  });

  it('cuts very long lines', async () => {
    const out = await viewFile(ctx, { path: 'min.js', offset: 1, limit: 10 });
    expect(out.content.length).toBeLessThan(2100);
    expect(out.content).toMatch(/\[line truncated\]$/);
  });

  it.each([
    ['nope.ts', /File not found/],
    ['src', /is a directory/],
    ['logo.bin', /binary file/],
    ['../../etc/passwd', /outside the repository/],
  ])('refuses %s', async (path, message) => {
    const out = await viewFile(ctx, { path, offset: 1, limit: 10 });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(message);
  });

  it('handles empty files and offsets past the end', async () => {
    expect((await viewFile(ctx, { path: 'empty.txt', offset: 1, limit: 10 })).content).toBe(
      '(empty file)',
    );
    const past = await viewFile(ctx, { path: 'README.md', offset: 50, limit: 10 });
    expect(past.isError).toBe(true);
    expect(past.content).toMatch(/past the end/);
  });
});
