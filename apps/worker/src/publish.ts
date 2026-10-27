import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export class PublishError extends Error {
  override name = 'PublishError';
}

export type PublishTurn = { turn: number; diff: string; message: string };

export type PublishInput = {
  repoUrl: string;
  baseRef: string | null;
  branch: string;
  pushedDiff: string | null;
  turns: PublishTurn[];
  token: string | null;
  author: { name: string; email: string };
};

export type PublishResult = { sha: string; pushedTurn: number } | null;

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
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return `weft/${slug ? `${slug}-` : ''}${sessionId.slice(0, 8)}`;
}

export async function publishTurns(input: PublishInput): Promise<PublishResult> {
  let previous = input.pushedDiff ?? '';
  const pending = input.turns.filter((t) => {
    if (t.diff === previous) return false;
    previous = t.diff;
    return true;
  });
  if (pending.length === 0) return null;

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
    let committed: number | undefined;
    for (const turn of pending) {
      if (applied)
        await git(['apply', '-R', '--whitespace=nowarn', '-'], { cwd: dir, input: applied });
      if (turn.diff)
        await git(['apply', '--whitespace=nowarn', '-'], { cwd: dir, input: turn.diff });
      applied = turn.diff;
      await git(['add', '-A'], { cwd: dir });
      if (!(await git(['status', '--porcelain'], { cwd: dir }))) continue;
      await git([...identity, 'commit', '--quiet', '-m', turn.message], { cwd: dir });
      committed = turn.turn;
    }
    if (committed === undefined) return null;
    await git(['push', '--quiet', 'origin', `HEAD:refs/heads/${input.branch}`], { cwd: dir, env });
    return { sha: await git(['rev-parse', 'HEAD'], { cwd: dir }), pushedTurn: committed };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
