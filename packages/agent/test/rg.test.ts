import { describe, expect, it } from 'vitest';
import { formatLines, nullSeparated, pathMatcher } from '../src/tools/rg.ts';

describe('pathMatcher', () => {
  it('matches patterns without a slash against the file name anywhere', () => {
    const m = pathMatcher('*.ts', '');
    expect(m('src/deep/a.ts')).toBe(true);
    expect(m('src/a.js')).toBe(false);
  });

  it('matches path patterns relative to the search directory', () => {
    expect(pathMatcher('utils/*.ts', 'src')('src/utils/a.ts')).toBe(true);
    expect(pathMatcher('**/*.test.ts', '')('test/a.test.ts')).toBe(true);
  });

  it('does not match slash patterns against the bare file name', () => {
    expect(pathMatcher('src/*', '')('src/server.ts')).toBe(true);
    expect(pathMatcher('src/*', '')('lib/src/x.ts')).toBe(false);
  });

  it('includes dotfiles', () => {
    expect(pathMatcher('**/*.yml', '')('.github/workflows/ci.yml')).toBe(true);
  });

  it('falls back to the file name when the search path is the file itself', () => {
    expect(pathMatcher('*.ts', 'src/a.ts')('src/a.ts')).toBe(true);
  });
});

describe('nullSeparated', () => {
  it('splits rg --null file lists', () => {
    expect(nullSeparated('a.ts\0dir/b:c.ts\0')).toEqual(['a.ts', 'dir/b:c.ts']);
  });
});

describe('formatLines', () => {
  const out = 'a.ts\x001-before\na.ts\x002:match\n--\nb.js\x009:other\n';

  it('rebuilds rg output from --null lines', () => {
    expect(formatLines(out, () => true)).toEqual([
      'a.ts-1-before',
      'a.ts:2:match',
      '--',
      'b.js:9:other',
    ]);
  });

  it('filters by path and drops dangling separators', () => {
    expect(formatLines(out, (p) => p.endsWith('.ts'))).toEqual(['a.ts-1-before', 'a.ts:2:match']);
  });

  it('keeps paths containing colons and dashes intact', () => {
    expect(formatLines('my-dir/a:b.ts\x003:x\n', () => true)).toEqual(['my-dir/a:b.ts:3:x']);
  });

  it('formats count output', () => {
    expect(formatLines('src/a.ts\x004\n', () => true)).toEqual(['src/a.ts:4']);
  });
});
