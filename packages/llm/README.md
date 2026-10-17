# @weft/llm

One interface over several LLM providers, so the agent loop never knows which model it's
talking to. Supports Anthropic natively, OpenAI-compatible APIs (OpenAI, Gemini, OpenRouter,
anything with a `/chat/completions` endpoint), and a scripted mock for tests.

```ts
import { createProvider, loadLLMConfig, textOf, toolCalls, withRetry } from '@weft/llm';

const llm = withRetry(createProvider(loadLLMConfig()));

const res = await llm.complete({
  system: 'You are a calculator.',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'What is 2 + 2?' }] }],
  tools: [{ name: 'add', description: 'Add two integers', inputSchema: { type: 'object' } }],
});

for (const call of toolCalls(res.content)) console.log(call.name, call.input);
console.log(textOf(res.content), res.usage, res.stopReason);
```

## Configuration

| Variable                                                                   | Meaning                                                                                |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `LLM_PROVIDER`                                                             | `mock` (default), `anthropic`, `openai`, `gemini`, `openrouter`                        |
| `LLM_MODEL`                                                                | Model id. Defaults: `mock`, `claude-haiku-5-5` for anthropic. Required for the others. |
| `LLM_BASE_URL`                                                             | Override the endpoint, e.g. a local Ollama server.                                     |
| `LLM_TIMEOUT_MS`                                                           | Per-request timeout (default 120000).                                                  |
| `ANTHROPIC_API_KEY` `OPENAI_API_KEY` `GEMINI_API_KEY` `OPENROUTER_API_KEY` | Key for the chosen provider.                                                           |

## API

| Export                                                                            | What it does                                                                                |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `loadLLMConfig(env?)` / `createProvider(config)`                                  | Env → validated config → provider.                                                          |
| `createAnthropicProvider`, `createOpenAICompatibleProvider`, `createMockProvider` | Build a provider directly.                                                                  |
| `withRetry(provider, opts)`                                                       | Retries transient failures; see below.                                                      |
| `LLMError`                                                                        | Every provider error is mapped to this, with `kind`, `status`, `retryable`, `retryAfterMs`. |
| `textOf`, `toolCalls`, `emptyUsage`                                               | Small helpers over content blocks.                                                          |
| Types (`Message`, `ContentBlock`, `ToolSpec`, …)                                  | All public types live in `src/types.ts`.                                                    |

## Design notes

- **One message format.** Content blocks are `text`, `tool_call`, `tool_result` and `opaque`.
  `opaque` carries provider-specific blocks (Claude's thinking blocks) that must be sent back
  unchanged; they're dropped when the conversation goes to a different provider.
- **Raw tool calls are kept.** Gemini attaches thought signatures to tool calls and requires
  them back on the next turn, so each `tool_call` keeps the object it arrived as.
- **Tool calls win over finish reasons.** Gemini can say `stop` while returning tool calls; any
  response containing tool calls is treated as `tool_use`.
- **Bad tool JSON doesn't throw.** The call is kept with `inputError` so the agent can tell the
  model and let it retry.
- **Usage is normalised.** `inputTokens` excludes cache reads, which are reported separately,
  so cost can be computed the same way for every provider.
- **One retry policy.** SDK retries are off. `withRetry` retries rate limits, overloads, 5xx,
  timeouts and network errors with full-jitter exponential backoff, honours `retry-after`, and
  fails fast on auth and bad-request errors.

## Testing

```bash
pnpm --filter @weft/llm test    # unit tests against fake clients
pnpm --filter @weft/llm smoke   # live tool-call round trip with the provider in .env
```

The smoke test asks the model to add two numbers with a tool and prints each turn, the tool
call, the answer and token usage. Run it after switching providers or upgrading an SDK.
