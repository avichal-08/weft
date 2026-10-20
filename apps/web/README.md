# @weft/web

The weft dashboard: start a run, watch it progress, read the summary and the diff. Next.js 16
(App Router, Cache Components), React 19, Tailwind 4.

```bash
pnpm --filter @weft/web dev     # http://localhost:3000 (needs the api on :3001)
```

## Pages

| Route        | What it shows                                                                              |
| ------------ | ------------------------------------------------------------------------------------------ |
| `/`          | New-run form (repo, task, test command, provider, model, max steps) and the 50 latest runs |
| `/runs/[id]` | Status, steps, tokens, duration, summary, failure details, coloured diff, cancel           |

Both refresh every 2 s while a run is `queued` or `running`, and stop once it finishes.

## How it talks to the API

The browser never calls the API. Server Components fetch runs and Server Actions create and
cancel them, all from the Next.js server (`lib/api.ts`, marked `server-only`). So there is no
CORS to configure and the API doesn't need to be reachable from the browser.

| Variable  | Default                 |
| --------- | ----------------------- |
| `API_URL` | `http://localhost:3001` |

## Notes

- **Cache Components is on**, so data is fetched fresh on every request and any component
  reading request data (`fetch`, route `params`) must sit inside `<Suspense>`; the build fails
  otherwise. Pages are partially prerendered: the static shell is served instantly and run data
  streams in.
- **Unknown run ids** render the 404 page but with HTTP status 200: the shell, status
  included, is sent before the run lookup finishes. A known trade-off of streaming.
- Validation errors from the API (`POST /runs` → 400) are shown on the form, which keeps what
  you typed (`useActionState`).
- Live per-step traces (each tool call as it happens) come once runs record their trace (M2) and
  stream over WebSockets (M4).
