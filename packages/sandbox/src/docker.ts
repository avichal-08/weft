import { finished } from 'node:stream/promises';
import Docker from 'dockerode';
import { CappedBuffer } from './output.ts';
import { containerSpec } from './spec.ts';
import type { ExecOptions, ExecResult, Sandbox, SandboxOptions } from './types.ts';

export const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

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
  command: string | string[],
  opts: ExecOptions = {},
): Promise<ExecResult> {
  const started = performance.now();
  const exec = await container.exec({
    Cmd: typeof command === 'string' ? ['sh', '-c', command] : command,
    AttachStdout: true,
    AttachStderr: true,
    ...(opts.cwd ? { WorkingDir: opts.cwd } : {}),
    ...(opts.env ? { Env: Object.entries(opts.env).map(([k, v]) => `${k}=${v}`) } : {}),
  });

  const max = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const stdout = new CappedBuffer(max);
  const stderr = new CappedBuffer(max);
  const stream = await exec.start({ hijack: true, stdin: false });
  docker.modem.demuxStream(stream, stdout, stderr);
  await finished(stream);

  return {
    exitCode: await exitCodeOf(exec),
    stdout: stdout.text(),
    stderr: stderr.text(),
    truncated: stdout.truncated || stderr.truncated,
    durationMs: Math.round(performance.now() - started),
  };
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

  return {
    id: container.id,
    exec: (command, execOpts) => runExec(docker, container, command, execOpts),
    async destroy() {
      try {
        await container.remove({ force: true });
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }
    },
  };
}
