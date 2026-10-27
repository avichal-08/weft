import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { githubApp, NotInstalledError } from '../src/app.ts';

const pem = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ type: 'pkcs1', format: 'pem' })
  .toString();
const repo = { owner: 'avichal-08', repo: 'demo' };

type Call = { method: string; url: string; auth: string; body: unknown };

function fakeGitHub(routes: Record<string, (call: Call) => [number, unknown]>) {
  const calls: Call[] = [];
  const fetch = (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    const call: Call = {
      method: init.method ?? 'GET',
      url: url.replace('https://api.github.com', ''),
      auth: headers.authorization ?? '',
      body: init.body ? (JSON.parse(init.body as string) as unknown) : undefined,
    };
    calls.push(call);
    const route = routes[`${call.method} ${call.url}`];
    const [status, body] = route ? route(call) : [404, { message: 'Not Found' }];
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
  return { calls, fetch: fetch as unknown as typeof globalThis.fetch };
}

describe('githubApp', () => {
  it('mints a token scoped to the one repository, with only contents and pull requests', async () => {
    const gh = fakeGitHub({
      'GET /repos/avichal-08/demo/installation': () => [200, { id: 77 }],
      'POST /app/installations/77/access_tokens': () => [
        201,
        { token: 'ghs_one', expires_at: '2026-10-27T13:00:00Z' },
      ],
    });
    const app = githubApp({
      appId: '1',
      privateKey: pem,
      fetch: gh.fetch,
      now: () => Date.UTC(2026, 9, 27, 12),
    });

    expect(await app.token(repo)).toBe('ghs_one');
    expect(gh.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /repos/avichal-08/demo/installation',
      'POST /app/installations/77/access_tokens',
    ]);
    expect(gh.calls.every((c) => /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(c.auth))).toBe(true);
    expect(gh.calls[1]!.body).toEqual({
      repositories: ['demo'],
      permissions: { contents: 'write', pull_requests: 'write' },
    });
  });

  it('reuses a token until five minutes before it expires', async () => {
    let clock = Date.UTC(2026, 9, 27, 12);
    let minted = 0;
    const gh = fakeGitHub({
      'GET /repos/avichal-08/demo/installation': () => [200, { id: 77 }],
      'POST /app/installations/77/access_tokens': () => [
        201,
        { token: `ghs_${++minted}`, expires_at: new Date(clock + 60 * 60_000).toISOString() },
      ],
    });
    const app = githubApp({ appId: '1', privateKey: pem, fetch: gh.fetch, now: () => clock });

    expect(await app.token(repo)).toBe('ghs_1');
    clock += 50 * 60_000;
    expect(await app.token({ owner: 'Avichal-08', repo: 'Demo' })).toBe('ghs_1');
    clock += 6 * 60_000;
    expect(await app.token(repo)).toBe('ghs_2');
  });

  it('says plainly when the app is not installed on the repository', async () => {
    const app = githubApp({ appId: '1', privateKey: pem, fetch: fakeGitHub({}).fetch });
    const err = await app.token(repo).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotInstalledError);
    expect((err as Error).message).toBe(
      'the weft GitHub App is not installed on avichal-08/demo; install it on that repository first',
    );
  });

  it('passes GitHub errors through with their status and message', async () => {
    const gh = fakeGitHub({
      'GET /repos/avichal-08/demo/installation': () => [200, { id: 77 }],
      'POST /app/installations/77/access_tokens': () => [
        403,
        { message: 'Resource not accessible by integration' },
      ],
    });
    const app = githubApp({ appId: '1', privateKey: pem, fetch: gh.fetch });
    await expect(app.token(repo)).rejects.toMatchObject({
      status: 403,
      message:
        'POST /app/installations/77/access_tokens failed (403): Resource not accessible by integration',
    });
  });

  it("knows its bot's commit identity, and asks GitHub only once", async () => {
    const gh = fakeGitHub({
      'GET /app': () => [200, { slug: 'weft-avichal-08' }],
      'GET /users/weft-avichal-08%5Bbot%5D': () => [200, { id: 4242 }],
    });
    const app = githubApp({ appId: '1', privateKey: pem, fetch: gh.fetch });
    const expected = {
      name: 'weft-avichal-08[bot]',
      email: '4242+weft-avichal-08[bot]@users.noreply.github.com',
    };
    expect(await app.identity()).toEqual(expected);
    expect(await app.identity()).toEqual(expected);
    expect(gh.calls).toHaveLength(2);
    expect(gh.calls[1]!.auth).toBe('');
  });

  it('reads the default branch, finds an open pull request, and opens one, with the repo token', async () => {
    const created: unknown[] = [];
    const gh = fakeGitHub({
      'GET /repos/avichal-08/demo/installation': () => [200, { id: 77 }],
      'POST /app/installations/77/access_tokens': () => [
        201,
        { token: 'ghs_repo', expires_at: '2099-01-01T00:00:00Z' },
      ],
      'GET /repos/avichal-08/demo': () => [200, { default_branch: 'main' }],
      'GET /repos/avichal-08/demo/pulls?state=open&head=avichal-08%3Aweft%2Fa-1': () => [200, []],
      'GET /repos/avichal-08/demo/pulls?state=open&head=avichal-08%3Aweft%2Fb-2': () => [
        200,
        [{ number: 7, html_url: 'https://github.com/avichal-08/demo/pull/7' }],
      ],
      'POST /repos/avichal-08/demo/pulls': (call) => {
        created.push(call.body);
        return [201, { number: 8, html_url: 'https://github.com/avichal-08/demo/pull/8' }];
      },
    });
    const app = githubApp({ appId: '1', privateKey: pem, fetch: gh.fetch });

    expect(await app.defaultBranch(repo)).toBe('main');
    expect(await app.findPullRequest(repo, 'weft/a-1')).toBeNull();
    expect(await app.findPullRequest(repo, 'weft/b-2')).toEqual({
      number: 7,
      url: 'https://github.com/avichal-08/demo/pull/7',
    });
    const pr = { head: 'weft/a-1', base: 'main', title: 'Fix a', body: 'Body' };
    expect(await app.openPullRequest(repo, pr)).toEqual({
      number: 8,
      url: 'https://github.com/avichal-08/demo/pull/8',
    });
    expect(created).toEqual([pr]);
    const repoCalls = gh.calls.filter(
      (c) => !c.url.includes('/installation') && !c.url.startsWith('/app/'),
    );
    expect(repoCalls.every((c) => c.auth === 'token ghs_repo')).toBe(true);
  });
});
