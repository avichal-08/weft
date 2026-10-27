import { describe, expect, it } from 'vitest';
import { parseRepo } from '../src/repo.ts';

describe('parseRepo', () => {
  it('reads owner and repo from a GitHub https url', () => {
    expect(parseRepo('https://github.com/vercel/ms')).toEqual({ owner: 'vercel', repo: 'ms' });
    expect(parseRepo('https://github.com/vercel/ms.git')).toEqual({ owner: 'vercel', repo: 'ms' });
    expect(parseRepo('https://github.com/a-b/c.d_e/')).toEqual({ owner: 'a-b', repo: 'c.d_e' });
  });

  it('rejects anything that is not a plain GitHub repository url', () => {
    for (const url of [
      'http://github.com/a/b',
      'https://gitlab.com/a/b',
      'https://github.com/a',
      'https://github.com/a/b/tree/main',
      'file:///tmp/repo',
      'not a url',
    ]) {
      expect(parseRepo(url), url).toBeNull();
    }
  });
});
