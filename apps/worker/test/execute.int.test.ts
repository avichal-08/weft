import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  addTurn,
  cancelRun,
  claimRun,
  completeRun,
  createRun,
  createSession,
  getRun,
  listRunEvents,
} from '@weft/db';
import { reset, testDb, type TestDb } from '@weft/db/testing';
import {
  createMockProvider,
  LLMError,
  type ContentBlock,
  type LLMProvider,
  type MockScript,
} from '@weft/llm';
import type { LiveMessage } from '@weft/queue';
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
const say = (text: string): { content: ContentBlock[] } => ({
  content: [{ type: 'text', text }],
});

const fixScript = [
  call('view_file', { path: 'src/math.js' }),
  call('str_replace_edit', { path: 'src/math.js', old_str: 'a - b', new_str: 'a + b' }),
  call('run_tests', {}),
  say('add subtracted'),
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
    const lines: string[] = [];
    const published: LiveMessage[] = [];
    const outcome = await executeRun(
      deps(createMockProvider(fixScript), {
        log: (l) => lines.push(l),
        live: (id, m) => {
          if (id === run.id) published.push(m);
          return Promise.resolve();
        },
      }),
      run.id,
    );

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
    expect((done?.timings ?? []).map((t) => t.phase)).toEqual([
      'clone',
      'sandbox',
      'copy',
      'agent',
      'diff',
      'verifySandbox',
      'verify',
    ]);
    expect(await leftovers(run.id)).toBe(0);

    const prefix = `run ${run.id.slice(0, 8)} `;
    expect(lines.every((l) => l.startsWith(prefix))).toBe(true);
    expect(lines.map((l) => l.slice(prefix.length).replace(/\d+(\.\d+)?m?s/g, 'T'))).toEqual([
      '#1 llm T in=0 out=0',
      '   ✓ view_file T',
      '#2 llm T in=0 out=0',
      '   ✓ str_replace_edit T',
      '#3 llm T in=0 out=0',
      '   ✓ run_tests T',
      '#4 llm T in=0 out=0',
      'timings: clone T, sandbox T, copy T, agent T, diff T, verifySandbox T, verify T',
    ]);

    const events = await listRunEvents(db, run.id, { attempt: 1 });
    expect(events.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(events.map((e) => (e.type === 'tool' ? e.data.name : e.type))).toEqual([
      'llm',
      'view_file',
      'llm',
      'str_replace_edit',
      'llm',
      'run_tests',
      'llm',
    ]);
    expect(events[3]?.data).toMatchObject({
      isError: false,
      args: { path: 'src/math.js', old_str: 'a - b', new_str: 'a + b' },
    });
    expect(events[5]?.data.output).toMatch(/^Tests passed/);

    expect(published.map((m) => (m.kind === 'phase' ? m.phase : m.kind))).toEqual([
      'clone',
      'sandbox',
      'agent',
      ...Array<string>(6).fill('event'),
      'text',
      'event',
      'verify',
      'end',
    ]);
    expect(published.every((m) => m.attempt === 1)).toBe(true);
    expect(published.find((m) => m.kind === 'text')).toMatchObject({
      step: 4,
      offset: 0,
      text: 'add subtracted',
    });
    const streamed = published.flatMap((m) => (m.kind === 'event' ? [m.event] : []));
    expect(streamed.map(({ seq, type, step, data }) => ({ seq, type, step, data }))).toEqual(
      events.map(({ seq, type, step, data }) => ({ seq, type, step, data })),
    );
  });

  it('verifies in a fresh sandbox, so nothing outside the diff can make the tests pass', async () => {
    const run = await createRun(db, {
      repoUrl,
      task: 'Make the tests pass.',
      testCommand: 'test ! -e /home/node/marker && node --test',
    });
    const llm = createMockProvider([
      call('run_command', { command: 'touch /home/node/marker', timeout_sec: 10 }),
      ...fixScript,
    ]);

    await executeRun(deps(llm), run.id);
    const done = await getRun(db, run.id);
    expect(done).toMatchObject({ status: 'succeeded' });
    expect(done?.diff).toContain('+  return a + b;');
    const events = await listRunEvents(db, run.id, { attempt: 1 });
    const inAgentSandbox = events.find((e) => e.type === 'tool' && e.data.name === 'run_tests');
    expect(inAgentSandbox?.data.isError).toBe(true);
    expect(await leftovers(run.id)).toBe(0);
  });

  it('logs model retries and still finishes the run', async () => {
    const run = await newRun();
    const lines: string[] = [];
    const flaky = createMockProvider((_req, turn) =>
      turn === 0
        ? new LLMError({
            kind: 'rate_limit',
            provider: 'mock',
            message: 'slow down',
            status: 429,
            retryAfterMs: 20,
          })
        : fixScript[turn - 1]!,
    );

    const outcome = await executeRun(deps(flaky, { log: (l) => lines.push(l) }), run.id);

    expect(outcome).toMatchObject({ kind: 'completed', status: 'succeeded' });
    expect(lines).toContain(`run ${run.id.slice(0, 8)} llm retry 1 in 0.0s: rate_limit (429)`);
  });

  it('fails when the agent finishes but the tests still fail', async () => {
    const run = await newRun();
    await executeRun(deps(createMockProvider([say('done?')])), run.id);
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

describe('conversations', () => {
  const session = (testCommand?: string) =>
    createSession(db, {
      repoUrl,
      message: 'Fix the add function.',
      ...(testCommand ? { testCommand } : {}),
    });

  it('continues from the previous turn, with its history', async () => {
    const { session: s, run: first } = await session('node --test');
    await executeRun(deps(createMockProvider(fixScript)), first.id);
    expect((await getRun(db, first.id))?.status).toBe('succeeded');

    const next = await addTurn(db, s.id, 'Now add a subtract helper in src/subtract.js.');
    if (!next.ok) throw new Error('turn 2 was refused');

    const turn2 = createMockProvider([
      call('view_file', { path: 'src/math.js' }),
      call('create_file', {
        path: 'src/subtract.js',
        content: 'export const subtract = (a, b) => a - b;\n',
      }),
      say('Added src/subtract.js.'),
    ]);
    const outcome = await executeRun(deps(turn2), next.run.id);
    expect(outcome).toMatchObject({ kind: 'completed', status: 'succeeded' });

    const req = turn2.calls[0]!;
    expect(
      req.messages.map((m) => [m.role, m.content[0]?.type === 'text' ? m.content[0].text : '']),
    ).toEqual([
      ['user', 'Fix the add function.'],
      ['assistant', 'add subtracted'],
      ['user', 'Now add a subtract helper in src/subtract.js.'],
    ]);

    const viewed = (await listRunEvents(db, next.run.id, { attempt: 1 }))[1]!;
    expect(viewed.data.output).toContain('return a + b;');

    const diff = (await getRun(db, next.run.id))?.diff ?? '';
    expect(diff).toContain('+  return a + b;');
    expect(diff).toContain('+export const subtract = (a, b) => a - b;');
  });

  it('keeps an Ask turn read-only and carries the earlier changes forward', async () => {
    const { session: s, run: first } = await session('node --test');
    await executeRun(deps(createMockProvider(fixScript)), first.id);
    const fixed = (await getRun(db, first.id))!.diff;

    const next = await addTurn(db, s.id, 'Why did add fail before?', 'ask');
    if (!next.ok) throw new Error('turn 2 was refused');
    const ask = createMockProvider([
      call('str_replace_edit', { path: 'src/math.js', old_str: 'a + b', new_str: 'a - b' }),
      call('view_file', { path: 'src/math.js' }),
      say('It subtracted instead of adding.'),
    ]);
    const outcome = await executeRun(deps(ask), next.run.id);
    expect(outcome).toMatchObject({ kind: 'completed', status: 'succeeded' });

    expect(ask.calls[0]!.tools!.map((t) => t.name)).toEqual(['grep', 'glob', 'view_file']);
    const done = (await getRun(db, next.run.id))!;
    expect(done).toMatchObject({ mode: 'ask', summary: 'It subtracted instead of adding.' });
    expect(done.diff).toBe(fixed);
    expect(done.timings?.map((t) => t.phase)).not.toContain('verify');
  });

  it('stores the checks of the diff, without failing the turn', async () => {
    const { run } = await session('node --test');
    const llm = createMockProvider([
      ...fixScript.slice(0, 2),
      call('create_file', { path: '.env', content: 'DEBUG=1\n' }),
      say('fixed, and added .env'),
    ]);
    const outcome = await executeRun(deps(llm), run.id);
    expect(outcome).toMatchObject({ kind: 'completed', status: 'succeeded' });
    expect((await getRun(db, run.id))?.checks).toMatchObject([
      { kind: 'secret', severity: 'block', file: '.env' },
    ]);
  });

  it('stops a run that fills the disk and says why', async () => {
    const { run } = await createSession(db, { repoUrl, message: 'Make a big file.' });
    const llm = createMockProvider([
      call('run_command', {
        command: 'head -c 20000000 /dev/urandom > big.bin && sleep 30',
        timeout_sec: 60,
      }),
      say('never reached'),
    ]);
    const lines: string[] = [];

    await executeRun(
      deps(llm, { diskLimitMb: 5, diskCheckMs: 200, log: (l) => lines.push(l) }),
      run.id,
    );
    const done = await getRun(db, run.id);
    expect(done).toMatchObject({ status: 'error', failureKind: 'disk_limit' });
    expect(done?.failureDetail).toMatch(
      /^the sandbox was stopped because it wrote \d+ MB, over its 5 MB disk limit$/,
    );
    expect(lines.some((l) => l.includes('sandbox killed: it wrote'))).toBe(true);
    expect(await leftovers(run.id)).toBe(0);
  });

  it('answers a question without a test command or any changes', async () => {
    const { run } = await createSession(db, { repoUrl, message: 'What does multiply do?' });
    const llm = createMockProvider([
      call('view_file', { path: 'src/math.js' }),
      say('It multiplies its two arguments.'),
    ]);

    expect(await executeRun(deps(llm), run.id)).toMatchObject({ status: 'succeeded' });
    expect(await getRun(db, run.id)).toMatchObject({
      status: 'succeeded',
      summary: 'It multiplies its two arguments.',
      diff: '',
      failureKind: null,
    });
    expect(llm.calls[0]!.tools!.map((t) => t.name)).not.toContain('run_tests');
  });

  it('fails clearly when the previous changes no longer apply', async () => {
    const { session: s, run: first } = await session();
    const attempt = (await claimRun(db, first.id, 'w'))!;
    await completeRun(db, first.id, attempt, {
      status: 'succeeded',
      summary: 'done',
      diff: 'diff --git a/src/math.js b/src/math.js\n--- a/src/math.js\n+++ b/src/math.js\n@@ -1,1 +1,1 @@\n-this line is not in the file\n+replacement\n',
    });
    const next = await addTurn(db, s.id, 'continue');
    if (!next.ok) throw new Error('turn 2 was refused');

    await executeRun(deps(createMockProvider(fixScript)), next.run.id);
    const done = await getRun(db, next.run.id);
    expect(done).toMatchObject({ status: 'error', failureKind: 'apply_failed' });
    expect(done?.failureDetail).toMatch(/no longer apply to the branch.*Start a new chat/s);
    expect((done?.timings ?? []).map((t) => t.phase)).toEqual([
      'clone',
      'sandbox',
      'copy',
      'apply',
    ]);
    expect(await leftovers(next.run.id)).toBe(0);
  });

  it('starts from the base branch when the previous turn recorded no changes', async () => {
    const { session: s, run: first } = await session();
    await cancelRun(db, first.id);
    const next = await addTurn(db, s.id, 'try again');
    if (!next.ok) throw new Error('turn 2 was refused');

    const llm = createMockProvider([say('ok')]);
    await executeRun(deps(llm), next.run.id);
    expect(llm.calls[0]!.messages[1]).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: '(this turn ended without a reply: cancelled)' }],
    });
    expect((await getRun(db, next.run.id))?.status).toBe('succeeded');
  });
});
