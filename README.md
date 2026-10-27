# weft

A cloud coding agent, in the spirit of Claude Code on the web: hand it work on a GitHub repo, or
start from nothing, and watch it build in an isolated sandbox.

> Early and in active development. The first list is where it's headed; the second is what works
> today.

## Where it's going

- **Hand it real work.** Connect a repo and ask it to fix a bug, build a feature, refactor,
  review, or explain how something works.
- **Steer it like a teammate.** One conversation per task: follow-ups, corrections and questions,
  with every step visible live.
- **Ship the result.** Changes come back as a pull request, checked by the tests.
- **Start from scratch.** No repo needed: describe an app, watch it get built, and use a live
  preview of it.

## Where it is now

- **Chat with a public GitHub repo**: each message is a turn that continues from the previous
  one's changes, with Claude Code-style agentic search (`grep`, `glob`, reading files, no
  embedding index), on Anthropic, OpenAI, Gemini or OpenRouter.
- **Ship it as a pull request**: commit when the work is ready (weft drafts the message, you edit
  it), then Create PR; a GitHub App pushes the branch as its own bot with repo-scoped, short-lived
  tokens that never enter the sandbox. Later commits go to the same pull request.
- **A locked-down sandbox per chat**: dependencies install with network, then the network is cut
  and the agent works offline. Tests are rerun in a fresh sandbox before a turn counts as passing,
  and nothing can be committed or published while they fail.
- **Fast follow-ups**: installed dependencies become copy-on-write image layers and a chat keeps
  its sandbox between messages, so on a repo with 639 MB of `node_modules` a follow-up starts in
  about 1 s instead of 55 s. Why each piece works the way it does is in
  [`docs/decisions`](docs/decisions).
- **Live and replayable**: every step streams to the browser and is stored as a trace.

## Layout

```
apps/
  api/           http api: sessions, messages, runs, cancel, live sse stream
  web/           chat ui: conversations, live work log, changes panel (next.js)
  worker/        runs turns: clone → sandbox → install → agent → verify → diff
docs/
  decisions/     architecture decision records: what was chosen, and why
infra/
  compose.yml    redis (queue + live streams)
  sandbox/       image every agent run executes in
packages/
  queue/         bullmq queue and redis live streams shared by api and worker
  db/            postgres schema and migrations (drizzle, neon)
  agent/         the coding agent: tools and loop
  sandbox/       docker sandbox lifecycle (dockerode)
  github/        github app auth: app jwt, installation tokens
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
