import type { EditResult } from '../types.ts';

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

export function applyEdit(
  content: string,
  oldStr: string,
  newStr: string,
  replaceAll: boolean,
): EditResult {
  if (oldStr === newStr) return { ok: false, error: 'old_str and new_str are identical.' };

  const found = count(content, oldStr);
  if (found === 0) {
    return {
      ok: false,
      error:
        'old_str was not found in the file. It must match exactly, including whitespace and ' +
        'indentation. View the file again and copy the text precisely.',
    };
  }
  if (found > 1 && !replaceAll) {
    return {
      ok: false,
      error:
        `old_str appears ${found} times. Include more surrounding lines to make it unique, ` +
        'or set replace_all to true.',
    };
  }

  const first = content.indexOf(oldStr);
  const line = count(content.slice(0, first), '\n') + 1;
  const next = replaceAll
    ? content.split(oldStr).join(newStr)
    : content.slice(0, first) + newStr + content.slice(first + oldStr.length);
  return { ok: true, content: next, replacements: replaceAll ? found : 1, line };
}

export function snippet(content: string, line: number, radius = 3): string {
  const lines = content.split('\n');
  const start = Math.max(1, line - radius);
  const end = Math.min(lines.length, line + radius);
  return lines
    .slice(start - 1, end)
    .map((text, i) => `${String(start + i).padStart(6)}\t${text}`)
    .join('\n');
}
