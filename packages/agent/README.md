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

## The loop

```ts
const ctx = createToolContext({ sandbox, root: '/workspace/repo', testCommand: 'npm test' });
const res = await runAgent({
  llm,
  ctx,
  task: 'Now make the toggle remember the choice',
  history, // earlier turns: the user's messages and the agent's replies
  onEvent: console.log,
  onText: (step, e) => e.type === 'text' && process.stdout.write(e.text), // optional streaming
});
// res.summary is the reply to the user; also res.status, steps, usage, events, messages
```

The agent is a chat agent, not only a test fixer: a message can be a question, a change, a
review or a follow-up. The system prompt (`src/prompt.ts`) has it read the relevant code first,
answer questions without editing, make focused edits for change requests, and end every turn
with a reply in plain text: a response without a tool call ends the turn, and its text is
`res.summary`, the reply shown to the user. A reply is ordinary model text, so it streams like
any other (see below). `history` goes before the new message, so follow-ups have context.

**Streaming** (`onText(step, event)`): when set, every model call streams, and each piece of
text arrives as `{ type: 'text', text }` tagged with its step, plus `{ type: 'reset' }` if a
retried call throws away text it already sent. The text of a step that ends in tool calls is the
model's note before acting; the text of the last step is the reply. Events and the trace are
unchanged: the complete text still arrives in the step's `llm` event.

**Ask mode** (`mode: 'ask'`) makes a turn read-only: the model is offered only `grep`, `glob` and
`view_file`, and the prompt tells it to answer from the code and, when asked for a
change, to say what it would change and suggest Code mode. The loop refuses any tool it didn't
offer, whatever the mode, so a model that calls `str_replace_edit` or `run_command` anyway gets an
error back and nothing runs. Why: [ADR 0008](../../docs/decisions/0008-ask-mode.md).

**Token budget** (`tokenBudget`, default `DEFAULT_TOKEN_BUDGET` = 500k): the input, cached and
output tokens a turn may use. Once 80% is spent the model is told, once, to finish the current
change and reply; once it is all spent the loop stops with `budget` before the next model call. A
step that replies still finishes normally. Why: [ADR 0010](../../docs/decisions/0010-token-budget.md).

**Tests are optional.** With a `testCommand`, the agent checks changes with `run_tests`. Without
one, `run_tests` is not offered at all, and the prompt tells the agent to use `run_command` if
the repo clearly has tests.

Each step sends the conversation to the model, runs every tool call it made, and sends all the
results back in one message (the APIs require every call to be answered, failed ones included).

| Status         | When                                                                          |
| -------------- | ----------------------------------------------------------------------------- |
| `finished`     | The model called `finish`, or answered in plain text; `summary` is the reply. |
| `max_steps`    | The step budget (default 30) ran out.                                         |
| `budget`       | The token budget (`tokenBudget`, default 500k) was spent; see below.          |
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

## Eval

```bash
pnpm --filter @weft/agent eval --provider gemini --model gemini-3.1-flash-lite --label baseline --repeat 2
pnpm --filter @weft/agent eval --label baseline --repeat 2 --resume   # continue after a quota stop
pnpm --filter @weft/agent eval --only q- --max-steps 10               # a subset
pnpm --filter @weft/agent eval --mode ask --label ask --repeat 2     # read-only, no-edit cases only
pnpm --filter @weft/agent eval --overview false --label baseline      # without the repo overview
pnpm --filter @weft/agent eval:report --label baseline --label fix    # writes eval/REPORT.md
```

A repeatable check of the agent on realistic chat tasks, run against a real model in real
sandboxes, the same loop the worker runs. Cases live in `eval/cases.ts`, each with a category
(question, bugfix, feature, followup, trap), a fixture repo, optional files
seeded into the base commit (a bug), earlier turns for follow-ups (history plus their uncommitted
changes), and **hidden tests**.

Seventeen cases on two fixtures:

- `fixtures/shop`, a tiny cart/discount/money library with a real bug (1005 cents prints as
  `$10.5`), so questions about it tempt the agent to "just fix it";
- `fixtures/playground`, a snapshot of
  [weft-playground](https://github.com/avichal-08/weft-playground) `main` (`2a7a52a`): seven small
  modules with 39 tests. Its README and task list are left out so the agent gets no hints; seeded
  bugs are its own bug branches, applied by `cases.ts` to the snapshot.

| Category   | Cases                                                                                                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Questions  | how a discount is applied, why 1005 prints wrong, a review, the test runner                                                                                                   |
| Bug fixes  | the money bug, no shipping on an empty cart, an LRU cache that forgets reads, prototype pollution in `deepMerge`                                                              |
| Features   | `isBlank`, a new `clamp` module, weeks in `parseDuration`                                                                                                                     |
| Follow-ups | "what did you change?", "does that fix work for negatives?", case-insensitive codes after `FREESHIP`                                                                          |
| Traps      | a follow-up asking for a test (must really add it), re-adding the existing `truncate` (must say it exists, not rewrite it or its tests), testing `chunk([])` (already tested) |

The traps come from failures seen in real chats: an agent that said it added a test without
editing anything, and one that replaced an existing function and rewrote its tests to match.
`test/eval-cases.test.ts` checks the eval itself without a model: every seed really changes its
file, every hidden test fails before the agent runs, and passes with a reference fix.

**Grading** (`eval/score.ts`), after the agent finishes:

- **Edits only when asked**: questions must leave the files alone; changes must change them.
- **Pass-to-pass**: every test file that existed before is restored to its original content,
  then run. A fix can't pass by rewriting or deleting the tests it should satisfy.
- **Fail-to-pass**: test files the agent never saw (`hidden`) are added and run; they check the
  bug is fixed or the feature works.
- **Honest reply**: a reply that claims a change ("added", "fixed", "updated", ...) when nothing
  changed is a **phantom edit**. Traps can also forbid touching existing tests (`keepTests`),
  require a file to contain something (`files`), and replies can be required to mention or not
  say certain things.

**Ask mode** (`--mode ask`) runs the agent read-only and only the cases that expect no edits (the
questions, the follow-ups that recall or ask, and the traps whose answer is that the work already
exists), since a change request can't pass without editing. Rows record their `mode`.

**Measured per run**: steps, input, output and cached tokens, cost at the paid-tier list price
(`eval/pricing.ts`, with its source, whatever tier the keys are on), wall time and time spent in the
model, tool errors, searches aimed at other languages (`*.py` in a JS repo), which existing
tests were touched, and their diff. From the diff the report counts **rewritten test lines**: a
removed line counts unless an added line keeps all of its words in order, so extending an import
or an assertion is fine, while changing an expected value, deleting an assertion, commenting it
out or adding `.skip` is not. Agents are not deterministic, so cases run `--repeat` times and the report
counts cases that pass **every** repeat, not just once.

**Built for rate limits**: results are appended to `eval/results/<label>-<model>.jsonl` as each run
finishes (git-ignored). A provider error is recorded but not scored; a daily-quota error stops
the run, and `--resume` continues where it stopped without repeating finished runs. Steps are
capped at 15 by default (`--max-steps`).

**Report** (`eval/report.ts`): one column per label and model with pass rate overall and per
category, cases passing every repeat, phantom edits, runs that changed existing tests, cost per
task, median time, mean steps and tokens, plus a pass count per case. `eval/REPORT.md` is
committed; the raw results are not. Columns follow the order of `--label`.

### What the runs showed

- **`baseline`** (no overview): `gemini-3.1-flash-lite` passed 32/34. The real failure was
  `f-follow-up-question`, 0/2: asked what an input returns, it added an assertion to
  `test/money.test.js` to find out, despite the prompt's rule. `gemini-2.5-flash-lite` (8 cases,
  quota-limited) grepped for `*.py` in a JavaScript repository in 5 runs and gave up.
- **`overview`** (repository overview in the prompt): searches in other languages on
  `gemini-2.5-flash-lite` dropped to none in the 5 cases rerun, but it still stopped after one
  search, passing 1/5. On `gemini-3.1-flash-lite` it passed 30/34: `f-follow-up-question` still
  edited tests, and one run of `f-follow-up-change` changed an existing test's input instead of
  adding a test, which the rewritten-lines check flagged. Not a measurable change either way at two
  repeats.
- **`ask`** (Ask mode, the 8 no-edit cases): 16/16, including `f-follow-up-question`, where Code mode passed
  14/16 (`baseline`) and 12/16 (`overview`) on the same cases, at 6.1k tokens per task against 12.9k. Making the turn read-only fixed what the prompt rule and the overview did not.
- **`text-reply`** (the reply as plain text instead of a `finish` tool call, the rest as in
  `overview`): 34/34 on `gemini-3.1-flash-lite`, every case passing both repeats, against 30/34
  with `finish`. `f-follow-up-question`, `f-own-change` and `q-review` all went to 2/2. Without a
  final tool call the agent answers in the same step, so turns averaged 6.4 steps instead of 7.2
  and 15.7k tokens instead of 19.4k. Wall time rose (65 s median) only because rate-limit retries
  of up to a minute landed in this run.

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
