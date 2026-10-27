import type { Commit, Run, SessionWithTurns } from '@weft/db';
import { createMockProvider } from '@weft/llm';
import { describe, expect, it } from 'vitest';
import {
  changesSince,
  draftCommitMessage,
  fallbackMessage,
  sections,
} from '../src/commit-message.ts';

const file = (path: string, line: string) =>
  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-x\n+${line}\n`;

const session = (diffs: string[], committedTurn: number | null): SessionWithTurns =>
  ({
    turns: diffs.map((diff, i) => ({
      turn: i + 1,
      task: `ask ${i + 1}`,
      diff,
      status: 'succeeded',
    })) as Run[],
    commits: committedTurn ? ([{ turn: committedTurn, message: 'm' }] as Commit[]) : [],
  }) as SessionWithTurns;

const reply = (text: string) => createMockProvider([{ content: [{ type: 'text', text }] }]);

describe('changesSince', () => {
  it('reports files that are new, changed further, or reverted since the last commit', () => {
    const before = file('a.js', 'one') + file('b.js', 'one');
    const after = file('a.js', 'two') + file('c.js', 'one');
    expect(changesSince(before, after)).toEqual([
      { path: 'a.js', status: 'changed' },
      { path: 'c.js', status: 'added' },
      { path: 'b.js', status: 'reverted' },
    ]);
    expect([...sections(before).keys()]).toEqual(['a.js', 'b.js']);
  });
});

describe('fallbackMessage', () => {
  it('names a few files, counts many', () => {
    expect(fallbackMessage([{ path: 'a.js', status: 'added' }])).toBe('Update a.js');
    expect(
      fallbackMessage(['a', 'b', 'c', 'd'].map((path) => ({ path, status: 'added' as const }))),
    ).toBe('Update 4 files');
  });
});

describe('draftCommitMessage', () => {
  it('asks the model about only what changed since the last commit', async () => {
    const llm = reply('Add c helper');
    const s = session([file('a.js', 'one'), file('a.js', 'one') + file('c.js', 'one')], 1);
    expect(await draftCommitMessage(s, llm)).toBe('Add c helper');
    const sent = llm.calls[0]!.messages[0]!.content[0];
    const text = sent?.type === 'text' ? sent.text : '';
    expect(text).toContain('What was asked:\n- ask 2');
    expect(text).not.toContain('ask 1');
    expect(text).toContain('c.js (newly changed)');
    expect(text).not.toContain('a.js');
  });

  it('cleans up what models tend to wrap around a commit message', async () => {
    for (const [raw, clean] of [
      ['```\nAdd isBlank helper.\n```', 'Add isBlank helper'],
      ['"Subject: Add isBlank helper"', 'Add isBlank helper'],
      [
        'Add isBlank\n\nTreats whitespace-only strings as blank.',
        'Add isBlank\n\nTreats whitespace-only strings as blank.',
      ],
      [`Add ${'x'.repeat(100)}`, `Add ${'x'.repeat(68)}`],
    ] as const) {
      expect(await draftCommitMessage(session([file('a.js', 'one')], null), reply(raw))).toBe(
        clean,
      );
    }
  });

  it('falls back to naming the files when there is no model or it fails', async () => {
    const s = session([file('src/strings.js', 'one')], null);
    expect(await draftCommitMessage(s, null)).toBe('Update src/strings.js');
    const broken = createMockProvider(() => {
      throw new Error('down');
    });
    expect(await draftCommitMessage(s, broken)).toBe('Update src/strings.js');
  });
});
