import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { cases, type EvalCase, type Fixture } from '../eval/cases.ts';

const fixtures: Record<Fixture, string> = {
  shop: fileURLToPath(new URL('../fixtures/shop', import.meta.url)),
  playground: fileURLToPath(new URL('../fixtures/playground', import.meta.url)),
};
const all = cases((fixture, path) => readFileSync(join(fixtures[fixture], path), 'utf8'));
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function workspace(c: EvalCase, extra: Record<string, string> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'weft-eval-case-'));
  dirs.push(dir);
  await cp(fixtures[c.fixture ?? 'shop'], dir, { recursive: true });
  for (const [path, content] of Object.entries({ ...c.seed, ...c.prior, ...c.hidden, ...extra })) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  return dir;
}

function hiddenPass(dir: string, c: EvalCase): boolean {
  try {
    execFileSync('node', ['--test', ...Object.keys(c.hidden!)], { cwd: dir, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

const byName = (name: string) => all.find((c) => c.name === name)!;

const reference: Record<string, (dir: string) => Promise<Record<string, string>>> = {
  'pg-feat-isblank': async (dir) => ({
    'src/strings.js': `${await readFile(join(dir, 'src/strings.js'), 'utf8')}\nexport function isBlank(text) {\n  return text.trim() === '';\n}\n`,
    'src/index.js': (await readFile(join(dir, 'src/index.js'), 'utf8')).replace(
      'capitalize }',
      'capitalize, isBlank }',
    ),
  }),
  'pg-feat-clamp': async (dir) => ({
    'src/number.js': `export function clamp(value, min, max) {\n  if (min > max) throw new RangeError('min > max');\n  return Math.min(Math.max(value, min), max);\n}\n`,
    'src/index.js': `${await readFile(join(dir, 'src/index.js'), 'utf8')}export { clamp } from './number.js';\n`,
  }),
  'pg-feat-weeks': async (dir) => ({
    'src/duration.js': (await readFile(join(dir, 'src/duration.js'), 'utf8'))
      .replace('d: 86_400_000 }', 'd: 86_400_000, w: 604_800_000 }')
      .replace('(ms|s|m|h|d)', '(ms|s|m|h|d|w)'),
  }),
};

describe('eval cases', () => {
  it('have unique names and a known category', () => {
    expect(new Set(all.map((c) => c.name)).size).toBe(all.length);
    expect(all.length).toBe(17);
  });

  it('seed a real change into the fixture', () => {
    for (const c of all.filter((c) => c.seed)) {
      for (const [path, content] of Object.entries(c.seed!)) {
        expect(content, `${c.name} ${path}`).not.toBe(
          readFileSync(join(fixtures[c.fixture ?? 'shop'], path), 'utf8'),
        );
      }
    }
  });

  it('start with hidden tests failing, so the agent has to do the work', async () => {
    for (const c of all.filter((c) => c.hidden)) {
      expect(hiddenPass(await workspace(c), c), c.name).toBe(false);
    }
  });

  it('have hidden tests a correct fix passes', async () => {
    for (const name of ['pg-fix-lru', 'pg-fix-proto']) {
      const c = byName(name);
      const fixed = Object.fromEntries(
        Object.keys(c.seed!).map((p) => [p, readFileSync(join(fixtures.playground, p), 'utf8')]),
      );
      expect(hiddenPass(await workspace(c, fixed), c), name).toBe(true);
    }
    for (const [name, solve] of Object.entries(reference)) {
      const c = byName(name);
      const dir = await workspace(c);
      expect(hiddenPass(await workspace(c, await solve(dir)), c), name).toBe(true);
    }
  });

  it('keep the playground fixture green, so a broken test means a broken change', () => {
    expect(() =>
      execFileSync('node', ['--test'], { cwd: fixtures.playground, stdio: 'pipe' }),
    ).not.toThrow();
  });
});
