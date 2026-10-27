import { describe, expect, it } from 'vitest';
import { summarizeFiles } from '../src/overview.ts';

describe('summarizeFiles', () => {
  it('names the languages by file count, the top level, and the useful scripts', () => {
    const files = [
      'package.json',
      '.gitignore',
      'src/a.js',
      'src/b.js',
      'src/c.ts',
      'test/a.test.js',
      'README.md',
    ];
    const pkg = JSON.stringify({
      scripts: { test: 'node --test', start: 'node .', lint: 'eslint .' },
    });
    expect(summarizeFiles(files, pkg)).toBe(
      [
        '- 7 files. By extension: .js 3, .json 1, (none) 1, .ts 1, .md 1',
        '- Top level: src/ (3 files), test/ (1 files), package.json, .gitignore, README.md',
        '- package.json scripts: test: node --test; lint: eslint .',
      ].join('\n'),
    );
  });

  it('skips scripts when package.json is missing or broken, and caps long listings', () => {
    const files = Array.from({ length: 20 }, (_, i) => `f${i}.py`);
    const out = summarizeFiles(files, '{oops');
    expect(out).toContain('- 20 files. By extension: .py 20');
    expect(out).toMatch(/Top level: (f\d+\.py, ){11}f\d+\.py, …$/);
    expect(out).not.toContain('scripts');
  });
});
