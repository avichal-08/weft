import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { addTurn, createSession, getRun, listRunEvents } from '@weft/db';
import { reset, testDb, type TestDb } from '@weft/db/testing';
import { createMockProvider, type ContentBlock, type LLMProvider } from '@weft/llm';
import { listSandboxes } from '@weft/sandbox';
import Docker from 'dockerode';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { executeRun } from '../src/execute.ts';
import { sessionSandboxes, type SessionSandboxes } from '../src/session-sandboxes.ts';
import type { WorkerDeps } from '../src/types.ts';

const fixture = fileURLToPath(new URL('../../../packages/agent/fixtures/add-bug', import.meta.url));
const image = process.env.SANDBOX_IMAGE ?? 'weft-sandbox:dev';
const dirs: string[] = [];
let db: TestDb;
let sessions: SessionSandboxes;

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd });

async function origin() {
  const dir = await mkdtemp(join(tmpdir(), 'weft-kept-origin-'));
  dirs.push(dir);
  await cp(fixture, dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}

const call = (name: string, input: unknown): { content: ContentBlock[] } => ({
  content: [{ type: 'tool_call', id: name, name, input }],
});

const deps = (llm: LLMProvider, lines: string[] = []): WorkerDeps => ({
  db,
  workerId: 'kept-test',
  sandboxImage: image,
  createLLM: () => llm,
  allowFileRepos: true,
  watchIntervalMs: 200,
  log: (l) => lines.push(l),
  sessions,
});

const containers = async () =>
  (await listSandboxes(new Docker(), {})).filter((s) => s.owner === 'kept-test').length;

async function twoTurns(dir: string, first: { content: ContentBlock[] }[], between?: () => void) {
  const { session, run } = await createSession(db, {
    repoUrl: pathToFileURL(dir).href,
    message: 'first',
  });
  await executeRun(deps(createMockProvider(first)), run.id);
  between?.();
  const next = await addTurn(db, session.id, 'second');
  if (!next.ok) throw new Error('turn 2 was refused');
  const lines: string[] = [];
  const probe = 'test -e /home/node/marker && echo kept || echo fresh';
  await executeRun(
    deps(
      createMockProvider([
        call('run_command', { command: probe, timeout_sec: 10 }),
        call('finish', { summary: 'checked' }),
      ]),
      lines,
    ),
    next.run.id,
  );
  const [, out] = await listRunEvents(db, next.run.id, { attempt: 1 });
  return { lines, output: String(out?.data.output), run: await getRun(db, next.run.id) };
}

const leaveMarker = [
  call('run_command', { command: 'touch /home/node/marker', timeout_sec: 10 }),
  call('finish', { summary: 'done' }),
];

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await reset(db);
  sessions = sessionSandboxes({ max: 2, idleMs: 60_000 });
});

afterEach(async () => {
  await sessions.clear();
  expect(await containers()).toBe(0);
});

afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

describe('session sandboxes', () => {
  it('continues the next turn in the sandbox the previous turn left', async () => {
    const { lines, output, run } = await twoTurns(await origin(), leaveMarker);

    expect(output).toContain('kept');
    expect(
      lines.some((l) =>
        l.endsWith('resume: continuing in the sandbox kept from the previous turn'),
      ),
    ).toBe(true);
    expect(run?.timings?.map((t) => t.phase)).toEqual(['resume', 'agent', 'diff']);
    expect(sessions.size()).toBe(1);
  });

  it('starts fresh when the branch moved between turns', async () => {
    const dir = await origin();
    const { lines, output, run } = await twoTurns(dir, leaveMarker, () =>
      git(dir, 'commit', '-q', '--allow-empty', '-m', 'someone pushed'),
    );

    expect(output).toContain('fresh');
    expect(lines.some((l) => l.includes('the branch has moved since it was cloned'))).toBe(true);
    expect(run?.timings?.map((t) => t.phase)).toEqual([
      'resume',
      'clone',
      'sandbox',
      'copy',
      'agent',
      'diff',
    ]);
  });

  it("doesn't keep a sandbox whose dependency files changed", async () => {
    const { output, run } = await twoTurns(await origin(), [
      call('run_command', {
        command: 'touch /home/node/marker && echo "{}" > package.json',
        timeout_sec: 10,
      }),
      call('finish', { summary: 'done' }),
    ]);

    expect(output).toContain('fresh');
    expect(run?.timings?.[0]?.phase).toBe('clone');
  });

  it('leaves nothing staged, so the next turn can git restore its own changes', async () => {
    const dir = await origin();
    const { session, run } = await createSession(db, {
      repoUrl: pathToFileURL(dir).href,
      message: 'edit',
    });
    await executeRun(
      deps(
        createMockProvider([
          call('run_command', { command: 'echo "// edited" >> src/math.js', timeout_sec: 10 }),
          call('finish', { summary: 'edited' }),
        ]),
      ),
      run.id,
    );
    expect((await getRun(db, run.id))?.diff).toContain('+// edited');

    const next = await addTurn(db, session.id, 'undo it');
    if (!next.ok) throw new Error('turn 2 was refused');
    await executeRun(
      deps(
        createMockProvider([
          call('run_command', {
            command: 'git restore src/math.js && git status --short',
            timeout_sec: 10,
          }),
          call('finish', { summary: 'restored' }),
        ]),
      ),
      next.run.id,
    );
    const undone = await getRun(db, next.run.id);
    expect(undone?.timings?.[0]?.phase).toBe('resume');
    expect(undone?.diff).toBe('');
  });

  it("doesn't keep a sandbox from a turn that ended in an error", async () => {
    const { run } = await createSession(db, {
      repoUrl: pathToFileURL(await origin()).href,
      message: 'first',
    });
    const broken = createMockProvider(() => {
      throw new Error('provider exploded');
    });
    await executeRun(deps(broken), run.id);

    expect((await getRun(db, run.id))?.status).toBe('error');
    expect(sessions.size()).toBe(0);
  });
});
