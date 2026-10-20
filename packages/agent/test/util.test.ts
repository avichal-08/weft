import { describe, expect, it } from 'vitest';
import { headLines, relativeArg, resolveInRoot } from '../src/tools/util.ts';

describe('resolveInRoot', () => {
  it('resolves paths inside the root', () => {
    expect(resolveInRoot('/workspace', 'src/a.ts')).toBe('/workspace/src/a.ts');
    expect(resolveInRoot('/workspace', '.')).toBe('/workspace');
    expect(resolveInRoot('/workspace', './src/../lib/b.ts')).toBe('/workspace/lib/b.ts');
  });

  it('rejects paths that escape the root', () => {
    expect(resolveInRoot('/workspace', '../etc/passwd')).toBeUndefined();
    expect(resolveInRoot('/workspace', '/etc/passwd')).toBeUndefined();
    expect(resolveInRoot('/workspace', '/workspace-evil/x')).toBeUndefined();
  });
});

describe('relativeArg', () => {
  it('omits the path for the root itself so rg prints clean relative paths', () => {
    expect(relativeArg('/workspace', '/workspace')).toEqual([]);
    expect(relativeArg('/workspace', '/workspace/src')).toEqual(['src']);
  });
});

describe('headLines', () => {
  it('leaves short output alone', () => {
    expect(headLines('a\nb\n', 5, 'hint')).toBe('a\nb');
  });

  it('cuts long output and says how to narrow it', () => {
    expect(headLines('1\n2\n3\n4\n', 2, 'narrow it')).toBe(
      '1\n2\n[showing 2 of 4 lines; narrow it]',
    );
  });
});
