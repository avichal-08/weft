import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { addTurn, createRun, createSession, getRun, listRunEvents } from '@weft/db';
import { reset, testDb, type TestDb } from '@weft/db/testing';
import { createMockProvider, type ContentBlock } from '@weft/llm';
import type { LiveMessage } from '@weft/queue';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { executeRun, REPO_ROOT } from '../src/execute.ts';
import { dockerDepsImages, installCache as createCache } from '../src/install-cache.ts';
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
    expect(
      lines.some((l) =>
        l.endsWith("verify: no clean dependencies yet, running the tests in the agent's sandbox"),
      ),
    ).toBe(true);
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

  it('records edits in a repo that ignores its installed node_modules', async () => {
    const id = await run(await origin(), [
      call('run_command', { command: 'echo "// edited" >> test/ms.test.js', timeout_sec: 10 }),
      call('finish', { summary: 'edited' }),
    ]);

    const done = await getRun(db, id);
    expect(done).toMatchObject({ status: 'succeeded' });
    expect(done?.diff).toContain('+// edited');
    expect(done?.diff).not.toContain('node_modules');
    expect(done?.diff).not.toContain('.gitignore');
  }, 180_000);

  it('caches the install, then restores it offline on the next run', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weft-install-cache-'));
    dirs.push(dir);
    const installCache = createCache({ dir, maxBytes: 1e9 });
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

  it('turns the cached install into an image in the background and starts from it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weft-install-cache-'));
    dirs.push(dir);
    const images = dockerDepsImages(REPO_ROOT);
    const installCache = createCache({ dir, maxBytes: 1e9, images });
    const repoUrl = await origin();

    await run(repoUrl, [call('finish', { summary: 'one' })], [], [], { installCache });
    await installCache.idle();
    const key = (await readdir(dir)).find((n) => n.endsWith('.used'))?.slice(0, -'.used'.length);
    try {
      expect(key).toMatch(/^[0-9a-f]{64}$/);
      expect(await images.has(key!)).toBe(true);
      expect((await readdir(dir)).filter((n) => n.endsWith('.tar'))).toHaveLength(0);

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
      expect(second.some((l) => l.includes('setup: dependencies already in weft-deps:'))).toBe(
        true,
      );
      expect(second.some((l) => /setup: (npm ci|restoring)/.test(l))).toBe(false);
      const done = await getRun(db, id);
      expect(done).toMatchObject({ status: 'succeeded', diff: '' });
      expect(done?.timings?.map((t) => t.phase)).not.toContain('cacheRestore');
      expect(done?.timings?.map((t) => t.phase)).toContain('verifySandbox');
      const [, tests, , probe] = await listRunEvents(db, id, { attempt: 1 });
      expect(tests?.data.output).toMatch(/^Tests passed/);
      expect(probe?.data.output).toContain('offline');
    } finally {
      if (key) await images.remove(key);
    }
  }, 600_000);

  it('keeps caching after the agent changes dependency files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weft-install-cache-'));
    dirs.push(dir);
    const installCache = createCache({ dir, maxBytes: 1e9 });
    const edit =
      "node -e \"const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json'));p.description='edited';fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\\n')\"";
    const turn = async (runId: string, script: { content: ContentBlock[] }[]) => {
      const lines: string[] = [];
      await executeRun(
        {
          db,
          workerId: 'setup-test',
          sandboxImage: image,
          createLLM: () => createMockProvider(script),
          allowFileRepos: true,
          watchIntervalMs: 200,
          log: (l) => lines.push(l),
          installCache,
        },
        runId,
      );
      expect((await getRun(db, runId))?.status).toBe('succeeded');
      return lines;
    };

    const { session, run } = await createSession(db, { repoUrl: await origin(), message: 'edit' });
    await turn(run.id, [
      call('run_command', { command: edit, timeout_sec: 20 }),
      call('finish', { summary: 'edited' }),
    ]);
    expect((await getRun(db, run.id))?.diff).toContain('"description": "edited"');

    const next = async () => {
      const added = await addTurn(db, session.id, 'again');
      if (!added.ok) throw new Error('turn refused');
      return turn(added.run.id, [call('finish', { summary: 'ok' })]);
    };
    const second = await next();
    expect(second.some((l) => l.includes('setup: npm ci'))).toBe(true);
    expect(second.some((l) => /setup: cached \d+ MB/.test(l))).toBe(true);

    const third = await next();
    expect(third.some((l) => l.endsWith('setup: restoring dependencies from cache'))).toBe(true);
    expect(third.some((l) => l.includes('setup: npm ci'))).toBe(false);
    expect((await readdir(dir)).filter((n) => n.endsWith('.tar'))).toHaveLength(2);
  }, 600_000);

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
