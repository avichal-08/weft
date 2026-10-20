import { describe, expect, it } from 'vitest';
import { applyEdit, snippet } from '../src/tools/edit.ts';
import { clip } from '../src/tools/util.ts';

describe('applyEdit', () => {
  const src = 'const a = 1;\nconst b = 2;\nconst a2 = 1;\n';

  it('replaces a unique snippet and reports its line', () => {
    expect(applyEdit(src, 'b = 2', 'b = 3', false)).toEqual({
      ok: true,
      content: 'const a = 1;\nconst b = 3;\nconst a2 = 1;\n',
      replacements: 1,
      line: 2,
    });
  });

  it('refuses ambiguous snippets unless replace_all is set', () => {
    const edit = applyEdit(src, '= 1', '= 9', false);
    expect(edit).toMatchObject({ ok: false });
    expect(!edit.ok && edit.error).toMatch(/appears 2 times/);
    expect(applyEdit(src, '= 1', '= 9', true)).toMatchObject({
      ok: true,
      replacements: 2,
      content: 'const a = 9;\nconst b = 2;\nconst a2 = 9;\n',
    });
  });

  it('explains when the snippet is missing', () => {
    const edit = applyEdit(src, 'const  b', 'x', false);
    expect(!edit.ok && edit.error).toMatch(/not found[\s\S]*whitespace/);
  });

  it('rejects no-op edits', () => {
    expect(applyEdit(src, 'b', 'b', false)).toMatchObject({ ok: false });
  });

  it('inserts replacement text literally, including $& patterns', () => {
    const edit = applyEdit('price: X\n', 'X', '"$&" and $1', false);
    expect(edit).toMatchObject({ ok: true, content: 'price: "$&" and $1\n' });
  });
});

describe('snippet', () => {
  it('shows numbered lines around the edit', () => {
    const text = Array.from({ length: 10 }, (_, i) => `l${i + 1}`).join('\n');
    expect(snippet(text, 5, 1)).toBe('     4\tl4\n     5\tl5\n     6\tl6');
    expect(snippet(text, 1, 1)).toBe('     1\tl1\n     2\tl2');
  });
});

describe('clip', () => {
  it('keeps the start and the longer end', () => {
    const out = clip('a'.repeat(100) + 'END', 30);
    expect(out.startsWith('a'.repeat(10))).toBe(true);
    expect(out.endsWith('END')).toBe(true);
    expect(out).toContain('characters omitted');
  });

  it('leaves short text alone', () => {
    expect(clip('short', 30)).toBe('short');
  });
});
