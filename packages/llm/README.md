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
| `retryAfterMs(headers)`, `retryDelayFromBody(body, message)`                      | How `retryAfterMs` is found: headers first, then the error body.                            |
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
  timeouts and network errors with full-jitter exponential backoff, and fails fast on auth and
  bad-request errors. When the server says how long to wait, that wins over backoff: the
  `retry-after` / `retry-after-ms` headers, or, for Gemini, which sends neither, the
  `RetryInfo.retryDelay` in the error body (falling back to "retry in 54s" in the message). A
  server delay is honoured exactly up to `maxRetryAfterMs` (default 2 min); a longer one, such as
  an exhausted daily quota, fails at once rather than parking a worker for hours.
- **Streaming is opt-in and invisible to callers.** Pass `onText` in the request and the
  provider uses its streaming API (Anthropic's `messages.stream`, OpenAI-compatible `stream: true`
  with usage included), calls `onText({ type: 'text', text })` for each piece of text, and still
  resolves with the same `CompletionResponse`. Without `onText`, nothing changes. The
  OpenAI-compatible stream is reassembled by `assembleStream`: text is concatenated, tool calls
  are joined by `index`, or by `id` when the server omits the index (Gemini sends each call whole
  and without one), and any extra fields such as Gemini's thought signatures are kept.
- **A retry after streamed text resets it.** If an attempt fails after some text was streamed,
  `withRetry` sends `onText({ type: 'reset' })` before retrying, so a consumer drops the partial
  reply instead of showing it twice. The mock provider streams its text in 8-character pieces.

## Testing

```bash
pnpm --filter @weft/llm test    # unit tests against fake clients
pnpm --filter @weft/llm smoke   # live tool-call round trip with the provider in .env
```

The smoke test asks the model to add two numbers with a tool and prints each turn, the tool
call, the answer and token usage. Run it after switching providers or upgrading an SDK.
