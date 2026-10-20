import type { z } from 'zod';
import type { TOOLS } from './tools/definitions.ts';

export type ToolName = keyof typeof TOOLS;

export type ToolArgs = { [K in ToolName]: z.output<(typeof TOOLS)[K]['schema']> };

export type ParsedToolCall = {
  [K in ToolName]: { ok: true; id: string; name: K; args: ToolArgs[K] };
}[ToolName];

export type InvalidToolCall = { ok: false; id: string; name: string; error: string };

export type ToolCallParse = ParsedToolCall | InvalidToolCall;
