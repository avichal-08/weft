import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cancelRun, claimRun, createRun, getRun } from '@weft/db';
import { reset, testDb, type TestDb } from '@weft/db/testing';
import {
  createMockProvider,
  LLMError,
  type ContentBlock,
  type LLMProvider,
  type MockScript,
} from '@weft/llm';
import { listSandboxes } from '@weft/sandbox';
import Docker from 'dockerode';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { executeRun } from '../src/execute.ts';
import type { WorkerDeps } from '../src/types.ts';

const fixture = fileURLToPath(new URL('../../../packages/agent/fixtures/add-bug', import.meta.url));
const image = process.env.SANDBOX_IMAGE ?? 'weft-sandbox:dev';
let db: TestDb;
let origin: string;
let repoUrl: string;

beforeAll(async () => {
  db = await testDb();
  origin = await mkdtemp(join(tmpdir(), 'weft-worker-origin-'));
  await cp(fixture, origin, { recursive: true });
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: origin });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'init');
  repoUrl = pathToFileURL(origin).href;
});

afterAll(async () => {
  await rm(origin, { recursive: true, force: true });
});

beforeEach(async () => {
  await reset(db);
});

const call = (name: string, input: unknown): { content: ContentBlock[] } => ({
  content: [{ type: 'tool_call', id: name, name, input }],
});

const fixScript = [
  call('view_file', { path: 'src/math.js' }),
  call('str_replace_edit', { path: 'src/math.js', old_str: 'a - b', new_str: 'a + b' }),
  call('run_tests', {}),
  call('finish', { summary: 'add subtracted' }),
];

function deps(llm: LLMProvider, extra: Partial<WorkerDeps> = {}): WorkerDeps {
  return {
    db,
    workerId: 'test-worker',
    sandboxImage: image,
    createLLM: () => llm,
    allowFileRepos: true,
    watchIntervalMs: 200,
    ...extra,
  };
}

const newRun = (config: Record<string, unknown> = {}) =>
  createRun(db, { repoUrl, task: 'Make the tests pass.', testCommand: 'node --test', config });

async function leftovers(runId: string) {
  return (await listSandboxes(new Docker(), { 'weft.run': runId })).length;
}

describe('executeRun', () => {
  it('fixes the bug, verifies it and records the diff', async () => {
    const run = await newRun();
    const outcome = await executeRun(deps(createMockProvider(fixScript)), run.id);

    expect(outcome).toEqual({ kind: 'completed', status: 'succeeded', recorded: true });
    const done = await getRun(db, run.id);
    expect(done).toMatchObject({
      status: 'succeeded',
      attempt: 1,
      workerId: 'test-worker',
      steps: 4,
      summary: 'add subtracted',
    });
    expect(done?.diff).toContain('-  return a - b;\n+  return a + b;');
    expect(done?.finishedAt).toBeInstanceOf(Date);
    expect(await leftovers(run.id)).toBe(0);
  });

  it('fails when the agent finishes but the tests still fail', async () => {
    const run = await newRun();
    await executeRun(deps(createMockProvider([call('finish', { summary: 'done?' })])), run.id);
    const done = await getRun(db, run.id);
    expect(done).toMatchObject({ status: 'failed', failureKind: 'tests_failed', diff: '' });
    expect(done?.failureDetail).toMatch(/not ok/);
  });

  it('fails with the agent status when it runs out of steps', async () => {
    const run = await newRun({ maxSteps: 2 });
    const looping: MockScript = () => call('glob', { pattern: '*' });
    await executeRun(deps(createMockProvider(looping)), run.id);
    expect(await getRun(db, run.id)).toMatchObject({
      status: 'failed',
      failureKind: 'max_steps',
      steps: 2,
    });
  });

  it('skips runs cancelled before they start, without creating a sandbox', async () => {
    const run = await newRun();
    await cancelRun(db, run.id);
    expect(await executeRun(deps(createMockProvider(fixScript)), run.id)).toEqual({
      kind: 'skipped',
    });
    expect(await leftovers(run.id)).toBe(0);
  });

  it('stops the agent when the run is cancelled mid-flight', async () => {
    const run = await newRun();
    const inner = createMockProvider(() => call('glob', { pattern: '*' }));
    const llm: LLMProvider = {
      provider: 'mock',
      model: 'mock',
      async complete(req) {
        if (inner.calls.length === 0) await cancelRun(db, run.id);
        return inner.complete(req);
      },
    };

    expect(await executeRun(deps(llm), run.id)).toEqual({ kind: 'fenced' });
    expect(inner.calls).toHaveLength(1);
    expect((await getRun(db, run.id))?.status).toBe('cancelled');
    expect(await leftovers(run.id)).toBe(0);
  });

  it('stops and writes nothing when another worker takes the run over', async () => {
    const run = await newRun();
    const inner = createMockProvider(() => call('glob', { pattern: '*' }));
    const llm: LLMProvider = {
      provider: 'mock',
      model: 'mock',
      async complete(req) {
        if (inner.calls.length === 0) await claimRun(db, run.id, 'other-worker');
        return inner.complete(req);
      },
    };

    expect(await executeRun(deps(llm), run.id)).toEqual({ kind: 'fenced' });
    expect(await getRun(db, run.id)).toMatchObject({
      status: 'running',
      attempt: 2,
      workerId: 'other-worker',
    });
  });

  it('records clone failures as errors', async () => {
    const run = await createRun(db, {
      repoUrl: pathToFileURL(join(origin, 'missing')).href,
      task: 't',
      testCommand: 'true',
    });
    await executeRun(deps(createMockProvider(fixScript)), run.id);
    expect(await getRun(db, run.id)).toMatchObject({
      status: 'error',
      failureKind: 'clone_failed',
    });
  });

  it('refuses file urls unless the worker allows them', async () => {
    const run = await newRun();
    await executeRun(deps(createMockProvider(fixScript), { allowFileRepos: false }), run.id);
    const done = await getRun(db, run.id);
    expect(done).toMatchObject({ status: 'error', failureKind: 'clone_failed' });
    expect(done?.failureDetail).toMatch(/not allowed/);
  });

  it('records llm failures as errors and still cleans up', async () => {
    const run = await newRun();
    const llm = createMockProvider(
      () => new LLMError({ kind: 'auth', provider: 'mock', message: 'bad key' }),
    );
    await executeRun(deps(llm), run.id);
    expect(await getRun(db, run.id)).toMatchObject({
      status: 'error',
      failureKind: 'llm_auth',
      failureDetail: 'bad key',
    });
    expect(await leftovers(run.id)).toBe(0);
  });

  it('interrupts a hanging model call as soon as the run is cancelled', async () => {
    const run = await newRun();
    const hanging: LLMProvider = {
      provider: 'mock',
      model: 'mock',
      complete: (req) =>
        new Promise((_resolve, reject) => {
          setTimeout(() => void cancelRun(db, run.id), 500);
          req.signal?.addEventListener('abort', () =>
            reject(new LLMError({ kind: 'aborted', provider: 'mock', message: 'aborted' })),
          );
        }),
    };

    const started = performance.now();
    expect(await executeRun(deps(hanging), run.id)).toEqual({ kind: 'fenced' });
    expect(performance.now() - started).toBeLessThan(15_000);
    expect((await getRun(db, run.id))?.status).toBe('cancelled');
    expect(await leftovers(run.id)).toBe(0);
  });

  it('kills a long-running tool command when the run is cancelled', async () => {
    const run = await newRun();
    const inner = createMockProvider([
      call('run_command', { command: 'sleep 300', timeout_sec: 600 }),
    ]);
    const llm: LLMProvider = {
      provider: 'mock',
      model: 'mock',
      complete(req) {
        if (inner.calls.length === 0) setTimeout(() => void cancelRun(db, run.id), 1500);
        return inner.complete(req);
      },
    };

    const started = performance.now();
    expect(await executeRun(deps(llm), run.id)).toEqual({ kind: 'fenced' });
    expect(performance.now() - started).toBeLessThan(20_000);
    expect(await leftovers(run.id)).toBe(0);
  });
});
