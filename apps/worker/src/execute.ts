import { createToolContext, runAgent, type AgentEvent } from '@weft/agent';
import {
  appendRunEvents,
  claimRun,
  completeRun,
  getRun,
  recordProgress,
  type CompleteRunInput,
  type NewRunEvent,
} from '@weft/db';
import { emptyUsage, LLMError, withRetry } from '@weft/llm';
import { createSandbox, type Sandbox } from '@weft/sandbox';
import { CloneError, cloneRepo } from './clone.ts';
import { describeEvent, describeRetry, shortId } from './log.ts';
import { toRunEvent } from './trace.ts';
import type { RunConfig, RunOutcome, WorkerDeps } from './types.ts';
import { DEFAULT_WATCH_INTERVAL_MS, watchRun } from './watch.ts';

export const REPO_ROOT = '/workspace/repo';
const DEFAULT_MAX_STEPS = 30;

export async function executeRun(deps: WorkerDeps, runId: string): Promise<RunOutcome> {
  const { db, workerId } = deps;
  const run = await getRun(db, runId);
  if (!run) return { kind: 'skipped' };
  const attempt = await claimRun(db, runId, workerId);
  if (attempt === undefined) return { kind: 'skipped' };

  const config = run.config as RunConfig;
  const log = (line: string) => deps.log?.(`run ${shortId(runId)} ${line}`);
  const usage = { steps: 0, ...emptyUsage() };
  const abort = new AbortController();
  let fenced = false;
  let progress = Promise.resolve();
  let checkout: Awaited<ReturnType<typeof cloneRepo>> | undefined;
  let sandbox: Sandbox | undefined;

  const lose = () => {
    if (fenced) return;
    fenced = true;
    abort.abort();
    void sandbox?.destroy().catch(() => {});
  };
  const stopWatching = watchRun(
    db,
    runId,
    attempt,
    deps.watchIntervalMs ?? DEFAULT_WATCH_INTERVAL_MS,
    lose,
  );

  let pending: NewRunEvent[] = [];
  let seq = 0;
  const flushEvents = () => {
    progress = progress.then(async () => {
      if (pending.length === 0) return;
      const batch = pending;
      pending = [];
      try {
        await appendRunEvents(db, runId, attempt, batch);
      } catch (err) {
        log(`trace write failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
  };

  const finish = async (outcome: CompleteRunInput): Promise<RunOutcome> => {
    flushEvents();
    await progress;
    if (fenced) return { kind: 'fenced' };
    const recorded = await completeRun(db, runId, attempt, {
      steps: usage.steps,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      ...outcome,
    });
    return { kind: 'completed', status: outcome.status, recorded };
  };

  const onEvent = (event: AgentEvent) => {
    log(describeEvent(event));
    pending.push(toRunEvent(event, seq++));
    if (event.type !== 'llm') return;
    flushEvents();
    usage.steps = event.step;
    usage.inputTokens += event.usage.inputTokens;
    usage.outputTokens += event.usage.outputTokens;
    usage.cacheReadTokens += event.usage.cacheReadTokens;
    const snapshot = {
      steps: usage.steps,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
    };
    progress = progress.then(async () => {
      if (!(await recordProgress(db, runId, attempt, snapshot))) lose();
    });
  };

  try {
    checkout = await cloneRepo(run.repoUrl, run.baseRef, {
      allowFileRepos: deps.allowFileRepos ?? false,
    });
    sandbox = await createSandbox({
      image: deps.sandboxImage,
      owner: workerId,
      labels: { 'weft.run': runId },
    });
    abort.signal.throwIfAborted();
    await sandbox.putFiles(checkout.dir, REPO_ROOT);

    const ctx = createToolContext({ sandbox, root: REPO_ROOT, testCommand: run.testCommand });
    const result = await runAgent({
      llm: withRetry(deps.createLLM(config), {
        ...deps.retry,
        onRetry: ({ attempt, delayMs, error }) => log(describeRetry(attempt, delayMs, error)),
      }),
      ctx,
      task: run.task,
      maxSteps: config.maxSteps ?? DEFAULT_MAX_STEPS,
      signal: abort.signal,
      onEvent,
    });
    if (result.status === 'aborted')
      return await finish({ status: 'error', failureKind: 'aborted' });

    const verify = await sandbox.exec(run.testCommand, {
      cwd: REPO_ROOT,
      timeoutMs: ctx.testTimeoutMs,
    });
    const diff = await sandbox.exec('git add -A && git diff --cached --no-color', {
      cwd: REPO_ROOT,
    });
    const passed = verify.exitCode === 0;

    if (result.status === 'finished' && passed) {
      return await finish({ status: 'succeeded', diff: diff.stdout, ...summaryOf(result.summary) });
    }
    return await finish({
      status: 'failed',
      diff: diff.stdout,
      failureKind: result.status === 'finished' ? 'tests_failed' : result.status,
      failureDetail: passed
        ? 'tests pass but the agent did not finish'
        : tail(verify.stdout + verify.stderr),
      ...summaryOf(result.summary),
    });
  } catch (err) {
    return await finish({ status: 'error', ...describeError(err) });
  } finally {
    stopWatching();
    await sandbox?.destroy().catch(() => {});
    await checkout?.cleanup();
  }
}

const summaryOf = (summary: string | undefined) => (summary ? { summary } : {});

const tail = (text: string, max = 4000) => (text.length > max ? text.slice(-max) : text);

function describeError(err: unknown): { failureKind: string; failureDetail: string } {
  if (err instanceof CloneError) return { failureKind: 'clone_failed', failureDetail: err.message };
  if (err instanceof LLMError)
    return { failureKind: `llm_${err.kind}`, failureDetail: err.message.slice(0, 2000) };
  return {
    failureKind: 'internal',
    failureDetail: err instanceof Error ? err.message : String(err),
  };
}
