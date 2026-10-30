# 0014. Streaming the reply, and ending turns with plain text

- Status: Accepted
- Date: 2026-10-30

## Context

A turn's steps already streamed to the browser as they happened, but the reply did not: the
model was called without streaming, and the reply was the `summary` argument of a `finish` tool
call, shown only once the turn was over. For a long answer the page sat on "Thinking" and then
showed everything at once.

Streaming a tool call's argument is awkward. Anthropic and OpenAI stream tool arguments as
fragments of JSON, so the reply would have to be pulled out of a partial JSON document. Gemini,
through its OpenAI-compatible API, sends each function call whole, so with the reply inside
`finish` nothing would stream at all on that provider.

## Decision

- **The reply is the model's final plain text.** The `finish` tool is removed; the prompt tells
  the model to reply without calling a tool, and a response without a tool call ends the turn.
  This is how Claude Code and the Anthropic agent SDK end a turn, and text streams on every
  provider.
- **Opt-in streaming in `@weft/llm`.** A request with `onText` streams (Anthropic's
  `messages.stream`, OpenAI-compatible `stream: true` with usage) and still returns the same
  `CompletionResponse`, so callers that don't stream are unchanged. `withRetry` sends a `reset`
  when it retries after text was streamed.
- **Batched, offset-addressed live messages.** The worker passes `onText` to the agent and
  publishes each step's text to the run's Redis stream at most every 50 ms as
  `{ kind: 'text', step, offset, text }`, flushing a step before its `llm` event. A reader sets
  the step's text to its first `offset` characters plus `text`, so replays after a reconnect
  overwrite instead of duplicating, and `offset: 0` with empty text clears a retried step. Text
  is not stored in Postgres; the step's `llm` event carries the complete text.
- **The browser shows the reply as it grows.** The live work log renders the latest step's text
  as markdown; text from a step that turns out to call tools becomes a note in the work log, and
  when the run ends the reply is already on screen.

## Alternatives considered

**Keep `finish` and parse its arguments incrementally.** No change to how the agent behaves, but
an incremental JSON parser for one field, and still no streaming on Gemini.

**Stream every token as its own message.** The smoothest possible display, but hundreds of Redis
entries per reply and as many SSE messages; 50 ms batches are indistinguishable to a reader and
an order of magnitude fewer.

**Store streamed text in Postgres.** Would let a page opened mid-turn show text from before it
connected without the Redis stream, but the stream already covers that while the turn runs, and
the final event covers it afterwards.

## Consequences

- Measured on the eval suite with `gemini-3.1-flash-lite`, 17 tasks × 2: 34/34 passed with plain
  text against 30/34 with `finish`, with 6.4 steps instead of 7.2 and 15.7k tokens instead of
  19.4k per task, because the reply no longer needs a tool call of its own.
- Gemini streams in coarse chunks (often more than a hundred characters), so on Gemini a reply
  arrives in a few bursts; Anthropic streams far finer.
- Text the model writes before calling tools appears briefly as if it were the reply, then moves
  into the work log once the step's tool calls arrive.
- The live stream's cap rose from about 5,000 to 10,000 entries to leave room for text messages.
- Traces written before this change still contain `finish` calls; the web app still reads them.
