import {
  createProvider,
  loadLLMConfig,
  textOf,
  toolCalls,
  withRetry,
  type Message,
  type ToolSpec,
} from '../src/index.ts';

const add: ToolSpec = {
  name: 'add',
  description: 'Add two integers and return the sum.',
  inputSchema: {
    type: 'object',
    properties: { a: { type: 'integer' }, b: { type: 'integer' } },
    required: ['a', 'b'],
    additionalProperties: false,
  },
};

const config = loadLLMConfig();
const llm = withRetry(createProvider(config), {
  onRetry: ({ attempt, delayMs, error }) =>
    console.log(`  retry ${attempt} in ${delayMs}ms (${error.kind}: ${error.message})`),
});

console.log(`provider=${llm.provider} model=${llm.model}`);

const messages: Message[] = [
  { role: 'user', content: [{ type: 'text', text: 'What is 1234 + 4321? Use the add tool.' }] },
];
const totals = { input: 0, output: 0, cached: 0, ms: 0 };

for (let turn = 1; turn <= 4; turn++) {
  const res = await llm.complete({
    system: 'You are a calculator. Always use the add tool for arithmetic, then answer briefly.',
    messages,
    tools: [add],
    maxTokens: 2048,
  });
  totals.input += res.usage.inputTokens;
  totals.output += res.usage.outputTokens;
  totals.cached += res.usage.cacheReadTokens;
  totals.ms += res.latencyMs;
  console.log(`turn ${turn}: stop=${res.stopReason} ${res.latencyMs}ms`);

  messages.push({ role: 'assistant', content: res.content });
  const calls = toolCalls(res.content);
  if (calls.length === 0) {
    console.log(`answer: ${textOf(res.content).trim()}`);
    break;
  }

  messages.push({
    role: 'user',
    content: calls.map((c) => {
      const { a, b } = (c.input ?? {}) as { a?: number; b?: number };
      console.log(`  tool ${c.name}(${JSON.stringify(c.input)})`);
      return c.inputError || typeof a !== 'number' || typeof b !== 'number'
        ? {
            type: 'tool_result',
            callId: c.id,
            content: c.inputError ?? 'a and b must be integers',
            isError: true,
          }
        : { type: 'tool_result', callId: c.id, content: String(a + b) };
    }),
  });
}

console.log(
  `tokens in=${totals.input} out=${totals.output} cached=${totals.cached} | llm time ${totals.ms}ms`,
);
