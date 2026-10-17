import { z } from 'zod';
import { createAnthropicProvider } from './providers/anthropic.ts';
import { createMockProvider } from './providers/mock.ts';
import { createOpenAICompatibleProvider } from './providers/openai-compatible.ts';
import type { LLMConfig, LLMProvider, ProviderName } from './types.ts';

const PROVIDER_NAMES = {
  mock: 'mock',
  anthropic: 'anthropic',
  openai: 'openai',
  gemini: 'gemini',
  openrouter: 'openrouter',
} as const satisfies { [K in ProviderName]: K };

export const PROVIDERS: readonly ProviderName[] = Object.values(PROVIDER_NAMES);

const OPENAI_COMPATIBLE: Record<
  Exclude<ProviderName, 'mock' | 'anthropic'>,
  { baseURL: string; keyEnv: string; headers?: Record<string, string> }
> = {
  openai: { baseURL: 'https://api.openai.com/v1', keyEnv: 'OPENAI_API_KEY' },
  gemini: {
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    keyEnv: 'GEMINI_API_KEY',
  },
  openrouter: {
    baseURL: 'https://openrouter.ai/api/v1',
    keyEnv: 'OPENROUTER_API_KEY',
    headers: { 'X-Title': 'weft' },
  },
};

const DEFAULT_MODEL: Partial<Record<ProviderName, string>> = {
  mock: 'mock',
  anthropic: 'claude-haiku-5-5',
};

const envSchema = z.object({
  LLM_PROVIDER: z.enum(PROVIDER_NAMES).default('mock'),
  LLM_MODEL: z.string().trim().optional(),
  LLM_BASE_URL: z.url().optional(),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
});

const blankToUndefined = (env: NodeJS.ProcessEnv) =>
  Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ''));

export function loadLLMConfig(env: NodeJS.ProcessEnv = process.env): LLMConfig {
  const parsed = envSchema.parse(blankToUndefined(env));
  const provider = parsed.LLM_PROVIDER;
  const model = parsed.LLM_MODEL || DEFAULT_MODEL[provider];
  if (!model) {
    throw new Error(`LLM_MODEL is required when LLM_PROVIDER=${provider}`);
  }

  let apiKey: string | undefined;
  if (provider === 'anthropic') apiKey = env.ANTHROPIC_API_KEY || undefined;
  if (provider !== 'mock' && provider !== 'anthropic') {
    const keyEnv = OPENAI_COMPATIBLE[provider].keyEnv;
    apiKey = env[keyEnv] || undefined;
    if (!apiKey) throw new Error(`${keyEnv} is required when LLM_PROVIDER=${provider}`);
  }

  return {
    provider,
    model,
    apiKey,
    baseURL: parsed.LLM_BASE_URL,
    timeoutMs: parsed.LLM_TIMEOUT_MS,
  };
}

export function createProvider(config: LLMConfig): LLMProvider {
  const common = {
    model: config.model,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    ...(config.timeoutMs ? { timeoutMs: config.timeoutMs } : {}),
  };

  switch (config.provider) {
    case 'mock':
      return createMockProvider(() => ({ content: [{ type: 'text', text: 'ok' }] }), config.model);
    case 'anthropic':
      return createAnthropicProvider({
        ...common,
        ...(config.apiKey ? { apiKey: config.apiKey } : {}),
      });
    default: {
      const preset = OPENAI_COMPATIBLE[config.provider];
      return createOpenAICompatibleProvider({
        baseURL: preset.baseURL,
        ...common,
        provider: config.provider,
        apiKey: config.apiKey ?? '',
        ...(preset.headers ? { headers: preset.headers } : {}),
      });
    }
  }
}
