# @weft/agent

The coding agent: the tools it can call and (soon) the loop that drives them. Tools follow
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
| `run_tests`        | Run the repo's configured test command                                      |
| `finish`           | End the run with a summary of the change                                    |

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
pnpm --filter @weft/agent test
```
