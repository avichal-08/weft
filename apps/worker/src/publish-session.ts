import { getSession, recordCommitSha, recordPublishError, recordPush, type Db } from '@weft/db';
import { parseRepo } from '@weft/github';
import { branchName, publishCommits, PublishError, type PublishResult } from './publish.ts';

export type Publisher = {
  token(ref: { owner: string; repo: string }): Promise<string>;
  identity(): Promise<{ name: string; email: string }>;
};

export type PublishDeps = { db: Db; github?: Publisher; allowFileRepos?: boolean };

const LOCAL_AUTHOR = { name: 'weft', email: 'weft@localhost' };

export async function publishSession(
  deps: PublishDeps,
  sessionId: string,
  opts: { branch?: string } = {},
): Promise<PublishResult> {
  const session = await getSession(deps.db, sessionId);
  if (!session) throw new PublishError(`session ${sessionId} not found`);

  try {
    const ref = parseRepo(session.repoUrl);
    const local = !ref && deps.allowFileRepos && session.repoUrl.startsWith('file:');
    if (!ref && !local) throw new PublishError('only GitHub repositories can be published');
    if (ref && !deps.github) throw new PublishError('the GitHub App is not configured');

    const unpushed = session.commits.filter((c) => !c.sha);
    if (unpushed.length === 0) return null;
    const diffOf = (turn: number) => session.turns.find((t) => t.turn === turn)?.diff ?? '';
    const lastPushed = session.commits.filter((c) => c.sha).at(-1);
    const branch = session.branch ?? opts.branch ?? branchName(session.title, session.id);

    const result = await publishCommits({
      repoUrl: session.repoUrl,
      baseRef: session.baseRef,
      branch,
      pushedDiff: lastPushed ? diffOf(lastPushed.turn) : null,
      commits: unpushed.map((c) => ({ id: c.id, diff: diffOf(c.turn), message: c.message })),
      token: ref ? await deps.github!.token(ref) : null,
      author: ref ? await deps.github!.identity() : LOCAL_AUTHOR,
    });
    if (result) {
      for (const { id, sha } of result.commits) await recordCommitSha(deps.db, id, sha);
      await recordPush(deps.db, sessionId, {
        branch,
        pushedTurn: unpushed.at(-1)!.turn,
        pushedSha: result.sha,
      });
    }
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordPublishError(deps.db, sessionId, message);
    throw err;
  }
}
