import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { authEnv, branchName, publishCommits, type PublishInput } from '../src/publish.ts';

const dirs: string[] = [];
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd })
    .toString()
    .trim();

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function temp() {
  const dir = await mkdtemp(join(tmpdir(), 'weft-publish-test-'));
  dirs.push(dir);
  return dir;
}

async function setup() {
  const work = await temp();
  await writeFile(join(work, 'a.js'), 'export const a = 1;\n');
  git(work, 'init', '-q', '-b', 'main');
  git(work, 'add', '-A');
  git(work, 'commit', '-qm', 'base');
  const bare = await temp();
  git(bare, 'clone', '-q', '--bare', work, '.');

  const states: Record<string, string>[] = [];
  const diffAfter = async (files: Record<string, string>) => {
    states.push(files);
    for (const [path, text] of Object.entries(files)) await writeFile(join(work, path), text);
    git(work, 'add', '-A');
    const diff = execFileSync('git', ['diff', '--cached', '--binary'], { cwd: work }).toString();
    git(work, 'reset', '-q', '--hard', 'HEAD');
    git(work, 'clean', '-qfd');
    return diff;
  };

  const base: Omit<PublishInput, 'commits' | 'pushedDiff'> = {
    repoUrl: pathToFileURL(bare).href,
    baseRef: 'main',
    branch: 'weft/fix-a-1a2b3c4d',
    token: null,
    author: { name: 'weft-test[bot]', email: '1+weft-test[bot]@users.noreply.github.com' },
  };
  return { bare, base, diffAfter };
}

const log = (bare: string, ref: string) => git(bare, 'log', '--format=%s|%an|%ae', ref).split('\n');
const changed = (bare: string, ref: string) => git(bare, 'show', '--name-only', '--format=', ref);

describe('publishCommits', () => {
  it('pushes a new branch with one git commit per saved commit, each holding only its own changes', async () => {
    const { bare, base, diffAfter } = await setup();
    const one = await diffAfter({ 'a.js': 'export const a = 2;\n' });
    const two = await diffAfter({
      'a.js': 'export const a = 2;\n',
      'b.js': 'export const b = 1;\n',
    });

    const result = await publishCommits({
      ...base,
      pushedDiff: null,
      commits: [
        { id: 'c1', diff: one, message: 'Set a to 2' },
        { id: 'c2', diff: two, message: 'Add b' },
      ],
    });

    const head = git(bare, 'rev-parse', base.branch);
    expect(result).toEqual({
      sha: head,
      commits: [
        { id: 'c1', sha: git(bare, 'rev-parse', `${base.branch}~1`) },
        { id: 'c2', sha: head },
      ],
    });
    expect(log(bare, base.branch)).toEqual([
      'Add b|weft-test[bot]|1+weft-test[bot]@users.noreply.github.com',
      'Set a to 2|weft-test[bot]|1+weft-test[bot]@users.noreply.github.com',
      'base|t|t@t',
    ]);
    expect(changed(bare, base.branch)).toBe('b.js');
    expect(changed(bare, `${base.branch}~1`)).toBe('a.js');
    expect(git(bare, 'rev-parse', `${base.branch}~2`)).toBe(git(bare, 'rev-parse', 'main'));
  });

  it('adds later commits on top of what was pushed, without rewriting history', async () => {
    const { bare, base, diffAfter } = await setup();
    const one = await diffAfter({ 'a.js': 'export const a = 2;\n' });
    const two = await diffAfter({ 'a.js': 'export const a = 3;\n' });
    const first = await publishCommits({
      ...base,
      pushedDiff: null,
      commits: [{ id: 'c1', diff: one, message: 'Set a to 2' }],
    });

    const second = await publishCommits({
      ...base,
      pushedDiff: one,
      commits: [{ id: 'c2', diff: two, message: 'Set a to 3' }],
    });

    expect(second?.commits.map((c) => c.id)).toEqual(['c2']);
    expect(git(bare, 'rev-parse', `${base.branch}~1`)).toBe(first!.sha);
    expect(git(bare, 'show', `${base.branch}:a.js`)).toBe('export const a = 3;');
  });

  it('makes no empty git commit for a commit that changed nothing, and pushes nothing without changes', async () => {
    const { bare, base, diffAfter } = await setup();
    const one = await diffAfter({ 'a.js': 'export const a = 2;\n' });

    const result = await publishCommits({
      ...base,
      pushedDiff: null,
      commits: [
        { id: 'c1', diff: one, message: 'Set a to 2' },
        { id: 'c2', diff: one, message: 'Same again' },
      ],
    });
    expect(result?.commits.map((c) => c.sha)).toEqual([result!.sha, result!.sha]);
    expect(log(bare, base.branch)).toHaveLength(2);

    expect(await publishCommits({ ...base, pushedDiff: one, commits: [] })).toBeNull();
    const before = git(bare, 'rev-parse', base.branch);
    await publishCommits({
      ...base,
      pushedDiff: one,
      commits: [{ id: 'c3', diff: one, message: 'x' }],
    });
    expect(git(bare, 'rev-parse', base.branch)).toBe(before);
  });

  it('builds on top of commits someone else pushed to the branch, never over them', async () => {
    const { bare, base, diffAfter } = await setup();
    const one = await diffAfter({ 'a.js': 'export const a = 2;\n' });
    const two = await diffAfter({ 'a.js': 'export const a = 3;\n' });
    await publishCommits({
      ...base,
      pushedDiff: null,
      commits: [{ id: 'c1', diff: one, message: 'one' }],
    });

    const other = await temp();
    git(other, 'clone', '-q', '--branch', base.branch, base.repoUrl, '.');
    await writeFile(join(other, 'c.js'), 'export const c = 1;\n');
    git(other, 'add', '-A');
    git(other, 'commit', '-qm', 'someone else');
    git(other, 'push', '-q', 'origin', base.branch);
    const theirs = git(bare, 'rev-parse', base.branch);

    await publishCommits({
      ...base,
      pushedDiff: one,
      commits: [{ id: 'c2', diff: two, message: 'two' }],
    });

    expect(git(bare, 'rev-parse', `${base.branch}~1`)).toBe(theirs);
    expect(git(bare, 'show', `${base.branch}:c.js`)).toBe('export const c = 1;');
    expect(git(bare, 'show', `${base.branch}:a.js`)).toBe('export const a = 3;');
  });

  it('fails clearly when the pushed changes were edited by someone else', async () => {
    const { bare, base, diffAfter } = await setup();
    const one = await diffAfter({ 'a.js': 'export const a = 2;\n' });
    const two = await diffAfter({ 'a.js': 'export const a = 3;\n' });
    await publishCommits({
      ...base,
      pushedDiff: null,
      commits: [{ id: 'c1', diff: one, message: 'one' }],
    });

    const other = await temp();
    git(other, 'clone', '-q', '--branch', base.branch, base.repoUrl, '.');
    await writeFile(join(other, 'a.js'), 'export const a = 99;\n');
    git(other, 'commit', '-qam', 'someone else edits a');
    git(other, 'push', '-q', 'origin', base.branch);
    const theirs = git(bare, 'rev-parse', base.branch);

    await expect(
      publishCommits({
        ...base,
        pushedDiff: one,
        commits: [{ id: 'c2', diff: two, message: 'two' }],
      }),
    ).rejects.toThrow(/^git apply failed/);
    expect(git(bare, 'rev-parse', base.branch)).toBe(theirs);
  });
});

describe('authEnv', () => {
  it('hands git the token as an extra header through the environment, scoped to github.com', () => {
    expect(authEnv(null)).toEqual({});
    const env = authEnv('ghs_secret');
    expect(env).toEqual({
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from('x-access-token:ghs_secret').toString('base64')}`,
    });
  });
});

describe('branchName', () => {
  it('makes a readable, git-safe branch per chat', () => {
    expect(branchName('Fix the LRU cache: evicts recent reads!', '1a2b3c4d-0000')).toBe(
      'weft/fix-the-lru-cache-evicts-recent-reads-1a2b3c4d',
    );
    expect(branchName('???', 'abcdef12-0000')).toBe('weft/abcdef12');
    expect(branchName('a'.repeat(80), '1a2b3c4d-0000')).toBe(`weft/${'a'.repeat(40)}-1a2b3c4d`);
    expect(
      branchName(
        'Add a new function capitalize(text) to src/strings.js that upper-cases',
        '2510dee0-0',
      ),
    ).toBe('weft/add-a-new-function-capitalize-text-to-2510dee0');
    expect(branchName('Add capitalize string utility function', '2510dee0-0')).toBe(
      'weft/add-capitalize-string-utility-function-2510dee0',
    );
  });
});
