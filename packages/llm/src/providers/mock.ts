import { emptyUsage } from '../content.ts';
import type { CompletionRequest, CompletionResponse, MockProvider, MockScript } from '../types.ts';

export function createMockProvider(script: MockScript, model = 'mock'): MockProvider {
  const calls: CompletionRequest[] = [];

  return {
    provider: 'mock',
    model,
    calls,
    complete(req: CompletionRequest): Promise<CompletionResponse> {
      const turn = calls.length;
      const { signal: _signal, ...recorded } = req;
      calls.push(structuredClone(recorded));
      const next = typeof script === 'function' ? script(req, turn) : script[turn];
      if (next instanceof Error) return Promise.reject(next);
      if (!next) return Promise.reject(new Error(`mock script has no turn ${turn}`));
      return Promise.resolve({
        content: next.content,
        stopReason:
          next.stopReason ??
          (next.content.some((b) => b.type === 'tool_call') ? 'tool_use' : 'end'),
        usage: { ...emptyUsage(), ...next.usage },
        model,
        latencyMs: 0,
      });
    },
  };
}
