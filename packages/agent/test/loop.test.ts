import { createMockProvider, LLMError, type ContentBlock, type MockTurn } from '@weft/llm';
import type { Sandbox } from '@weft/sandbox';
import { describe, expect, it } from 'vitest';
import { runAgent } from '../src/loop.ts';
import { systemPrompt } from '../src/prompt.ts';
import { createToolContext } from '../src/tools/execute.ts';
import { runTests } from '../src/tools/run.ts';
import type { ToolExecutor } from '../src/types.ts';

const ctx = createToolContext({ sandbox: {} as Sandbox, root: '/w', testCommand: 'npm test' });

const tool = (name: string, input: unknown, id = name): ContentBlock => ({
  type: 'tool_call',
  id,
  name,
  input,
});
const text = (t: string): ContentBlock => ({ type: 'text', text: t });
const turn = (...content: ContentBlock[]): MockTurn => ({
  content,
  usage: { inputTokens: 100, outputTokens: 10 },
});

const echo: ToolExecutor = (_ctx, call) =>
  Promise.resolve({ content: `ran ${call.name}`, isError: false });

describe('runAgent', () => {
  it('runs tools until finish and returns the summary', async () => {
    const llm = createMockProvider([
      turn(text('looking'), tool('grep', { pattern: 'add' })),
      turn(tool('finish', { summary: 'fixed add' })),
    ]);
    const res = await runAgent({ llm, ctx, task: 'fix it', execute: echo });

    expect(res).toMatchObject({ status: 'finished', summary: 'fixed add', steps: 2 });
    expect(res.usage).toMatchObject({ inputTokens: 200, outputTokens: 20 });
    expect(res.events.map((e) => `${e.type}:${e.type === 'tool' ? e.name : e.step}`)).toEqual([
      'llm:1',
      'tool:grep',
      'llm:2',
      'tool:finish',
    ]);
  });

  it('sends the task, system prompt and every tool to the model', async () => {
    const llm = createMockProvider([turn(tool('finish', { summary: 's' }))]);
    await runAgent({ llm, ctx, task: 'the task', execute: echo });

    const req = llm.calls[0]!;
    expect(req.messages[0]).toEqual({ role: 'user', content: [text('the task')] });
    expect(req.system).toContain('npm test');
    expect(req.tools?.map((t) => t.name)).toContain('str_replace_edit');
  });

  it('answers every call of a turn in one message, including invalid ones', async () => {
    const llm = createMockProvider([
      turn(tool('view_file', { path: 'a.ts' }, 'c1'), tool('nope', {}, 'c2')),
      turn(tool('finish', { summary: 's' })),
    ]);
    await runAgent({ llm, ctx, task: 't', execute: echo });

    const results = llm.calls[1]!.messages.at(-1)!;
    expect(results.role).toBe('user');
    expect(results.content).toMatchObject([
      { type: 'tool_result', callId: 'c1', content: 'ran view_file', isError: false },
      { type: 'tool_result', callId: 'c2', isError: true },
    ]);
  });

  it('stops at the step budget', async () => {
    const llm = createMockProvider(() => turn(tool('glob', { pattern: '*' })));
    const res = await runAgent({ llm, ctx, task: 't', maxSteps: 3, execute: echo });
    expect(res).toMatchObject({ status: 'max_steps', steps: 3 });
  });

  it('nudges once when the model stops calling tools', async () => {
    const llm = createMockProvider([
      turn(text('I think it works')),
      turn(tool('finish', { summary: 's' })),
    ]);
    const res = await runAgent({ llm, ctx, task: 't', execute: echo });

    expect(res.status).toBe('finished');
    const nudge = llm.calls[1]!.messages.at(-1)!.content[0];
    expect(nudge?.type === 'text' && nudge.text).toMatch(/without calling a tool/);
  });

  it('gives up after the nudge is ignored', async () => {
    const llm = createMockProvider([turn(text('done?')), turn(text('done.'))]);
    const res = await runAgent({ llm, ctx, task: 't', execute: echo });
    expect(res).toMatchObject({ status: 'no_tool_call', summary: 'done.', steps: 2 });
  });

  it.each([
    ['refusal', 'refusal'],
    ['max_tokens', 'max_tokens'],
  ] as const)('ends with %s', async (stopReason, status) => {
    const llm = createMockProvider([{ content: [text('...')], stopReason }]);
    expect((await runAgent({ llm, ctx, task: 't', execute: echo })).status).toBe(status);
  });

  it('stops when aborted between steps', async () => {
    const abort = new AbortController();
    const llm = createMockProvider(() => turn(tool('glob', { pattern: '*' })));
    const execute: ToolExecutor = async (c, call) => {
      abort.abort();
      return echo(c, call);
    };
    const res = await runAgent({ llm, ctx, task: 't', signal: abort.signal, execute });
    expect(res).toMatchObject({ status: 'aborted', steps: 1 });
  });

  it('lets infrastructure errors propagate', async () => {
    const llm = createMockProvider(
      () => new LLMError({ kind: 'auth', provider: 'mock', message: 'bad key' }),
    );
    await expect(runAgent({ llm, ctx, task: 't', execute: echo })).rejects.toMatchObject({
      kind: 'auth',
    });
  });

  it('puts earlier turns before the new message', async () => {
    const llm = createMockProvider([turn(tool('finish', { summary: 's' }))]);
    const history = [
      { role: 'user' as const, content: [text('What does add do?')] },
      { role: 'assistant' as const, content: [text('It adds two numbers.')] },
    ];
    await runAgent({ llm, ctx, task: 'Make it handle strings', history, execute: echo });

    expect(llm.calls[0]!.messages).toEqual([
      ...history,
      { role: 'user', content: [text('Make it handle strings')] },
    ]);
  });

  it('only offers run_tests when a test command is configured', async () => {
    const without = createToolContext({ sandbox: {} as Sandbox, root: '/w' });
    const llm = createMockProvider([turn(tool('finish', { summary: 's' }))]);
    await runAgent({ llm, ctx: without, task: 't', execute: echo });
    const names = llm.calls[0]!.tools!.map((t) => t.name);
    expect(names).not.toContain('run_tests');
    expect(names).toContain('run_command');
    expect(llm.calls[0]!.system).toContain('No test command is configured');
  });
});

describe('systemPrompt', () => {
  it('names the test command when there is one', () => {
    expect(systemPrompt('npm test')).toContain('The test command is: npm test');
    expect(systemPrompt(null)).not.toContain('The test command is');
  });

  it('frames finish as the reply to the user', () => {
    expect(systemPrompt(null)).toMatch(/summary is your reply to the user/);
  });
});

describe('runTests without a test command', () => {
  it('tells the model to use run_command instead', async () => {
    const out = await runTests(createToolContext({ sandbox: {} as Sandbox, root: '/w' }));
    expect(out).toEqual({
      isError: true,
      content: 'No test command is configured for this repository. Use run_command instead.',
    });
  });
});
