import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import Docker from 'dockerode';
import {
  DEFAULT_TIMEOUT_MS,
  isTimeoutExit,
  KILL_AFTER_SECONDS,
  SWEEP_SCRIPT,
  wrapCommand,
} from './command.ts';
import { putFiles, readFile } from './files.ts';
import { CappedBuffer } from './output.ts';
import { containerSpec } from './spec.ts';
import type { ExecOptions, ExecResult, Sandbox, SandboxOptions } from './types.ts';

export const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
export const BACKSTOP_GRACE_MS = 5_000;

type State = { broken: boolean };

const isNotFound = (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { statusCode?: number }).statusCode === 404;

async function exitCodeOf(exec: Docker.Exec): Promise<number> {
  for (let i = 0; i < 50; i++) {
    const info = await exec.inspect();
    if (!info.Running && info.ExitCode !== null) return info.ExitCode;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('exec did not report an exit code');
}

async function runExec(
  docker: Docker,
  container: Docker.Container,
  state: State,
  command: string | string[],
  opts: ExecOptions = {},
  sweepOnTimeout = true,
): Promise<ExecResult> {
  if (state.broken) {
    throw new Error('sandbox was killed after a command escaped its timeout');
  }

  const started = performance.now();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const exec = await container.exec({
    Cmd: wrapCommand(command, timeoutMs),
    AttachStdin: opts.stdin !== undefined,
    AttachStdout: true,
    AttachStderr: true,
    ...(opts.cwd ? { WorkingDir: opts.cwd } : {}),
    ...(opts.env ? { Env: Object.entries(opts.env).map(([k, v]) => `${k}=${v}`) } : {}),
  });

  const max = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const stdout = new CappedBuffer(max);
  const stderr = new CappedBuffer(max);
  const stream = await exec.start({ hijack: true, stdin: opts.stdin !== undefined });
  docker.modem.demuxStream(stream, stdout, stderr);
  if (opts.stdin instanceof Readable) {
    opts.stdin.on('error', (err) => stream.destroy(err));
    opts.stdin.pipe(stream);
  } else if (opts.stdin !== undefined) {
    stream.end(opts.stdin);
  }

  let backstop: NodeJS.Timeout | undefined;
  const escaped = new Promise<'escaped'>((resolve) => {
    backstop = setTimeout(
      () => resolve('escaped'),
      timeoutMs + KILL_AFTER_SECONDS * 1000 + BACKSTOP_GRACE_MS,
    );
  });
  const outcome = await Promise.race([
    finished(stream, { writable: false }).then(() => 'done' as const),
    escaped,
  ]);
  clearTimeout(backstop);

  const output = () => ({
    stdout: stdout.text(),
    stderr: stderr.text(),
    truncated: stdout.truncated || stderr.truncated,
    durationMs: Math.round(performance.now() - started),
  });

  if (outcome === 'escaped') {
    state.broken = true;
    stream.destroy();
    await container.kill({ signal: 'SIGKILL' }).catch(() => {});
    return { exitCode: 137, timedOut: true, ...output() };
  }

  const exitCode = await exitCodeOf(exec);
  const result = output();
  const timedOut = isTimeoutExit(exitCode, result.durationMs, timeoutMs);
  if (timedOut && sweepOnTimeout) {
    await runExec(docker, container, state, SWEEP_SCRIPT, { timeoutMs: 5000 }, false);
  }
  return { exitCode, timedOut, ...result };
}

export async function createSandbox(
  opts: SandboxOptions,
  docker: Docker = new Docker(),
): Promise<Sandbox> {
  const container = await docker.createContainer(containerSpec(opts));

  try {
    await container.start();
  } catch (err) {
    await container.remove({ force: true }).catch(() => {});
    throw err;
  }

  const state: State = { broken: false };
  let removal: Promise<void> | undefined;

  const exec: Sandbox['exec'] = (command, execOpts) =>
    runExec(docker, container, state, command, execOpts);

  return {
    id: container.id,
    exec,
    putFiles: (localDir, dest, putOpts) => putFiles(exec, localDir, dest, putOpts),
    readFile: (path, readOpts) => readFile(exec, path, readOpts),
    destroy() {
      removal ??= container.remove({ force: true }).then(
        () => undefined,
        (err: unknown) => {
          if (isNotFound(err)) return;
          removal = undefined;
          throw err;
        },
      );
      return removal;
    },
  };
}
