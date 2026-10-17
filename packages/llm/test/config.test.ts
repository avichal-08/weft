import { describe, expect, it } from 'vitest';
import { createProvider, loadLLMConfig } from '../src/config.ts';

describe('loadLLMConfig', () => {
  it('defaults to the mock provider', () => {
    expect(loadLLMConfig({})).toMatchObject({ provider: 'mock', model: 'mock' });
  });

  it('defaults anthropic to haiku', () => {
    expect(loadLLMConfig({ LLM_PROVIDER: 'anthropic' })).toMatchObject({
      model: 'claude-haiku-5-5',
    });
  });

  it('requires a model for gemini and openrouter', () => {
    expect(() => loadLLMConfig({ LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'k' })).toThrow(
      /LLM_MODEL/,
    );
  });

  it('requires the matching api key', () => {
    expect(() => loadLLMConfig({ LLM_PROVIDER: 'openrouter', LLM_MODEL: 'x' })).toThrow(
      /OPENROUTER_API_KEY/,
    );
  });

  it('treats blank values as unset', () => {
    expect(loadLLMConfig({ LLM_PROVIDER: '', LLM_MODEL: '' })).toMatchObject({ provider: 'mock' });
  });

  it('rejects unknown providers', () => {
    expect(() => loadLLMConfig({ LLM_PROVIDER: 'llama' })).toThrow();
  });

  it('builds an openai-compatible provider for gemini', () => {
    const provider = createProvider(
      loadLLMConfig({ LLM_PROVIDER: 'gemini', LLM_MODEL: 'gemini-x', GEMINI_API_KEY: 'k' }),
    );
    expect(provider).toMatchObject({ provider: 'gemini', model: 'gemini-x' });
  });
});
