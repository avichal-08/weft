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
  it('runs tools until a text reply and returns it', async () => {
    const llm = createMockProvider([
      turn(text('looking'), tool('grep', { pattern: 'add' })),
      turn(text('fixed add')),
    ]);
    const res = await runAgent({ llm, ctx, task: 'fix it', execute: echo });

    expect(res).toMatchObject({ status: 'finished', summary: 'fixed add', steps: 2 });
    expect(res.usage).toMatchObject({ inputTokens: 200, outputTokens: 20 });
    expect(res.events.map((e) => `${e.type}:${e.type === 'tool' ? e.name : e.step}`)).toEqual([
      'llm:1',
      'tool:grep',
      'llm:2',
    ]);
  });

  it('sends the task, system prompt and every tool to the model', async () => {
    const llm = createMockProvider([turn(text('s'))]);
    await runAgent({ llm, ctx, task: 'the task', execute: echo });

    const req = llm.calls[0]!;
    expect(req.messages[0]).toEqual({ role: 'user', content: [text('the task')] });
    expect(req.system).toContain('npm test');
    expect(req.tools?.map((t) => t.name)).toContain('str_replace_edit');
  });

  it('answers every call of a turn in one message, including invalid ones', async () => {
    const llm = createMockProvider([
      turn(tool('view_file', { path: 'a.ts' }, 'c1'), tool('nope', {}, 'c2')),
      turn(text('s')),
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

  it('warns once near the token budget, then stops when it is spent', async () => {
    const llm = createMockProvider(() => turn(tool('glob', { pattern: '*' })));
    const res = await runAgent({ llm, ctx, task: 't', tokenBudget: 500, execute: echo });
    expect(res).toMatchObject({ status: 'budget', steps: 5 });
    const warnings = res.messages.flatMap((m) =>
      m.content.filter((b) => b.type === 'text' && b.text.includes('token budget')),
    );
    expect(warnings).toHaveLength(1);
    expect(res.messages.findIndex((m) => m.content.includes(warnings[0]!))).toBe(8);
  });

  it('still finishes when the last step replies past the budget', async () => {
    const llm = createMockProvider([turn(tool('glob', { pattern: '*' })), turn(text('done'))]);
    const res = await runAgent({ llm, ctx, task: 't', tokenBudget: 150, execute: echo });
    expect(res).toMatchObject({ status: 'finished', summary: 'done' });
  });

  it('streams text to onText, tagged with its step', async () => {
    const llm = createMockProvider([
      turn(text('Looking.'), tool('grep', { pattern: 'add' })),
      turn(text('It adds two numbers.')),
    ]);
    const streamed: Record<number, string> = {};
    const res = await runAgent({
      llm,
      ctx,
      task: 't',
      execute: echo,
      onText: (step, e) => {
        if (e.type === 'text') streamed[step] = (streamed[step] ?? '') + e.text;
      },
    });
    expect(streamed).toEqual({ 1: 'Looking.', 2: 'It adds two numbers.' });
    expect(res.summary).toBe('It adds two numbers.');
  });

  it('treats a plain-text answer as the reply', async () => {
    const llm = createMockProvider([turn(text('It adds two numbers.'))]);
    const res = await runAgent({ llm, ctx, task: 'what does add do?', execute: echo });
    expect(res).toMatchObject({ status: 'finished', summary: 'It adds two numbers.', steps: 1 });
  });

  it('nudges once when the model returns nothing', async () => {
    const llm = createMockProvider([turn(text('  ')), turn(text('s'))]);
    const res = await runAgent({ llm, ctx, task: 't', execute: echo });

    expect(res.status).toBe('finished');
    const nudge = llm.calls[1]!.messages.at(-1)!.content[0];
    expect(nudge?.type === 'text' && nudge.text).toMatch(/last response was empty/);
  });

  it('gives up after the nudge is ignored', async () => {
    const llm = createMockProvider([turn(text('')), turn(text(''))]);
    const res = await runAgent({ llm, ctx, task: 't', execute: echo });
    expect(res).toMatchObject({ status: 'no_tool_call', steps: 2 });
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
    const llm = createMockProvider([turn(text('s'))]);
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
    const llm = createMockProvider([turn(text('s'))]);
    await runAgent({ llm, ctx: without, task: 't', execute: echo });
    const names = llm.calls[0]!.tools!.map((t) => t.name);
    expect(names).not.toContain('run_tests');
    expect(names).toContain('run_command');
    expect(llm.calls[0]!.system).toContain('No test command is configured');
  });

  it('refuses a tool it did not offer', async () => {
    const without = createToolContext({ sandbox: {} as Sandbox, root: '/w' });
    const llm = createMockProvider([turn(tool('run_tests', {})), turn(text('s'))]);
    const res = await runAgent({ llm, ctx: without, task: 't', execute: echo });
    expect(res.events.find((e) => e.type === 'tool' && e.name === 'run_tests')).toMatchObject({
      isError: true,
      output: 'run_tests is not available in this repository.',
    });
  });

  describe('in Ask mode', () => {
    it('offers only the read-only tools and says so in the prompt', async () => {
      const llm = createMockProvider([turn(text('s'))]);
      await runAgent({ llm, ctx, task: 't', mode: 'ask', execute: echo });
      expect(llm.calls[0]!.tools!.map((t) => t.name)).toEqual(['grep', 'glob', 'view_file']);
      expect(llm.calls[0]!.system).toContain('Ask mode');
      expect(llm.calls[0]!.system).not.toContain('str_replace_edit');
    });

    it('never executes an edit or a command, even when the model calls one', async () => {
      const executed: string[] = [];
      const record: ToolExecutor = (c, call) => {
        executed.push(call.name);
        return echo(c, call);
      };
      const llm = createMockProvider([
        turn(
          tool('str_replace_edit', { path: 'a.js', old_str: 'a', new_str: 'b' }, 'e'),
          tool('create_file', { path: 'b.js', content: 'x' }, 'c'),
          tool('run_command', { command: 'rm -rf src' }, 'r'),
          tool('view_file', { path: 'a.js' }, 'v'),
        ),
        turn(text('answered')),
      ]);
      const res = await runAgent({ llm, ctx, task: 't', mode: 'ask', execute: record });
      expect(executed).toEqual(['view_file']);
      expect(res.status).toBe('finished');
      const refused = res.events.filter((e) => e.type === 'tool' && e.isError);
      expect(refused).toHaveLength(3);
      expect(refused[0]?.type === 'tool' && refused[0].output).toContain('Ask mode');
    });
  });
});

describe('systemPrompt', () => {
  it('names the test command when there is one', () => {
    expect(systemPrompt('npm test')).toContain('The test command is: npm test');
    expect(systemPrompt(null)).not.toContain('The test command is');
  });

  it('asks for the reply as plain text, which ends the turn', () => {
    expect(systemPrompt(null)).toMatch(/reply to the user in plain text, without calling a tool/);
    expect(systemPrompt(null)).not.toMatch(/\bfinish\b/);
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
