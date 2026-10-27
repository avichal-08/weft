import { addTurn, claimRun, completeRun, createSession, getSession, recordPush } from '@weft/db';
import { reset, testDb, type TestDb } from '@weft/db/testing';
import type { NewPullRequest } from '@weft/github';
import { createMockProvider } from '@weft/llm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { followUpPublish, handlePublish, type GitHub } from '../src/publish-job.ts';

let db: TestDb;
const repoUrl = 'https://github.com/avichal-08/weft-playground';

beforeAll(async () => {
  db = await testDb();
});
beforeEach(async () => {
  await reset(db);
});

async function chat(diff = 'diff --git a/a b/a\n', status: 'succeeded' | 'failed' = 'succeeded') {
  const { session, run } = await createSession(db, {
    repoUrl,
    message: 'Fix the cache',
    testCommand: 'npm test',
  });
  const attempt = (await claimRun(db, run.id, 'w'))!;
  await completeRun(db, run.id, attempt, { status, diff, summary: 'Fixed the cache.' });
  return { session, run };
}

function fakeGitHub(existing: number | null = null) {
  const opened: NewPullRequest[] = [];
  const github: GitHub = {
    token: () => Promise.resolve('ghs_x'),
    identity: () => Promise.resolve({ name: 'bot', email: 'bot@x' }),
    defaultBranch: () => Promise.resolve('main'),
    findPullRequest: () =>
      Promise.resolve(
        existing ? { number: existing, url: `https://github.com/pull/${existing}` } : null,
      ),
    openPullRequest: (_ref, pr) => {
      opened.push(pr);
      return Promise.resolve({
        number: 12,
        url: 'https://github.com/avichal-08/weft-playground/pull/12',
      });
    },
  };
  return { github, opened };
}

const asked: (string | undefined)[] = [];
const statesAfterPush: (string | null | undefined)[] = [];
const pushes =
  (fallback: string) =>
  async (_deps: unknown, sessionId: string, opts: { branch?: string } = {}) => {
    asked.push(opts.branch);
    const branch = opts.branch ?? fallback;
    await recordPush(db, sessionId, { branch, pushedTurn: 1, pushedSha: 'abc' });
    statesAfterPush.push((await getSession(db, sessionId))?.publishState);
    return { sha: 'abc', pushedTurn: 1 };
  };

describe('handlePublish', () => {
  it('pushes, then opens a pull request against the default branch and remembers it', async () => {
    const { session } = await chat();
    const { github, opened } = fakeGitHub();
    const llm = createMockProvider([
      { content: [{ type: 'text', text: 'Refresh LRU recency on get\n\n- Refresh on get' }] },
    ]);

    await handlePublish(
      { db, github, createLLM: () => llm, publish: pushes('weft/fix-the-cache-1') },
      { sessionId: session.id, turn: 1, openPullRequest: true },
    );

    const branch = `weft/refresh-lru-recency-on-get-${session.id.slice(0, 8)}`;
    expect(asked.at(-1)).toBe(branch);
    expect(opened).toEqual([
      expect.objectContaining({ head: branch, base: 'main', title: 'Refresh LRU recency on get' }),
    ]);
    expect(llm.calls).toHaveLength(1);
    expect(statesAfterPush.at(-1)).toBe('pushing');
    expect(await getSession(db, session.id)).toMatchObject({
      publishState: 'pushed',
      prNumber: 12,
      prUrl: 'https://github.com/avichal-08/weft-playground/pull/12',
    });
  });

  it('reuses an open pull request for the branch instead of opening a second one', async () => {
    const { session } = await chat();
    const { github, opened } = fakeGitHub(5);
    await handlePublish(
      { db, github, publish: pushes('weft/x-1') },
      { sessionId: session.id, turn: 1, openPullRequest: true },
    );
    expect(opened).toEqual([]);
    expect((await getSession(db, session.id))?.prNumber).toBe(5);
  });

  it('records why it failed instead of throwing', async () => {
    const { session } = await chat('diff --git a/a b/a\n', 'failed');
    await handlePublish(
      { db, github: fakeGitHub().github },
      { sessionId: session.id, turn: 1, openPullRequest: true },
    );
    expect(await getSession(db, session.id)).toMatchObject({
      publishState: 'failed',
      prNumber: null,
    });
  });
});

describe('followUpPublish', () => {
  it('pushes later succeeded turns only once the chat has a pull request', async () => {
    const { session, run } = await chat();
    expect(await followUpPublish(db, run.id)).toBeNull();

    await handlePublish(
      { db, github: fakeGitHub().github, publish: pushes('weft/x-1') },
      { sessionId: session.id, turn: 1, openPullRequest: true },
    );
    const next = await addTurn(db, session.id, 'More');
    if (!next.ok) throw new Error('refused');
    const attempt = (await claimRun(db, next.run.id, 'w'))!;
    await completeRun(db, next.run.id, attempt, {
      status: 'succeeded',
      diff: 'diff --git a/b b/b\n',
    });

    expect(await followUpPublish(db, next.run.id)).toEqual({
      sessionId: session.id,
      turn: 2,
      openPullRequest: false,
    });
  });
});
