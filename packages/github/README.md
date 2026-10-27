# @weft/github

Talks to GitHub as the weft GitHub App: proves who it is with a signed JWT, finds the app's
installation on a repository, and mints short-lived installation tokens for it. No dependencies:
Node's `crypto` signs the JWT and the global `fetch` calls the API. Why a GitHub App and not a
personal token or an OAuth app: [ADR 0004](../../docs/decisions/0004-github-app-auth.md).

```ts
import { githubApp, parseRepo } from '@weft/github';

const app = githubApp({ appId, privateKey });
const token = await app.token(parseRepo('https://github.com/avichal-08/demo')!);
```

## API

| Export                                                    | What it does                                                                                                                                                                              |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `githubApp({ appId, privateKey, apiUrl?, fetch?, now? })` | The app client. `fetch` and `now` are there for tests.                                                                                                                                    |
| `app.installationId({ owner, repo })`                     | The app's installation covering that repo; throws `NotInstalledError` if there is none.                                                                                                   |
| `app.token({ owner, repo })`                              | An installation token for that one repository, with `contents: write` and `pull_requests: write` only. Cached until 5 minutes before it expires (GitHub issues them for 1 hour).          |
| `app.identity()`                                          | The app's bot as a commit author: `slug[bot]` and the `<id>+slug[bot]@users.noreply.github.com` email GitHub links to the bot. Looked up once (the users endpoint is public, so no auth). |
| `appJwt(appId, privateKey, now?)`                         | The app's own JWT: RS256, issued 60 s in the past (clock skew), valid 9 minutes (GitHub's limit is 10).                                                                                   |
| `parseRepo(url)`                                          | `{ owner, repo }` from `https://github.com/owner/repo(.git)`, or `null` for anything else.                                                                                                |
| `GitHubError`, `NotInstalledError`                        | API failures, with `status` and GitHub's message.                                                                                                                                         |

## How the tokens are used

Tokens only ever live in the worker's memory, on the host. They are used for `git push` and the
REST API from the worker process and are never passed into a sandbox, written to a git remote
URL, git config or disk. Each token can only touch the one repository it was minted for, even if
the app is installed on more.

## Setting up the app

1. GitHub → Settings → Developer settings → GitHub Apps → **New GitHub App**.
2. Name: anything unique (e.g. `weft-<your-username>`). Homepage URL: your weft URL or the repo.
3. **Webhook: untick Active.** weft doesn't need events yet, so no public URL is needed.
4. Repository permissions: **Contents: Read and write**, **Pull requests: Read and write**
   (Metadata: Read-only is added automatically). Nothing else.
5. Where can it be installed: **Only on this account**.
6. Create it, note the **App ID**, then **Generate a private key** (a `.pem` downloads).
7. **Install App** → only select repositories → pick the repos weft should open PRs on.
8. Put the key outside the repo and point weft at it:

```bash
mkdir -p ~/.config/weft && mv ~/Downloads/*.private-key.pem ~/.config/weft/github-app.pem && chmod 600 ~/.config/weft/github-app.pem
```

```
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY_PATH=/home/you/.config/weft/github-app.pem
```

## Testing

```bash
pnpm --filter @weft/github test   # fake GitHub over a stubbed fetch, real RSA signatures
```
