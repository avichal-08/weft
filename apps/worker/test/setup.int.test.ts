import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRun, getRun, listRunEvents } from '@weft/db';
import { reset, testDb, type TestDb } from '@weft/db/testing';
import { createMockProvider, type ContentBlock } from '@weft/llm';
import type { LiveMessage } from '@weft/queue';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { executeRun } from '../src/execute.ts';
import type { WorkerDeps } from '../src/types.ts';

const fixture = fileURLToPath(new URL('./fixtures/with-deps', import.meta.url));
const bunFixture = fileURLToPath(new URL('./fixtures/bun-workspace', import.meta.url));
const image = process.env.SANDBOX_IMAGE ?? 'weft-sandbox:dev';
const dirs: string[] = [];
let db: TestDb;

async function origin(edit?: (dir: string) => Promise<void>, from = fixture) {
  const dir = await mkdtemp(join(tmpdir(), 'weft-setup-origin-'));
  dirs.push(dir);
  await cp(from, dir, { recursive: true });
  await edit?.(dir);
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'init');
  return pathToFileURL(dir).href;
}

const reach = `node -e "fetch('https://registry.npmjs.org/').then(() => console.log('online'), () => console.log('offline'))"`;

const call = (name: string, input: unknown): { content: ContentBlock[] } => ({
  content: [{ type: 'tool_call', id: name, name, input }],
});

function run(
  repoUrl: string,
  script: { content: ContentBlock[] }[],
  lines: string[] = [],
  published: LiveMessage[] = [],
  extra: Partial<WorkerDeps> = {},
) {
  return createRun(db, { repoUrl, task: 'check', testCommand: 'node --test' }).then(async (r) => {
    await executeRun(
      {
        db,
        workerId: 'setup-test',
        sandboxImage: image,
        createLLM: () => createMockProvider(script),
        allowFileRepos: true,
        watchIntervalMs: 200,
        log: (l) => lines.push(l),
        live: (_id, m) => {
          published.push(m);
          return Promise.resolve();
        },
        ...extra,
      },
      r.id,
    );
    return r.id;
  });
}

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await reset(db);
});

afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

describe('setup phase', () => {
  it('installs dependencies so the tests can import them', async () => {
    const lines: string[] = [];
    const published: LiveMessage[] = [];
    const id = await run(
      await origin(),
      [call('run_tests', {}), call('finish', { summary: 'tests pass' })],
      lines,
      published,
    );

    expect(await getRun(db, id)).toMatchObject({ status: 'succeeded', diff: '' });
    const [, tests] = await listRunEvents(db, id, { attempt: 1 });
    expect(tests?.data.output).toMatch(/^Tests passed/);
    expect(
      lines.some((l) => l.endsWith('setup: npm ci --no-audit --no-fund --loglevel=error')),
    ).toBe(true);
    expect(lines.some((l) => /setup: done in [\d.]+s, network disconnected/.test(l))).toBe(true);
    expect(published.filter((m) => m.kind === 'phase').map((m) => m.phase)).toEqual([
      'clone',
      'sandbox',
      'setup',
      'agent',
      'verify',
    ]);
    expect(published.find((m) => m.kind === 'phase' && m.phase === 'setup')).toMatchObject({
      detail: 'npm ci --no-audit --no-fund --loglevel=error',
    });
  }, 180_000);

  it('installs a bun workspace with workspace: dependencies, then drops the caches', async () => {
    const lines: string[] = [];
    const id = await run(
      await origin(undefined, bunFixture),
      [
        call('run_tests', {}),
        call('run_command', { command: 'ls -A /workspace/.weft-cache' }),
        call('finish', { summary: 'done' }),
      ],
      lines,
    );

    expect(await getRun(db, id)).toMatchObject({ status: 'succeeded', diff: '' });
    const [, tests, , caches] = await listRunEvents(db, id, { attempt: 1 });
    expect(tests?.data.output).toMatch(/^Tests passed/);
    expect(String(caches?.data.output)).not.toMatch(/\b(bun|npm|pnpm)\b/);
    expect(lines.some((l) => l.endsWith('setup: bun install --frozen-lockfile'))).toBe(true);
  }, 180_000);

  it('caches the install, then restores it offline on the next run', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weft-install-cache-'));
    dirs.push(dir);
    const installCache = { dir, maxBytes: 1e9 };
    const repoUrl = await origin();

    const first: string[] = [];
    await run(repoUrl, [call('finish', { summary: 'one' })], first, [], { installCache });
    expect(first.some((l) => /setup: cached \d+ MB/.test(l))).toBe(true);
    expect((await readdir(dir)).filter((n) => n.endsWith('.tar'))).toHaveLength(1);

    const second: string[] = [];
    const id = await run(
      repoUrl,
      [
        call('run_tests', {}),
        call('run_command', { command: reach, timeout_sec: 20 }),
        call('finish', { summary: 'two' }),
      ],
      second,
      [],
      { installCache },
    );
    expect(second.some((l) => l.endsWith('setup: restoring dependencies from cache'))).toBe(true);
    expect(second.some((l) => l.includes('setup: npm ci'))).toBe(false);
    expect(await getRun(db, id)).toMatchObject({ status: 'succeeded', diff: '' });
    const [, tests, , probe] = await listRunEvents(db, id, { attempt: 1 });
    expect(tests?.data.output).toMatch(/^Tests passed/);
    expect(probe?.data.output).toContain('offline');
  }, 240_000);

  it('runs the agent offline even though setup had network', async () => {
    const id = await run(await origin(), [
      call('run_command', { command: reach, timeout_sec: 20 }),
      call('finish', { summary: 'checked' }),
    ]);
    const [, probe] = await listRunEvents(db, id, { attempt: 1 });
    expect(probe?.data.output).toContain('offline');
    expect(probe?.data.output).not.toContain('online');
  }, 180_000);

  it('fails the turn clearly when the install fails', async () => {
    const repoUrl = await origin(async (dir) => {
      await rm(join(dir, 'package-lock.json'));
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ name: 'broken', dependencies: { ms: '999.0.0' } }),
      );
    });
    const id = await run(repoUrl, [call('finish', { summary: 'never reached' })]);

    const done = await getRun(db, id);
    expect(done).toMatchObject({ status: 'error', failureKind: 'setup_failed' });
    expect(done?.failureDetail).toMatch(/npm install .* failed[\s\S]*ms/);
  }, 180_000);
});
