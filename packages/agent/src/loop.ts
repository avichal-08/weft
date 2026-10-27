import { emptyUsage, textOf, toolCalls, type Message, type ToolResultBlock } from '@weft/llm';
import { repoOverview } from './overview.ts';
import { systemPrompt } from './prompt.ts';
import { executeTool } from './tools/execute.ts';
import { parseToolCall } from './tools/parse.ts';
import { TOOL_NAMES, toolSpecs } from './tools/specs.ts';
import type { AgentEvent, AgentOptions, AgentResult, AgentStatus } from './types.ts';

export const DEFAULT_MAX_STEPS = 30;
const EVENT_OUTPUT_CHARS = 2000;
const NUDGE =
  'Your last response was empty. Continue working on the request using the tools, ' +
  'or reply to the user.';

export async function runAgent(opts: AgentOptions): Promise<AgentResult> {
  const execute = opts.execute ?? executeTool;
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
  const overview =
    opts.system || opts.overview === false ? null : await repoOverview(opts.ctx).catch(() => null);
  const system = opts.system ?? systemPrompt(opts.ctx.testCommand, overview);
  const tools = toolSpecs(
    opts.ctx.testCommand ? TOOL_NAMES : TOOL_NAMES.filter((name) => name !== 'run_tests'),
  );

  const messages: Message[] = [
    ...(opts.history ?? []),
    { role: 'user', content: [{ type: 'text', text: opts.task }] },
  ];
  const events: AgentEvent[] = [];
  const usage = emptyUsage();
  let nudges = 0;
  let step = 0;

  const emit = (event: AgentEvent) => {
    events.push(event);
    opts.onEvent?.(event);
  };
  const done = (status: AgentStatus, summary?: string): AgentResult => ({
    status,
    summary,
    steps: step,
    usage,
    messages,
    events,
  });

  while (step < maxSteps) {
    if (opts.signal?.aborted) return done('aborted');
    step++;

    const res = await opts.llm.complete({
      system,
      messages,
      tools,
      ...(opts.maxTokens ? { maxTokens: opts.maxTokens } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    usage.inputTokens += res.usage.inputTokens;
    usage.outputTokens += res.usage.outputTokens;
    usage.cacheReadTokens += res.usage.cacheReadTokens;
    usage.cacheWriteTokens += res.usage.cacheWriteTokens;
    messages.push({ role: 'assistant', content: res.content });
    emit({
      type: 'llm',
      step,
      stopReason: res.stopReason,
      usage: res.usage,
      latencyMs: res.latencyMs,
      text: textOf(res.content),
    });

    const calls = toolCalls(res.content);
    if (calls.length === 0) {
      if (res.stopReason === 'refusal') return done('refusal');
      if (res.stopReason === 'max_tokens') return done('max_tokens');
      const reply = textOf(res.content).trim();
      if (reply) return done('finished', reply);
      if (nudges >= (opts.maxNudges ?? 1)) return done('no_tool_call');
      nudges++;
      messages.push({ role: 'user', content: [{ type: 'text', text: NUDGE }] });
      continue;
    }

    const results: ToolResultBlock[] = [];
    let summary: string | undefined;

    for (const call of calls) {
      const started = performance.now();
      const parsed = parseToolCall(call);
      const out = parsed.ok
        ? await execute(opts.ctx, parsed)
        : { content: parsed.error, isError: true };

      results.push({
        type: 'tool_result',
        callId: call.id,
        content: out.content,
        isError: out.isError,
      });
      emit({
        type: 'tool',
        step,
        id: call.id,
        name: call.name,
        args: parsed.ok ? parsed.args : call.input,
        isError: out.isError,
        durationMs: Math.round(performance.now() - started),
        output: out.content.slice(0, EVENT_OUTPUT_CHARS),
      });
      if (parsed.ok && parsed.name === 'finish') summary = parsed.args.summary;
    }

    messages.push({ role: 'user', content: results });
    if (summary !== undefined) return done('finished', summary);
  }

  return done('max_steps');
}
