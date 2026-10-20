import type { ToolCallBlock } from '@weft/llm';
import { describe, expect, it } from 'vitest';
import { parseToolCall } from '../src/tools/parse.ts';
import { TOOL_NAMES, toolSpec, toolSpecs } from '../src/tools/specs.ts';

const call = (name: string, input: unknown, extra: Partial<ToolCallBlock> = {}): ToolCallBlock => ({
  type: 'tool_call',
  id: 'c1',
  name,
  input,
  ...extra,
});

describe('toolSpecs', () => {
  it('describes every tool as a plain JSON object schema', () => {
    const specs = toolSpecs();
    expect(specs.map((s) => s.name)).toEqual(TOOL_NAMES);
    for (const spec of specs) {
      expect(spec.description.length).toBeGreaterThan(20);
      expect(spec.inputSchema).toMatchObject({ type: 'object' });
      expect(spec.inputSchema).not.toHaveProperty('$schema');
    }
  });

  it('only requires arguments that have no default', () => {
    expect(toolSpec('grep').inputSchema.required).toEqual(['pattern']);
    expect(toolSpec('str_replace_edit').inputSchema.required).toEqual([
      'path',
      'old_str',
      'new_str',
    ]);
    expect(toolSpec('run_tests').inputSchema.required ?? []).toEqual([]);
  });

  it('can expose a subset of tools', () => {
    expect(toolSpecs(['view_file', 'finish']).map((s) => s.name)).toEqual(['view_file', 'finish']);
  });
});

describe('parseToolCall', () => {
  it('returns typed args with defaults filled in', () => {
    const parsed = parseToolCall(call('grep', { pattern: 'TODO' }));
    expect(parsed).toEqual({
      ok: true,
      id: 'c1',
      name: 'grep',
      args: {
        pattern: 'TODO',
        path: '.',
        mode: 'files',
        context: 0,
        ignore_case: false,
        head_limit: 100,
      },
    });
  });

  it('accepts tools without arguments', () => {
    expect(parseToolCall(call('run_tests', undefined))).toMatchObject({ ok: true, args: {} });
  });

  it('rejects unknown tools and lists the real ones', () => {
    const parsed = parseToolCall(call('rm_rf', {}));
    expect(parsed).toMatchObject({ ok: false, name: 'rm_rf' });
    expect(!parsed.ok && parsed.error).toContain('view_file');
  });

  it('does not treat inherited object keys as tools', () => {
    expect(parseToolCall(call('constructor', {})).ok).toBe(false);
  });

  it('explains invalid arguments so the model can retry', () => {
    const parsed = parseToolCall(call('view_file', { path: 'a.ts', limit: 99999 }));
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.error).toMatch(/Invalid arguments for view_file[\s\S]*limit/);
  });

  it('passes through json errors from the provider layer', () => {
    const parsed = parseToolCall(
      call('grep', undefined, { inputError: 'arguments were not valid JSON: {oops' }),
    );
    expect(parsed).toMatchObject({ ok: false, error: 'arguments were not valid JSON: {oops' });
  });
});
