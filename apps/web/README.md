# @weft/web

The weft app: chat with a coding agent about a repository. Next.js 16 (App Router, Cache
Components), React 19, Tailwind 4.

```bash
pnpm --filter @weft/web dev     # http://localhost:3000 (needs the api on :3001 and a worker)
```

## Screens

| Route            | What it shows                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| `/`              | New chat: repository, optional branch, test command, provider and model, and the first message |
| `/sessions/[id]` | The conversation, a composer, and the chat's cumulative changes                                |
| `/runs/[id]`     | One turn in detail (status, tokens, timeline, diff), linked from each turn                     |

The sidebar lists every chat, most recently active first, with a dot for the latest turn's state
(blue and pulsing while the agent works).

## The conversation

Each turn shows your message, then the agent's work, then its reply:

- **While it works**, the activity timeline is open and grows live: each model step with its
  latency and tokens, each tool call with a one-line summary, collapsed output, failed calls
  opened, and edits shown as small diffs.
- **Once done**, the activity folds into "worked · 7 steps · 2m 4s · 21.5k tokens" (click to
  expand, or follow "details" to the run page) and the reply appears below it. A turn that didn't
  complete says why (`tests_failed`, `apply_failed`, rate limit, …); if the chat has a test
  command, a passing run shows "✓ tests pass".
- **The composer** sends with Enter (Shift+Enter for a new line). While a turn is running it is
  disabled and shows **Stop**, which cancels the turn. The API refuses a second message while one
  is in progress, and the form says so.
- **Changes** is the latest cumulative diff: everything the agent has changed in this chat, beside
  the conversation on wide screens and under it on narrow ones.

Pages refresh every 2 s while a turn is active and stop when it finishes; pushing updates as they
happen (WebSockets or SSE) is planned.

## How it talks to the API

The browser never calls the API. Server Components read sessions, turns and traces; Server
Actions create chats, send messages and cancel turns, all from the Next.js server
(`lib/api.ts`, marked `server-only`). There is no CORS to configure and the API doesn't need to be
reachable from the browser.

| Variable  | Default                 |
| --------- | ----------------------- |
| `API_URL` | `http://localhost:3001` |

## Notes

- **Cache Components is on**: data is fetched fresh on every request, and anything reading
  request data (`fetch`, route `params`) sits inside `<Suspense>`, or the build fails. Pages are
  partially prerendered: the shell is served at once and the data streams in.
- **Single-column grids use `grid-cols-1`** (`minmax(0, 1fr)`). A bare `grid` sizes its column to
  the widest unwrappable child, so one long task title or diff line would widen the whole page.
- **Unknown ids** render the 404 page with HTTP 200, since the shell is sent before the lookup
  finishes; a known trade-off of streaming.
