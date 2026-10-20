# weft

A cloud coding agent. Give it a GitHub repo and a task; it works in an isolated sandbox using
agentic search, and returns a diff only if the tests pass in a clean sandbox.

> Work in progress. Benchmarks, load-test results and the design write-up will lead this README
> once they exist.

## Layout

```
apps/
  api/           http api: create, list, cancel runs
  web/           dashboard: start runs, watch them, read diffs
  worker/        runs jobs: clone → sandbox → agent → verify → diff
infra/
  compose.yml    redis
  sandbox/       image every agent run executes in
packages/
  queue/         bullmq queue shared by api and worker
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
curl -X POST localhost:3001/runs -H 'content-type: application/json' \
  -d '{"repoUrl":"https://github.com/you/repo","task":"Make the failing test pass","testCommand":"npm test"}'
```

Postgres is hosted on [Neon](https://neon.tech). `DATABASE_URL` is the pooled connection used by
the services; `DATABASE_URL_UNPOOLED` is the direct one, used for migrations.
