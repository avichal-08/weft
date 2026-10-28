import { describe, expect, it } from 'vitest';
import { blocking, checkDiff, parseDiff, rewrittenTestLines } from '../src/index.ts';

const fake = (prefix: string, n: number, ch = 'a') => prefix + ch.repeat(n);

function change(path: string, removed: string[], added: string[], start = 1) {
  return [
    `diff --git a/${path} b/${path}`,
    'index 1111111..2222222 100644',
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${start},${removed.length} +${start},${added.length} @@`,
    ...removed.map((l) => `-${l}`),
    ...added.map((l) => `+${l}`),
  ].join('\n');
}

function created(path: string, lines: string[]) {
  return [
    `diff --git a/${path} b/${path}`,
    'new file mode 100644',
    'index 0000000..2222222',
    '--- /dev/null',
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((l) => `+${l}`),
  ].join('\n');
}

describe('parseDiff', () => {
  it('reads paths, new files, line numbers and binary sizes', () => {
    const diff = [
      created('src/a.js', ['one', 'two']),
      [
        'diff --git a/src/b.js b/src/b.js',
        'index 1111111..2222222 100644',
        '--- a/src/b.js',
        '+++ b/src/b.js',
        '@@ -10,3 +10,3 @@ function x() {',
        ' keep',
        '-old',
        '+new',
        ' keep',
      ].join('\n'),
      [
        'diff --git a/logo.png b/logo.png',
        'new file mode 100644',
        'index 0000000..3333333',
        'GIT binary patch',
        'literal 2048',
        'zcmeAS@N?(olHy`uVBq!ia0vp^',
        '',
        'literal 0',
        'HcmV?d00001',
      ].join('\n'),
    ].join('\n');
    const [a, b, png] = parseDiff(diff);
    expect(a).toMatchObject({
      path: 'src/a.js',
      added: true,
      addedLines: [{ line: 1 }, { line: 2 }],
    });
    expect(b).toMatchObject({
      path: 'src/b.js',
      added: false,
      addedLines: [{ line: 11, text: 'new' }],
      removedLines: ['old'],
    });
    expect(png).toMatchObject({ path: 'logo.png', binary: true, bytes: 2048, addedLines: [] });
  });
});

describe('checkDiff', () => {
  it('passes an ordinary change', () => {
    expect(checkDiff(change('src/math.js', ['  return a - b;'], ['  return a + b;']))).toEqual([]);
    expect(checkDiff('')).toEqual([]);
  });

  it('blocks added lines that look like secrets, saying where without repeating them', () => {
    const tokens = [
      fake('AKIA', 16, 'Q'),
      fake('ghp_', 36),
      fake('github_pat_', 60),
      ['-----BEGIN', 'RSA', 'PRIVATE', 'KEY-----'].join(' '),
      fake('xoxb-', 20, '1'),
      fake('sk_live_', 24),
      fake('AIza', 35),
      fake('sk-ant-api03-', 40),
      fake('sk-proj-', 48),
    ];
    for (const token of tokens) {
      const [finding, ...rest] = checkDiff(
        change('src/config.js', [], [`const key = '${token}';`], 12),
      );
      expect(rest, token).toEqual([]);
      expect(finding, token).toMatchObject({
        kind: 'secret',
        severity: 'block',
        file: 'src/config.js',
        line: 12,
      });
      expect(finding!.message).not.toContain(token);
    }
  });

  it('ignores secrets that are only removed, and look-alikes', () => {
    expect(
      checkDiff(change('src/config.js', [`k = '${fake('ghp_', 36)}'`], ['k = env.KEY'])),
    ).toEqual([]);
    expect(checkDiff(created('src/a.js', ['const task = "ask-question";', 'AKIA']))).toEqual([]);
  });

  it('blocks environment files but not templates', () => {
    expect(checkDiff(created('.env', ['DEBUG=1']))).toMatchObject([
      { kind: 'secret', severity: 'block', file: '.env' },
    ]);
    expect(checkDiff(created('apps/api/.env.local', ['X=1']))).toHaveLength(1);
    expect(checkDiff(created('.env.example', ['X=']))).toEqual([]);
  });

  it('blocks workflow changes, which the app cannot push', () => {
    expect(checkDiff(created('.github/workflows/ci.yml', ['on: push']))).toMatchObject([
      { kind: 'workflow', severity: 'block' },
    ]);
    expect(checkDiff(created('.github/CODEOWNERS', ['* @me']))).toEqual([]);
  });

  it('warns when existing test lines are rewritten, not when tests are added', () => {
    const weakened = change(
      'test/money.test.js',
      ['  assert.equal(total, 5);'],
      ['  assert.equal(total, 6);'],
    );
    expect(checkDiff(weakened)).toMatchObject([
      { kind: 'test_rewrite', severity: 'warn', file: 'test/money.test.js' },
    ]);
    expect(blocking(checkDiff(weakened))).toEqual([]);

    const extended = change(
      'src/strings.spec.ts',
      ["import { capitalize } from './strings';"],
      ["import { capitalize, isBlank } from './strings';", "it('isBlank', () => {});"],
    );
    expect(checkDiff(extended)).toEqual([]);
    expect(checkDiff(created('test/new.test.js', ['it("x", () => {});']))).toEqual([]);
  });

  it('warns about large files', () => {
    const big = created('data/dump.json', ['x'.repeat(1_200_000)]);
    expect(checkDiff(big)).toMatchObject([{ kind: 'large_file', severity: 'warn' }]);
  });
});

describe('rewrittenTestLines', () => {
  const diff = (removed: string, added: string[]) => change('test/x.test.js', [removed], added);

  it('ignores lines that were only extended', () => {
    expect(
      rewrittenTestLines(
        diff("import { capitalize } from '../src/strings.js';", [
          "import { capitalize, isBlank } from '../src/strings.js';",
        ]),
      ),
    ).toBe(0);
    expect(
      rewrittenTestLines(diff('  assert.equal(total, 5);', ["  assert.equal(total, 5, 'sum');"])),
    ).toBe(0);
    expect(rewrittenTestLines('')).toBe(0);
  });

  it('counts changed, deleted, commented-out and skipped tests', () => {
    expect(
      rewrittenTestLines(diff('  assert.equal(total, 5);', ['  assert.equal(total, 6);'])),
    ).toBe(1);
    expect(rewrittenTestLines(diff('  assert.equal(total, 5);', []))).toBe(1);
    expect(
      rewrittenTestLines(diff('  assert.equal(total, 5);', ['  // assert.equal(total, 5);'])),
    ).toBe(1);
    expect(rewrittenTestLines(diff("it('adds', () => {", ["it.skip('adds', () => {"]))).toBe(1);
  });
});
