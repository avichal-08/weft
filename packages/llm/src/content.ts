import type { ContentBlock, TextBlock, ToolCallBlock, Usage } from './types.ts';

export const emptyUsage = (): Usage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

export const toolCalls = (content: ContentBlock[]): ToolCallBlock[] =>
  content.filter((b): b is ToolCallBlock => b.type === 'tool_call');

export const textOf = (content: ContentBlock[]): string =>
  content
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
