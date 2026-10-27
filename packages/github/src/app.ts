import { appJwt } from './jwt.ts';
import type { RepoRef } from './repo.ts';

export type GitHubAppConfig = {
  appId: string;
  privateKey: string;
  apiUrl?: string;
  fetch?: typeof fetch;
  now?: () => number;
};

export type InstallationToken = { token: string; expiresAt: number };

export type Identity = { name: string; email: string };

export type PullRequest = { number: number; url: string };

export type NewPullRequest = { head: string; base: string; title: string; body: string };

export class GitHubError extends Error {
  override name = 'GitHubError';
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export class NotInstalledError extends GitHubError {
  override name = 'NotInstalledError';
}

const REFRESH_BEFORE_MS = 5 * 60_000;
const PERMISSIONS = { contents: 'write', pull_requests: 'write' };

export function githubApp(config: GitHubAppConfig) {
  const api = config.apiUrl ?? 'https://api.github.com';
  const http = config.fetch ?? fetch;
  const now = config.now ?? Date.now;
  const tokens = new Map<string, InstallationToken>();
  let bot: Promise<Identity> | undefined;

  async function call<T>(
    method: string,
    path: string,
    auth: string | null,
    body?: unknown,
  ): Promise<T> {
    const res = await http(`${api}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        ...(auth ? { authorization: auth } : {}),
        'x-github-api-version': '2022-11-28',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    if (!res.ok) {
      const message = (JSON.parse(text || '{}') as { message?: string }).message ?? res.statusText;
      throw new GitHubError(`${method} ${path} failed (${res.status}): ${message}`, res.status);
    }
    return JSON.parse(text) as T;
  }

  const asApp = () => `Bearer ${appJwt(config.appId, config.privateKey, now())}`;

  async function installationId({ owner, repo }: RepoRef): Promise<number> {
    try {
      const { id } = await call<{ id: number }>(
        'GET',
        `/repos/${owner}/${repo}/installation`,
        asApp(),
      );
      return id;
    } catch (err) {
      if (err instanceof GitHubError && err.status === 404) {
        throw new NotInstalledError(
          `the weft GitHub App is not installed on ${owner}/${repo}; install it on that repository first`,
          404,
        );
      }
      throw err;
    }
  }

  async function token(ref: RepoRef): Promise<string> {
    const key = `${ref.owner}/${ref.repo}`.toLowerCase();
    const cached = tokens.get(key);
    if (cached && cached.expiresAt - REFRESH_BEFORE_MS > now()) return cached.token;
    const id = await installationId(ref);
    const res = await call<{ token: string; expires_at: string }>(
      'POST',
      `/app/installations/${id}/access_tokens`,
      asApp(),
      { repositories: [ref.repo], permissions: PERMISSIONS },
    );
    tokens.set(key, { token: res.token, expiresAt: Date.parse(res.expires_at) });
    return res.token;
  }

  const asRepo = async (ref: RepoRef) => `token ${await token(ref)}`;

  return {
    installationId,
    token,

    async defaultBranch(ref: RepoRef): Promise<string> {
      const repo = await call<{ default_branch: string }>(
        'GET',
        `/repos/${ref.owner}/${ref.repo}`,
        await asRepo(ref),
      );
      return repo.default_branch;
    },

    async findPullRequest(ref: RepoRef, branch: string): Promise<PullRequest | null> {
      const head = encodeURIComponent(`${ref.owner}:${branch}`);
      const open = await call<{ number: number; html_url: string }[]>(
        'GET',
        `/repos/${ref.owner}/${ref.repo}/pulls?state=open&head=${head}`,
        await asRepo(ref),
      );
      return open[0] ? { number: open[0].number, url: open[0].html_url } : null;
    },

    async openPullRequest(ref: RepoRef, pr: NewPullRequest): Promise<PullRequest> {
      const res = await call<{ number: number; html_url: string }>(
        'POST',
        `/repos/${ref.owner}/${ref.repo}/pulls`,
        await asRepo(ref),
        pr,
      );
      return { number: res.number, url: res.html_url };
    },

    identity(): Promise<Identity> {
      bot ??= (async () => {
        const { slug } = await call<{ slug: string }>('GET', '/app', asApp());
        const login = `${slug}[bot]`;
        const { id } = await call<{ id: number }>(
          'GET',
          `/users/${encodeURIComponent(login)}`,
          null,
        );
        return { name: login, email: `${id}+${login}@users.noreply.github.com` };
      })().catch((err: unknown) => {
        bot = undefined;
        throw err;
      });
      return bot;
    },
  };
}

export type GitHubApp = ReturnType<typeof githubApp>;
