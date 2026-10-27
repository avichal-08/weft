import type { Run, SessionWithTurns } from '@weft/db';
import { createMockProvider } from '@weft/llm';
import { describe, expect, it } from 'vitest';
import { changedFiles, describePullRequest } from '../src/pull-request.ts';

const diff =
  'diff --git a/src/lru.js b/src/lru.js\n--- a/src/lru.js\n+++ b/src/lru.js\n@@ -1 +1 @@\n-a\n+b\n';
const session = (testCommand: string | null): SessionWithTurns =>
  ({
    title: 'The cache evicts entries I just read',
    testCommand,
    turns: [
      {
        task: 'Why does it evict recent reads?',
        summary: 'get() never refreshes recency.',
        status: 'succeeded',
        diff: '',
      },
      {
        task: 'Fix it',
        summary: 'Made get() move the entry to the newest slot.\n\nDetails…',
        status: 'succeeded',
        diff,
      },
    ] as Run[],
  }) as SessionWithTurns;

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

describe('describePullRequest', () => {
  it("uses the model's title and body, and ends with weft's own test note", async () => {
    const llm = createMockProvider([
      text('Refresh LRU recency on get\n\n- `get()` now moves the entry to the front'),
    ]);
    const pr = await describePullRequest(session('npm test'), llm);
    expect(pr.title).toBe('Refresh LRU recency on get');
    expect(pr.body).toBe(
      '- `get()` now moves the entry to the front\n\n---\nTests: `npm test` passed in a clean sandbox for the latest change.\n\nOpened by weft from a chat of 2 turns.',
    );
    expect(llm.calls[0]!.messages[0]!.content).toEqual([
      expect.objectContaining({
        text: expect.stringContaining('Files changed: src/lru.js') as string,
      }),
    ]);
  });

  it('falls back to a template when the model fails or replies with nothing usable', async () => {
    for (const llm of [
      createMockProvider([text('only a title')]),
      createMockProvider(() => {
        throw new Error('down');
      }),
      null,
    ]) {
      const pr = await describePullRequest(session(null), llm);
      expect(pr.title).toBe('The cache evicts entries I just read');
      expect(pr.body).toContain(
        '- get() never refreshes recency.\n- Made get() move the entry to the newest slot.',
      );
      expect(pr.body).toContain('Files: `src/lru.js`');
      expect(pr.body).toContain(
        'No test command is set for this repository, so these changes were not verified by tests.',
      );
    }
  });

  it('strips markdown heading marks and keeps titles short', async () => {
    const llm = createMockProvider([text(`# ${'x'.repeat(100)}\n\nbody`)]);
    expect((await describePullRequest(session(null), llm)).title).toBe('x'.repeat(70));
  });
});

describe('changedFiles', () => {
  it('lists each changed file once', () => {
    expect(changedFiles(diff + diff)).toEqual(['src/lru.js']);
  });
});
