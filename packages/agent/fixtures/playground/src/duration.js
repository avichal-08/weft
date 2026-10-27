const UNITS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

export function parseDuration(text) {
  const input = String(text).trim();
  const part = /\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)/y;
  let total = 0;
  let parts = 0;

  while (part.lastIndex < input.length) {
    const match = part.exec(input);
    if (!match) throw new SyntaxError(`invalid duration: "${text}"`);
    total += Number(match[1]) * UNITS[match[2]];
    parts++;
  }

  if (parts === 0) throw new SyntaxError(`invalid duration: "${text}"`);
  return total;
}

export function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const out = [];
  let rest = Math.round(ms / 1000);
  for (const [unit, size] of [
    ['d', 86_400],
    ['h', 3600],
    ['m', 60],
    ['s', 1],
  ]) {
    if (rest >= size) {
      out.push(`${Math.floor(rest / size)}${unit}`);
      rest %= size;
    }
  }
  return out.join(' ');
}
