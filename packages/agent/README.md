# @weft/agent

The coding agent: the tools it can call and the loop that drives them. Tools follow
Claude Code's design: the agent finds code with `grep`, `glob` and `view_file` (agentic search,
no embedding index) and edits with exact string replacement.

```ts
import { createProvider, loadLLMConfig, toolCalls } from '@weft/llm';
import { parseToolCall, toolSpecs } from '@weft/agent';

const llm = createProvider(loadLLMConfig());
const res = await llm.complete({ system, messages, tools: toolSpecs() });

for (const call of toolCalls(res.content).map(parseToolCall)) {
  if (!call.ok) {
    // send call.error back to the model as an error tool_result
  } else if (call.name === 'view_file') {
    call.args.offset; // typed, defaults filled in
  }
}
```

## Tools

| Tool               | Purpose                                                                     |
| ------------------ | --------------------------------------------------------------------------- |
| `grep`             | Search contents with ripgrep: matching files, lines with context, or counts |
| `glob`             | Find files by name pattern, newest first                                    |
| `view_file`        | Read a file with line numbers, or a range of it                             |
| `str_replace_edit` | Replace one exact, unique snippet; fails if the file changed since viewed   |
| `create_file`      | Write a new file; refuses to overwrite                                      |
| `run_command`      | Run a shell command (no network)                                            |
| `run_tests`        | Run the repo's configured test command (only offered when there is one)     |
| `finish`           | End the turn; `summary` is the reply to the user                            |

## The loop

```ts
const ctx = createToolContext({ sandbox, root: '/workspace/repo', testCommand: 'npm test' });
const res = await runAgent({
  llm,
  ctx,
  task: 'Now make the toggle remember the choice',
  history, // earlier turns: the user's messages and the agent's replies
  onEvent: console.log,
});
// res.summary is the reply to the user; also res.status, steps, usage, events, messages
```

The agent is a chat agent, not only a test fixer: a message can be a question, a change, a
review or a follow-up. The system prompt (`src/prompt.ts`) has it read the relevant code first,
answer questions without editing, make focused edits for change requests, and end every turn
with `finish`, whose `summary` is the reply shown to the user. `history` goes before the new
message, so follow-ups have context.

**Tests are optional.** With a `testCommand`, the agent checks changes with `run_tests`. Without
one, `run_tests` is not offered at all, and the prompt tells the agent to use `run_command` if
the repo clearly has tests.

Each step sends the conversation to the model, runs every tool call it made, and sends all the
results back in one message (the APIs require every call to be answered, failed ones included).

| Status         | When                                                                          |
| -------------- | ----------------------------------------------------------------------------- |
| `finished`     | The model called `finish`, or answered in plain text; `summary` is the reply. |
| `max_steps`    | The step budget (default 30) ran out.                                         |
| `no_tool_call` | The model returned nothing, was reminded once, and did it again.              |
| `max_tokens`   | A response hit the output token limit without a tool call.                    |
| `refusal`      | The model declined.                                                           |
| `aborted`      | The `signal` fired; checked between steps and passed to the LLM call.         |

Errors the model can't fix (auth, exhausted retries, a dead sandbox) are thrown rather than
fed back. `onEvent` receives one `llm` event per step (tokens, latency, stop reason, text) and one
`tool` event per call (args, duration, error flag, first 2000 characters of output); the same
events are returned in `res.events`. The system prompt is in `src/prompt.ts`.

## Demo

```bash
pnpm --filter @weft/agent demo                      # fixtures/add-bug with the LLM from .env
pnpm --filter @weft/agent demo <dir> "<task>"       # any local repo
```

Copies the repo into a fresh sandbox, commits it, runs the agent with a live trace, then reruns
the tests independently and prints the `git diff`.

## Running tools

Tools execute inside a sandbox from `@weft/sandbox`, relative to the repo root:

```ts
const ctx = createToolContext({ sandbox, root: '/workspace/repo', testCommand: 'npm test' });

for (const call of toolCalls(res.content).map(parseToolCall)) {
  const out = call.ok ? await executeTool(ctx, call) : { content: call.error, isError: true };
  // send out.content back as a tool_result, with isError
}
```

Every tool returns `{ content, isError }`: text written for the model. Failures the model can
fix (bad path, ambiguous edit, failing tests) come back as `isError: true`. Infrastructure
failures (a dead sandbox) throw, since the model can't fix those.

- **No shell for model input.** Patterns and paths go to `rg`, `awk` and `sh -c` scripts as
  separate argv entries, so `"; rm -rf /"` is just text.
- **Paths stay in the repo.** `../../etc/passwd` and absolute paths outside the root are refused.
- **Truncation says how to narrow.** Long results end with
  `[showing 100 of 2340 lines; narrow with path, glob or a more specific pattern]`; partial
  `view_file` reads end with `use offset=N to read more`.
- **`grep`/`glob`** use ripgrep with `.gitignore` respected, dotfiles included and `.git/`
  always excluded. The model's `glob` pattern is **never passed to ripgrep**: rg's `--glob`
  overrides ignore rules whenever the pattern also matches a folder name, so `**/*` would list
  all of `node_modules/` and `.git/`. Instead rg lists or searches with ignores intact, and
  weft filters the paths with picomatch, so a pattern can only narrow results. Slash-free
  patterns like `*.ts` match file names anywhere; patterns with a slash match paths relative to
  `path`. `--null` separates paths from content so paths containing `:` or `-` parse safely.
  Output is sorted (by path, or by mtime for `glob`) and minified lines are cut at 300 columns.
- **`view_file`** numbers lines, cuts lines over 2000 characters, and refuses directories,
  binary files and offsets past the end.

### The stale-edit guard

`view_file` records a SHA-256 of the file it showed. `str_replace_edit` refuses a file the model
hasn't viewed, or one whose hash changed since (a test run or formatter rewrote it), so the model
never edits from an outdated picture. A successful edit updates the stored hash, so consecutive
edits don't need a re-read. `create_file` records the hash of what it wrote.

### Editing details

- `old_str` must occur exactly once unless `replace_all`; the error says how many times it was
  found, or reminds the model that whitespace must match.
- Replacement is positional, not `String.replace`, which would expand `$&` and `$1` in the new
  text.
- Files are rewritten in place (`cat > file`), so permissions such as the executable bit survive.
- The result shows the edited lines with numbers, so the model can check its own change.

### Commands and tests

`run_command` and `run_tests` report the exit code, stdout and stderr, note timeouts, and clip
long output to 30k characters keeping the first third and the last two thirds: test failures
are usually summarised at the end.

## API

| Export                                        | What it does                                                                           |
| --------------------------------------------- | -------------------------------------------------------------------------------------- |
| `TOOLS`                                       | The definitions: description and Zod schema per tool.                                  |
| `toolSpecs(names?)`                           | JSON Schema versions for the LLM, optionally a subset (e.g. read-only tools).          |
| `parseToolCall(call)`                         | Validates a model's tool call: typed `args` with defaults, or an `error` to send back. |
| `ToolName`, `ToolArgs`, `ParsedToolCall`, ... | Types derived from the Zod schemas, in `src/types.ts`.                                 |

## Design notes

- **One source of truth.** Each tool's Zod schema gives the JSON Schema the model sees
  (`z.toJSONSchema` with `io: 'input'`, so arguments with defaults are optional) and the
  validation of what the model sends back. They can't drift apart.
- **Descriptions are prompt.** The model chooses tools from names, descriptions and schemas
  alone, so each description says when to use the tool and what its limits are.
- **Bad calls are feedback, not crashes.** Unknown tools, invalid JSON and schema violations come
  back as an `error` written for the model (listing valid tools, or which argument was wrong),
  so it can correct itself on the next turn.
- **Provider-safe schemas.** The `$schema` key is stripped; the specs are accepted by Gemini's
  OpenAI-compatible endpoint as well as Anthropic and OpenAI.

## Testing

```bash
pnpm --filter @weft/agent test               # unit tests
pnpm --filter @weft/agent test:integration   # tools and a scripted agent run in a real sandbox
```
