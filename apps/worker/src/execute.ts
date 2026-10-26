import { createToolContext, runAgent, type AgentEvent } from '@weft/agent';
import {
  appendRunEvents,
  claimRun,
  completeRun,
  getRun,
  getSession,
  recordProgress,
  type CompleteRunInput,
  type PhaseTiming,
  type NewRunEvent,
} from '@weft/db';
import { emptyUsage, LLMError, withRetry } from '@weft/llm';
import type { LiveMessage, LivePhase } from '@weft/queue';
import { createSandbox, imageId, type Sandbox } from '@weft/sandbox';
import { CloneError, cloneRepo } from './clone.ts';
import { buildHistory, latestDiff } from './history.ts';
import { installCache, installKey, touchesManifests } from './install-cache.ts';
import { detectSetup, runSetup, SetupError } from './setup.ts';
import { describeEvent, describeRetry, shortId } from './log.ts';
import { toRunEvent } from './trace.ts';
import type { RunConfig, RunOutcome, WorkerDeps } from './types.ts';
import { DEFAULT_WATCH_INTERVAL_MS, watchRun } from './watch.ts';

export const REPO_ROOT = '/workspace/repo';

export class ApplyError extends Error {
  override name = 'ApplyError';
}
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
  const timings: PhaseTiming[] = [];
  const timed = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const started = performance.now();
    try {
      return await fn();
    } finally {
      timings.push({ phase: name, ms: Math.round(performance.now() - started) });
    }
  };

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

  const live = (message: LiveMessage) => {
    if (!deps.live || fenced) return;
    deps.live(runId, message).catch((err: unknown) => {
      log(`live publish failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  };
  const phase = (name: LivePhase, detail?: string) =>
    live({ kind: 'phase', attempt, phase: name, ...(detail ? { detail } : {}) });

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
    log(`timings: ${describeTimings(timings)}`);
    const recorded = await completeRun(db, runId, attempt, {
      steps: usage.steps,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      timings,
      ...outcome,
    });
    live({ kind: 'end', attempt });
    return { kind: 'completed', status: outcome.status, recorded };
  };

  const onEvent = (event: AgentEvent) => {
    log(describeEvent(event));
    const row = toRunEvent(event, seq++);
    pending.push(row);
    live({ kind: 'event', attempt, event: { ...row, createdAt: new Date().toISOString() } });
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
    const previous =
      run.sessionId && run.turn && run.turn > 1
        ? ((await getSession(db, run.sessionId))?.turns ?? []).filter((t) => t.turn! < run.turn!)
        : [];

    phase('clone');
    checkout = await timed('clone', () =>
      cloneRepo(run.repoUrl, run.baseRef, { allowFileRepos: deps.allowFileRepos ?? false }),
    );
    const { dir } = checkout;
    const plan = await detectSetup(dir);
    const base = latestDiff(previous);
    const cache =
      plan && deps.installCache && !touchesManifests(base) ? installCache(deps.installCache) : null;
    const key =
      plan && cache
        ? await timed('cacheKey', async () =>
            installKey(dir, {
              repoUrl: run.repoUrl,
              imageId: await imageId(deps.sandboxImage),
              command: plan.command,
            }),
          )
        : null;
    const cached = cache && key ? await cache.lookup(key) : null;

    phase('sandbox');
    sandbox = await timed('sandbox', () =>
      createSandbox({
        image: deps.sandboxImage,
        owner: workerId,
        labels: { 'weft.run': runId },
        ...(plan
          ? {
              ...(cached ? {} : { network: 'bridge' as const }),
              limits: { memoryMb: 2048, workspaceMb: 2048, tmpMb: 512 },
            }
          : {}),
      }),
    );
    abort.signal.throwIfAborted();
    const box = sandbox;
    await timed('copy', () => box.putFiles(dir, REPO_ROOT));

    if (base) {
      phase('restore');
      const applied = await timed('apply', () =>
        box.exec(['git', 'apply', '--whitespace=nowarn', '-'], { cwd: REPO_ROOT, stdin: base }),
      );
      if (applied.exitCode !== 0) {
        throw new ApplyError(applied.stderr.trim() || 'git apply failed');
      }
    }

    if (plan && cache && cached) {
      log('setup: restoring dependencies from cache');
      phase('setup', 'cache');
      await timed('cacheRestore', () => cache.restore(box, REPO_ROOT, cached));
      log(`setup: restored in ${seconds(timings.at(-1)!.ms)}s, no network`);
    } else if (plan) {
      log(`setup: ${plan.command}`);
      phase('setup', plan.command);
      await timed('install', () => runSetup(box, REPO_ROOT, plan));
      log(`setup: done in ${seconds(timings.at(-1)!.ms)}s, network disconnected`);
      if (cache && key) {
        try {
          const bytes = await timed('cacheSave', () => cache.save(box, REPO_ROOT, key));
          if (bytes !== null) {
            log(`setup: cached ${(bytes / 1e6).toFixed(0)} MB in ${seconds(timings.at(-1)!.ms)}s`);
          }
        } catch (err) {
          log(`setup: caching failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    phase('agent');
    const ctx = createToolContext({ sandbox: box, root: REPO_ROOT, testCommand: run.testCommand });
    const result = await timed('agent', () =>
      runAgent({
        llm: withRetry(deps.createLLM(config), {
          ...deps.retry,
          onRetry: ({ attempt, delayMs, error }) => log(describeRetry(attempt, delayMs, error)),
        }),
        ctx,
        task: run.task,
        history: buildHistory(previous),
        maxSteps: config.maxSteps ?? DEFAULT_MAX_STEPS,
        signal: abort.signal,
        onEvent,
      }),
    );
    if (result.status === 'aborted')
      return await finish({ status: 'error', failureKind: 'aborted' });

    if (run.testCommand) phase('verify');
    const verify = run.testCommand
      ? await timed('verify', () =>
          box.exec(run.testCommand!, { cwd: REPO_ROOT, timeoutMs: ctx.testTimeoutMs }),
        )
      : null;
    const diff = await timed('diff', () =>
      box.exec(
        "git add -A -- . ':!node_modules' && git diff --cached --binary --no-color -- . ':!node_modules'",
        { cwd: REPO_ROOT },
      ),
    );
    const passed = verify ? verify.exitCode === 0 : true;

    if (result.status === 'finished' && passed) {
      return await finish({ status: 'succeeded', diff: diff.stdout, ...summaryOf(result.summary) });
    }
    return await finish({
      status: 'failed',
      diff: diff.stdout,
      failureKind: result.status === 'finished' ? 'tests_failed' : result.status,
      failureDetail: !passed
        ? tail(verify!.stdout + verify!.stderr)
        : 'the agent stopped without replying',
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

const seconds = (ms: number) => (ms / 1000).toFixed(1);

export const describeTimings = (timings: PhaseTiming[]) =>
  timings.map(({ phase, ms }) => `${phase} ${seconds(ms)}s`).join(', ') || 'none';

const summaryOf = (summary: string | undefined) => (summary ? { summary } : {});

const tail = (text: string, max = 4000) => (text.length > max ? text.slice(-max) : text);

function describeError(err: unknown): { failureKind: string; failureDetail: string } {
  if (err instanceof CloneError) return { failureKind: 'clone_failed', failureDetail: err.message };
  if (err instanceof SetupError) return { failureKind: 'setup_failed', failureDetail: err.message };
  if (err instanceof ApplyError) {
    return {
      failureKind: 'apply_failed',
      failureDetail: `the previous turn's changes no longer apply to the branch: ${err.message}`,
    };
  }
  if (err instanceof LLMError)
    return { failureKind: `llm_${err.kind}`, failureDetail: err.message.slice(0, 2000) };
  return {
    failureKind: 'internal',
    failureDetail: err instanceof Error ? err.message : String(err),
  };
}
