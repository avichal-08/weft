# weft

A cloud coding agent, in the spirit of Claude Code on the web. Connect a GitHub repo and hand it
work: fix a bug, build a feature, refactor, review, or explain how something works. It clones the
repo into an isolated sandbox, installs dependencies, reads and edits the code, runs the tests,
and hands back the change, while you watch every step live and steer it with follow-up messages.

- **Does the work, end to end.** Plans from the code, edits files, runs tests and commands, and
  independently re-runs the tests before calling a change done. The result is a diff today and a
  pull request next.
- **Steer it like a teammate.** Every task is a conversation: follow-ups continue from the
  previous turn's changes ("now handle the empty case too"), and questions get answers without
  touching the code.
- **Agentic search, no index.** Like Claude Code, it finds code with `grep`, `glob` and reading
  files, then edits with exact string replacement guarded against stale views.
- **A locked-down sandbox per turn.** A Docker container with no capabilities, a read-only root,
  resource limits and three layers of timeouts. Dependencies install with network (npm, pnpm,
  Yarn or Bun, picked from the lockfile), then the network is cut and the agent works offline.
  Model keys never enter the box.
- **Live.** Every phase, model call and tool call streams to the browser as it happens (Redis
  Streams + server-sent events), and is stored as a trace you can replay.
- **Built to survive failure.** Runs go through a queue, workers fence every write with an
  attempt number, cancel stops a run within seconds, and a janitor removes leftover sandboxes.
- **Provider-agnostic.** Anthropic, OpenAI, Gemini or OpenRouter, with retries that respect
  rate limits.

> Work in progress

## Layout

```
apps/
  api/           http api: sessions, messages, runs, cancel, live sse stream
  web/           chat ui: conversations, live work log, changes panel (next.js)
  worker/        runs turns: clone → sandbox → install → agent → verify → diff
infra/
  compose.yml    redis (queue + live streams)
  sandbox/       image every agent run executes in
packages/
  queue/         bullmq queue and redis live streams shared by api and worker
  db/            postgres schema and migrations (drizzle, neon)
  agent/         the coding agent: tools and loop
  sandbox/       docker sandbox lifecycle (dockerode)
  llm/           provider-agnostic llm client (anthropic, openai, gemini, openrouter, mock)
  tsconfig/      shared TypeScript config
  eslint-config/ shared ESLint flat config
```

## Development

Requires Node 22 (`.nvmrc`), pnpm (via corepack) and Docker Engine.

```bash
pnpm install
cp .env.example .env        # fill in the Neon urls and an LLM key
pnpm infra:up               # redis
pnpm db:migrate             # create tables on neon
pnpm sandbox:build && pnpm sandbox:smoke
pnpm check                  # lint, typecheck and unit tests
```

Run it end to end (three terminals), then open http://localhost:3000:

```bash
pnpm --filter @weft/api dev
pnpm --filter @weft/worker dev
pnpm --filter @weft/web dev
```

```bash
curl -X POST localhost:3001/sessions -H 'content-type: application/json' \
  -d '{"repoUrl":"https://github.com/you/repo","message":"What does this repo do?"}'
```

Postgres is hosted on [Neon](https://neon.tech). `DATABASE_URL` is the pooled connection used by
the services; `DATABASE_URL_UNPOOLED` is the direct one, used for migrations.
