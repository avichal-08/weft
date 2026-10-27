export const PRICES_SOURCE =
  'https://ai.google.dev/gemini-api/docs/pricing (paid tier, standard, read 2026-10-27)';

type Price = { input: number; output: number; cached: number };

const PER_MILLION: Record<string, Price> = {
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4, cached: 0.01 },
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.5, cached: 0.025 },
  'gemini-3.5-flash-lite': { input: 0.3, output: 2.5, cached: 0.03 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5, cached: 0.03 },
  'gemini-3-flash-preview': { input: 0.5, output: 3, cached: 0.05 },
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
};

// inputTokens excludes cached tokens: the adapters report cache reads separately

export function costUsd(model: string, usage: TokenUsage): number | null {
  const price = PER_MILLION[model];
  if (!price) return null;
  return (
    (usage.inputTokens * price.input +
      usage.cacheReadTokens * price.cached +
      usage.outputTokens * price.output) /
    1e6
  );
}
