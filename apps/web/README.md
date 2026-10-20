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

The chat screen follows Claude Code on the web: the conversation is the focus, the agent's
mechanics stay out of the way until you want them.

- **Your messages** are bubbles on the right. **The agent's replies** are rendered Markdown (code
  blocks, lists, tables, inline code) with raw HTML ignored, so a reply can't inject markup.
- **The agent's work** is one line per turn: a spinner with the current step ("Working… Read
  src/lru.js") while it runs, then "Worked for 31s" once done. Expand it for compact steps:
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

Pages refresh every 2 s while a turn is active and stop when it finishes; pushing updates as they
happen (WebSockets or SSE) is planned.

## Design system

Colours are tokens in `app/globals.css` (`--bg`, `--surface`, `--surface-2/3`, `--line`,
`--fg`, `--muted`, `--faint`, `--accent`, `--ok`, `--bad`, `--warn`), redefined for dark mode and
exposed to Tailwind as `bg-surface`, `text-muted`, `border-line`, `text-accent`, and so on. Every
component uses the tokens, so light and dark stay consistent and the palette changes in one place.
The accent is a warm orange, used sparingly: the brand mark, the send button, focus rings and the
"working" indicator.

- **Markdown** is rendered with `react-markdown` + `remark-gfm` and custom components for every
  element (lists, tables, quotes, inline code), with raw HTML skipped.
- **Code blocks** are highlighted on the server with Shiki (`github-light` / `github-dark-default`
  via CSS variables, so one render serves both themes), with a language label and a copy button.
  No highlighter ships to the browser.
- **Diffs** carry old and new line numbers and the hunk's context line, like GitHub.
- **Icons** are `lucide-react`; the logo is an inline SVG woven mark (`components/logo.tsx`).
- **Chats open at the latest message** and follow new steps while the agent works, but only if you
  are already near the bottom, so reading an earlier turn is never interrupted.

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
