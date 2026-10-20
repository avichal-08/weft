export function duration(from: string | null, to: string | null): string {
  if (!from) return '–';
  const ms = (to ? Date.parse(to) : Date.now()) - Date.parse(from);
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export const time = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

export const tokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export const repoName = (url: string) =>
  url.replace(/^(https:\/\/github\.com\/|file:\/\/)/, '').replace(/\.git$/, '');
