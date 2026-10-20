import type { ToolCallBlock } from '@weft/llm';
import { z } from 'zod';
import type { ToolCallParse, ToolName } from '../types.ts';
import { TOOLS } from './definitions.ts';
import { TOOL_NAMES } from './specs.ts';

const isToolName = (name: string): name is ToolName => Object.hasOwn(TOOLS, name);

export function parseToolCall(call: ToolCallBlock): ToolCallParse {
  const fail = (error: string): ToolCallParse => ({
    ok: false,
    id: call.id,
    name: call.name,
    error,
  });

  if (!isToolName(call.name)) {
    return fail(`Unknown tool "${call.name}". Available tools: ${TOOL_NAMES.join(', ')}.`);
  }
  if (call.inputError) return fail(call.inputError);

  const result = TOOLS[call.name].schema.safeParse(call.input ?? {});
  if (!result.success) {
    return fail(`Invalid arguments for ${call.name}:\n${z.prettifyError(result.error)}`);
  }
  return { ok: true, id: call.id, name: call.name, args: result.data } as ToolCallParse;
}
