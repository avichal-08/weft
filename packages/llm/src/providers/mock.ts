import { emptyUsage } from '../content.ts';
import type { CompletionRequest, CompletionResponse, MockProvider, MockScript } from '../types.ts';

const MOCK_CHUNK = 8;

export function createMockProvider(script: MockScript, model = 'mock'): MockProvider {
  const calls: CompletionRequest[] = [];

  return {
    provider: 'mock',
    model,
    calls,
    complete(req: CompletionRequest): Promise<CompletionResponse> {
      const turn = calls.length;
      const { signal: _signal, onText, ...recorded } = req;
      calls.push(structuredClone(recorded));
      const next = typeof script === 'function' ? script(req, turn) : script[turn];
      if (next instanceof Error) return Promise.reject(next);
      if (!next) return Promise.reject(new Error(`mock script has no turn ${turn}`));
      if (onText) {
        for (const b of next.content) {
          if (b.type !== 'text') continue;
          for (let i = 0; i < b.text.length; i += MOCK_CHUNK) {
            onText({ type: 'text', text: b.text.slice(i, i + MOCK_CHUNK) });
          }
        }
      }
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
