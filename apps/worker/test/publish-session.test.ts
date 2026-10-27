import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  addTurn,
  claimRun,
  completeRun,
  createSession,
  getSession,
  type CompleteRunInput,
} from '@weft/db';
import { reset, testDb, type TestDb } from '@weft/db/testing';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { publishSession } from '../src/publish-session.ts';

let db: TestDb;
const dirs: string[] = [];
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd })
    .toString()
    .trim();

beforeAll(async () => {
  db = await testDb();
});
beforeEach(async () => {
  await reset(db);
});
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function temp() {
  const dir = await mkdtemp(join(tmpdir(), 'weft-publish-session-'));
  dirs.push(dir);
  return dir;
}

async function repo() {
  const work = await temp();
  await writeFile(join(work, 'a.js'), 'export const a = 1;\n');
  git(work, 'init', '-q', '-b', 'main');
  git(work, 'add', '-A');
  git(work, 'commit', '-qm', 'base');
  const bare = await temp();
  git(bare, 'clone', '-q', '--bare', work, '.');
  const diff = async (text: string) => {
    await writeFile(join(work, 'a.js'), text);
    const out = execFileSync('git', ['diff', '--binary'], { cwd: work }).toString();
    git(work, 'checkout', '-q', '--', '.');
    return out;
  };
  return { bare, url: pathToFileURL(bare).href, diff };
}

async function finish(runId: string, outcome: CompleteRunInput) {
  const attempt = (await claimRun(db, runId, 'w'))!;
  await completeRun(db, runId, attempt, outcome);
}

async function turn(sessionId: string, message: string) {
  const added = await addTurn(db, sessionId, message);
  if (!added.ok) throw new Error('turn refused');
  return added.run;
}

const deps = () => ({ db, allowFileRepos: true });

describe('publishSession', () => {
  it('pushes each succeeded turn as a commit and remembers what it pushed', async () => {
    const { bare, url, diff } = await repo();
    const { session, run } = await createSession(db, { repoUrl: url, message: 'Make a two' });
    await finish(run.id, {
      status: 'succeeded',
      diff: await diff('export const a = 2;\n'),
      summary: 'Set a to 2\n\nmore',
    });

    const first = await publishSession(deps(), session.id);
    const saved = await getSession(db, session.id);
    expect(saved).toMatchObject({
      branch: `weft/make-a-two-${session.id.slice(0, 8)}`,
      pushedTurn: 1,
      publishError: null,
    });
    expect(saved?.pushedSha).toBe(first?.sha);
    expect(git(bare, 'log', '--format=%s|%an', saved!.branch!)).toBe('Set a to 2|weft\nbase|t');

    const second = await turn(session.id, 'Now three');
    await finish(second.id, {
      status: 'succeeded',
      diff: await diff('export const a = 3;\n'),
      summary: 'Set a to 3',
    });
    await publishSession(deps(), session.id);
    expect(git(bare, 'log', '--format=%s', saved!.branch!).split('\n')).toEqual([
      'Set a to 3',
      'Set a to 2',
      'base',
    ]);
    expect((await getSession(db, session.id))?.pushedTurn).toBe(2);
  });

  it("refuses while the latest turn's tests fail, and says why", async () => {
    const { bare, url, diff } = await repo();
    const { session, run } = await createSession(db, { repoUrl: url, message: 'Break it' });
    await finish(run.id, {
      status: 'failed',
      failureKind: 'tests_failed',
      diff: await diff('export const a = 0;\n'),
    });

    await expect(publishSession(deps(), session.id)).rejects.toThrow(
      "the latest turn's tests fail, so there is nothing to publish yet",
    );
    expect((await getSession(db, session.id))?.publishError).toMatch(/tests fail/);
    expect(git(bare, 'branch', '--list')).toBe('* main');
  });

  it('refuses repositories that are not on GitHub', async () => {
    const { url, diff } = await repo();
    const { session, run } = await createSession(db, { repoUrl: url, message: 'x' });
    await finish(run.id, { status: 'succeeded', diff: await diff('export const a = 2;\n') });

    await expect(publishSession({ db }, session.id)).rejects.toThrow(
      'only GitHub repositories can be published',
    );
  });
});
