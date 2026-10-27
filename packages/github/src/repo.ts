export type RepoRef = { owner: string; repo: string };

const NAME = /^[A-Za-z0-9_.-]+$/;

export function parseRepo(url: string): RepoRef | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com') return null;
  const [owner, name, ...rest] = parsed.pathname.split('/').filter(Boolean);
  const repo = name?.replace(/\.git$/, '');
  if (!owner || !repo || rest.length > 0 || !NAME.test(owner) || !NAME.test(repo)) return null;
  return { owner, repo };
}
