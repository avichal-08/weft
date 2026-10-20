# weft

A cloud coding agent. Give it a GitHub repo and a task; it works in an isolated sandbox using
agentic search, and returns a diff only if the tests pass in a clean sandbox.

> Work in progress. Benchmarks, load-test results and the design write-up will lead this README
> once they exist.

## Layout

```
apps/
  web/           Next.js dashboard
  api, worker    (coming in M1)
infra/
  compose.yml    redis
  sandbox/       image every agent run executes in
packages/
  agent/         the coding agent: tools (loop coming next)
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
pnpm sandbox:build && pnpm sandbox:smoke
pnpm typecheck && pnpm lint && pnpm build
```

Postgres is hosted on [Neon](https://neon.tech). `DATABASE_URL` is the pooled connection used by
the services; `DATABASE_URL_UNPOOLED` is the direct one, used for migrations.
