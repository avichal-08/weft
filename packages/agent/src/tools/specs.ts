import type { ToolSpec } from '@weft/llm';
import { z } from 'zod';
import type { ToolName } from '../types.ts';
import { TOOLS } from './definitions.ts';

export const TOOL_NAMES = Object.keys(TOOLS) as ToolName[];

export function toolSpec(name: ToolName): ToolSpec {
  const { $schema: _, ...inputSchema } = z.toJSONSchema(TOOLS[name].schema, { io: 'input' });
  return { name, description: TOOLS[name].description, inputSchema };
}

export function toolSpecs(names: readonly ToolName[] = TOOL_NAMES): ToolSpec[] {
  return names.map(toolSpec);
}
