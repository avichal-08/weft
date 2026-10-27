import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export class PublishError extends Error {
  override name = 'PublishError';
}

export type PublishCommit = { id: string; diff: string; message: string };

export type PublishInput = {
  repoUrl: string;
  baseRef: string | null;
  branch: string;
  pushedDiff: string | null;
  commits: PublishCommit[];
  token: string | null;
  author: { name: string; email: string };
};

export type PublishResult = { sha: string; commits: { id: string; sha: string }[] } | null;

const GIT_TIMEOUT_MS = 120_000;

export function authEnv(token: string | null): Record<string, string> {
  if (!token) return {};
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
  };
}

function git(
  args: string[],
  opts: { cwd?: string; env?: Record<string, string>; input?: string } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: opts.cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...opts.env },
      timeout: GIT_TIMEOUT_MS,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', reject);
    child.stdin.on('error', () => {});
    child.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new PublishError(`git ${args[0]} failed: ${stderr.trim() || `exit ${code}`}`));
    });
    child.stdin.end(opts.input ?? '');
  });
}

export function branchName(title: string, sessionId: string): string {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const head = words.slice(0, 41);
  const slug =
    words.length <= 40
      ? words
      : head.includes('-')
        ? head.replace(/-[^-]*$/, '')
        : head.slice(0, 40);
  return `weft/${slug ? `${slug}-` : ''}${sessionId.slice(0, 8)}`;
}

export async function publishCommits(input: PublishInput): Promise<PublishResult> {
  if (input.commits.length === 0) return null;

  const dir = await mkdtemp(join(tmpdir(), 'weft-publish-'));
  const env = authEnv(input.token);
  try {
    const from = input.pushedDiff === null ? input.baseRef : input.branch;
    await git(
      [
        'clone',
        '--quiet',
        '--depth',
        '1',
        ...(from ? ['--branch', from] : []),
        '--',
        input.repoUrl,
        dir,
      ],
      { env },
    );
    const identity = [
      '-c',
      `user.name=${input.author.name}`,
      '-c',
      `user.email=${input.author.email}`,
    ];
    let applied = input.pushedDiff ?? '';
    let made = 0;
    const shas: { id: string; sha: string }[] = [];
    for (const commit of input.commits) {
      if (applied)
        await git(['apply', '-R', '--whitespace=nowarn', '-'], { cwd: dir, input: applied });
      if (commit.diff)
        await git(['apply', '--whitespace=nowarn', '-'], { cwd: dir, input: commit.diff });
      applied = commit.diff;
      await git(['add', '-A'], { cwd: dir });
      if (await git(['status', '--porcelain'], { cwd: dir })) {
        await git([...identity, 'commit', '--quiet', '-m', commit.message], { cwd: dir });
        made++;
      }
      shas.push({ id: commit.id, sha: await git(['rev-parse', 'HEAD'], { cwd: dir }) });
    }
    if (made > 0) {
      await git(['push', '--quiet', 'origin', `HEAD:refs/heads/${input.branch}`], {
        cwd: dir,
        env,
      });
    }
    return { sha: shas.at(-1)!.sha, commits: shas };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
