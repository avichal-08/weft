# weft

A cloud coding agent, in the spirit of Claude Code on the web. Point it at a GitHub repository,
ask for a fix, a feature, a review or an explanation, watch it work in an isolated sandbox, and
ship the result as a pull request.

## What it does

- **Chat with a repository.** Each message is a turn that continues from the previous one's
  changes: questions, changes, corrections and follow-ups in one conversation. The agent finds
  code the way Claude Code does, with `grep`, `glob` and reading files, not an embedding index,
  and runs on Anthropic, OpenAI, Gemini or OpenRouter models.
- **Ship it as a pull request.** Commit when the work is ready (weft drafts the message, you edit
  it), then Create PR. A GitHub App pushes the branch as its own bot with repo-scoped,
  short-lived tokens that never enter the sandbox. Later commits go to the same pull request.
- **Checked, not trusted.** Tests are rerun in a fresh sandbox with only the agent's diff
  applied, and nothing can be committed or published while they fail.
- **A locked-down sandbox per chat.** Dependencies install with network, then the network is
  cut and the agent works offline, as an unprivileged user with no capabilities and capped
  memory, processes and disk.
- **Fast follow-ups.** Installed dependencies become copy-on-write image layers and a chat keeps
  its sandbox between messages, so on a repository with 639 MB of `node_modules` a follow-up
  starts in about 1 s instead of 55 s.
- **Live and replayable.** Every model call and tool call streams to the browser as it happens
  and is stored as a trace.

## How it works

The web app talks to an API, which stores each message as a run in Postgres and queues it in
Redis. A worker picks the run up, prepares a sandbox, runs the agent loop against the model,
collects the change as a git diff, verifies it in a clean sandbox and records the result, while
streaming every step back through Redis. Publishing is a separate job that pushes commits to a
branch and opens the pull request.

- [`docs/architecture.md`](docs/architecture.md): a one-page map of the system and a turn, end to
  end.
- [`docs/decisions`](docs/decisions): why each piece works the way it does, with the numbers and
  the alternatives considered.

## Evaluation

Changes to the agent are measured, not judged by a few chats. The eval suite in
[`packages/agent/eval`](packages/agent/eval) runs 17 tasks in the real sandbox: questions, bug
fixes, features, follow-ups, and traps where the right answer is to change nothing. Each run is
graded by code: hidden tests the agent never saw, the original tests restored and rerun, no
edits when only a question was asked, and no replies claiming changes that were never made.
Results, with cost and time per task, are in [`REPORT.md`](packages/agent/eval/REPORT.md); the
reasoning is in [ADR 0007](docs/decisions/0007-agent-evals.md).

## Stack

TypeScript throughout, in a pnpm and Turborepo monorepo. Next.js 16 and React 19 for the web
app, Express 5 for the API, BullMQ and Redis for queues and live streams, Postgres on Neon with
Drizzle, Docker for sandboxes, Vitest for tests.

## Layout

```
apps/
  api/           http api: sessions, messages, runs, cancel, live sse stream
  web/           chat ui: conversations, live work log, changes panel (next.js)
  worker/        runs turns: clone → sandbox → install → agent → verify → diff
docs/
  architecture.md one-page map of the system
  decisions/     architecture decision records: what was chosen, and why
infra/
  compose.yml    redis (queue + live streams)
  sandbox/       image every agent run executes in
packages/
  agent/         the coding agent: tools, loop and eval suite
  sandbox/       docker sandbox lifecycle (dockerode)
  llm/           provider-agnostic llm client (anthropic, openai, gemini, openrouter, mock)
  queue/         bullmq queues and redis live streams shared by api and worker
  db/            postgres schema and migrations (drizzle, neon)
  github/        github app auth: app jwt, installation tokens, pull requests
  tsconfig/      shared TypeScript config
  eslint-config/ shared ESLint flat config
```

Each app and package has its own README with the details.

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

Or start a chat from the command line:

```bash
curl -X POST localhost:3001/sessions -H 'content-type: application/json' \
  -d '{"repoUrl":"https://github.com/you/repo","message":"What does this repo do?"}'
```

Postgres is hosted on [Neon](https://neon.tech). `DATABASE_URL` is the pooled connection used by
the services; `DATABASE_URL_UNPOOLED` is the direct one, used for migrations. Publishing needs a
GitHub App installed on the repository, with contents and pull requests write access:
`GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY_PATH` (see
[`packages/github`](packages/github/README.md)). Without it, everything except publishing works.

Run the agent evals with a model of your choice:

```bash
pnpm --filter @weft/agent eval --provider gemini --model gemini-3.1-flash-lite --label run
pnpm --filter @weft/agent eval:report
```
