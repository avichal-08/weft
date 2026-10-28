# @weft/web

The weft app: chat with a coding agent about a repository. Next.js 16 (App Router, Cache
Components), React 19, Tailwind 4.

```bash
pnpm --filter @weft/web dev     # http://localhost:3000 (needs the api on :3001 and a worker)
```

## Screens

| Route            | What it shows                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------- |
| `/`              | The public landing page: what weft does, how it works, quality results, sign in; signed in, it redirects to `/chat` |
| `/chat`          | New chat: repository, optional branch, test command, provider and model, and the first message                      |
| `/sessions/[id]` | The conversation, a composer, and the chat's cumulative changes                                                     |
| `/runs/[id]`     | One turn in detail (status, tokens, time per phase, timeline, diff), linked from each turn                          |

The sidebar lists every chat, most recently active first, with a dot for the latest turn's state
(blue and pulsing while the agent works).

## The conversation

The chat screen follows Claude Code on the web: the conversation is the focus, the agent's
mechanics stay out of the way until you want them.

- **Your messages** are bubbles on the right. **The agent's replies** are rendered Markdown (code
  blocks, lists, tables, inline code) with raw HTML ignored, so a reply can't inject markup.
- **The agent's work** is one line per turn: what it is doing right now with a running timer
  while it works ("Installing dependencies `pnpm install --frozen-lockfile` 1m 12s", then "Read
  `src/lru.js`"), then "Worked for 31s" once done. Expand it for compact steps:
  _Searched for `get(`_, _Read `src/lru.js`_, _Edited `src/lru.js` +4 −1_, _Tests passed_, any
  text the model wrote between steps, and, per step, its output or the edit as a small diff.
  Failed steps are marked ✗.
- **Stats** (steps, tokens) and a link to the run's detail page appear only on hover under each
  reply. A turn that didn't finish says why in one sentence, with the details folded.
- **The header** shows the chat's title, repo, branch and model, a "Working" indicator, and a
  **Changes** button with the number of files changed. It opens a side panel listing each file
  with its +/− counts and its diff; the panel shows the latest cumulative diff of the whole chat.
- **The composer** stays at the bottom: Enter sends, Shift+Enter adds a line, the model in use is
  shown beside the button, and while a turn runs it turns into **Stop**, which cancels the turn.
- **Code / Ask** in the composer and the new-chat form picks the message's mode. Ask is
  read-only: weft answers from the code and can't change files
  ([ADR 0008](../../docs/decisions/0008-ask-mode.md)). The placeholder and the hint under the
  composer say which mode is on, the composer starts in the mode of the chat's last message, and
  Ask messages are labelled "Ask · read-only" above the bubble.

### Publishing

The chat header has **Commit** and **Create PR**
([ADR 0006](../../docs/decisions/0006-user-commits-with-generated-messages.md)).

- **Commit** opens a dialog that drafts a message for what changed since the last commit
  ("Writing a commit message…"), lets you edit it, and saves it. It is enabled only when the latest
  Code turn succeeded and changed something since the last commit; Ask turns don't count.
- **Create PR** with uncommitted changes opens the same dialog as **Commit & create PR**;
  with everything committed it publishes directly. If the API refuses, its reason shows under
  the buttons.
- **Checks** on the chat's diff ([ADR 0009](../../docs/decisions/0009-diff-checks.md)) show
  under the latest Code turn: a red box for findings that block (a secret, an environment file, a
  workflow change), which disables Commit and Create PR with the reason as their tooltip, and an
  amber "Worth a look" box for warnings (rewritten tests, large files), which the commit dialog
  repeats above the message. Only the latest Code turn shows them, since its diff covers the whole
  chat.
- While publishing, the button reads "Opening PR…" and the page refreshes itself; afterwards it is
  a **PR #n** link, and later commits are pushed to it right away ("pushing…").
- The Changes panel lists the chat's commits: the subject, and the short sha (a GitHub link) once
  pushed, or "not pushed".

The dialog is a native `<dialog>`, mounted only while open, so every open starts from a fresh
draft.

### Live updates

A running turn is pushed to the browser as it happens, over server-sent events:

1. The page renders on the server with the turn's events so far.
2. `LiveWorkLog`, a client component, opens an `EventSource` on `/api/runs/:id/stream`, asking
   only for events after the last one it already has (`?attempt=&after=`).
3. That route handler proxies the API's `GET /runs/:id/stream` byte for byte, passing
   `Last-Event-ID` through, so the browser still never talks to the API directly.
4. `phase` messages update the status line, `event` messages append steps, `attempt` resets the
   list when another worker takes over, and `end` closes the stream and refreshes the page once,
   which swaps in the final reply, diff and stats.

If the connection drops, `EventSource` reconnects and resumes from `Last-Event-ID`; if it gives
up, the component reconnects after 3 s. Nothing polls any more. SSE rather than WebSockets
because the traffic is one way, it is plain HTTP, and resuming is built in.

## Design system

Colours are tokens in `app/globals.css` (`--bg`, `--surface`, `--surface-2/3`, `--line`,
`--fg`, `--muted`, `--faint`, `--accent`, `--ok`, `--bad`, `--warn`), redefined for dark mode and
exposed to Tailwind as `bg-surface`, `text-muted`, `border-line`, `text-accent`, and so on. Every
component uses the tokens, so light and dark stay consistent and the palette changes in one place.
The accent is a warm orange, used sparingly: the brand mark, the send button, focus rings and the
"working" indicator.

- **Markdown** is rendered with `react-markdown` + `remark-gfm` and custom components for every
  element (lists, tables, quotes, inline code), with raw HTML skipped.
- **Code blocks** in replies are highlighted on the server with Shiki (`github-light` /
  `github-dark-default` via CSS variables, so one render serves both themes), with a language
  label and a copy button. No highlighter ships to the browser: the live work log renders on the
  client, so the text the model writes between steps uses `MarkdownText` with plain code blocks,
  and `Prose` adds Shiki on top for server-rendered replies.
- **Diffs** carry old and new line numbers and the hunk's context line, like GitHub.
- **Icons** are `lucide-react`; the logo is an inline SVG woven mark (`components/logo.tsx`).
- **Chats open at the latest message** and follow new steps while the agent works, but only if you
  are already near the bottom, so reading an earlier turn is never interrupted. A
  `ResizeObserver` on the conversation keeps it pinned whenever content grows, whether from a
  live step or a server refresh.

## How it talks to the API

The browser never calls the API. Server Components read sessions, turns and traces; Server
Actions create chats, send messages and cancel turns, and one route handler proxies the live
stream, all from the Next.js server (`lib/api.ts`, marked `server-only`). There is no CORS to configure and the API doesn't need to be
reachable from the browser.

| Variable             | Default                                     |
| -------------------- | ------------------------------------------- |
| `API_URL`            | `http://localhost:3001`                     |
| `WEFT_PASSWORD_HASH` | required to sign in: from `auth:hash`       |
| `SESSION_SECRET`     | required to sign in: at least 32 characters |

For local development copy `.env.example` to `.env.local` and fill in the two sign-in values.

## Sign-in

weft has one user, so sign-in is one password
([ADR 0011](../../docs/decisions/0011-single-user-sign-in.md)).

```bash
pnpm --filter @weft/web auth:hash   # prompts twice, prints WEFT_PASSWORD_HASH=scrypt:...
```

- **The password** is stored only as a scrypt hash (N=2^15, r=8, p=1, a random salt), in
  `WEFT_PASSWORD_HASH`. The format uses `:` separators, so it needs no quoting in a `.env` file or
  Docker Compose. At least 12 characters.
- **`/login`** checks it in constant time and sets `weft_session`: an HS256 JWT (`jose`) for the
  subject `owner`, signed with `SESSION_SECRET`, valid 7 days, `HttpOnly`, `SameSite=Lax`, and
  `Secure` in production. Five attempts a minute per client IP (the first `X-Forwarded-For`
  entry, set by the reverse proxy), then "Too many attempts".
- **`proxy.ts`** checks the cookie on every request except `/login` and static assets: pages
  redirect to `/login`, `/api/*` answers 401. Every Server Action and the stream route check the
  session again themselves, as Next's docs advise, so moving a route can't drop the check.
- **Sign out** in the sidebar deletes the cookie. Rotating `SESSION_SECRET` signs out every
  session at once.
- `/healthz` stays outside the gate for container health checks.
- Without both variables nobody can sign in: the login form says sign-in isn't configured.
- `/` is the public landing page and `/chat` the app's home: `proxy.ts` lets `/` through without a
  session and redirects it to `/chat` with one; signing in also lands on `/chat`. Its pixel field is a dot matrix drawn at the screen's resolution: 2.5 px
  squares on an 8 px grid, mostly neutral with a slow twinkle, in the accent colour where the noise
  peaks and around the pointer. It runs at 30 fps, pauses off screen and stays still under
  `prefers-reduced-motion`. The logo is a woven mark: accent weft threads over and under neutral
  warps, the gaps cut in the colour of whatever it sits on (`gap`).
- Pages live in the `(app)` route group, whose layout has the sidebar; `/login` sits outside it,
  so the sign-in page never lists chats.

## Notes

- **Cache Components is on**: data is fetched fresh on every request, and anything reading
  request data (`fetch`, route `params`) sits inside `<Suspense>`, or the build fails. Pages are
  partially prerendered: the shell is served at once and the data streams in.
- **Single-column grids use `grid-cols-1`** (`minmax(0, 1fr)`). A bare `grid` sizes its column to
  the widest unwrappable child, so one long task title or diff line would widen the whole page.
- **Unknown ids** render the 404 page with HTTP 200, since the shell is sent before the lookup
  finishes; a known trade-off of streaming.
