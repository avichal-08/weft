import { Readable } from 'node:stream';
import { pack } from 'tar-fs';
import type { ExecOptions, ExecResult, PutFilesOptions, ReadFileOptions } from './types.ts';

type Exec = (command: string | string[], opts?: ExecOptions) => Promise<ExecResult>;

export const DEFAULT_COPY_TIMEOUT_MS = 300_000;
export const DEFAULT_READ_MAX_BYTES = 1024 * 1024;

const reason = (res: ExecResult) => res.stderr.trim() || `exit code ${res.exitCode}`;

export async function putFiles(
  exec: Exec,
  localDir: string,
  dest = '/workspace',
  opts: PutFilesOptions = {},
): Promise<void> {
  const archive = Readable.from(pack(localDir, opts.ignore ? { ignore: opts.ignore } : {}));
  const res = await exec(
    ['sh', '-c', 'mkdir -p -- "$1" && exec tar -x -f - --no-same-owner -C "$1"', 'sh', dest],
    { stdin: archive, timeoutMs: opts.timeoutMs ?? DEFAULT_COPY_TIMEOUT_MS },
  );
  if (res.exitCode !== 0) {
    throw new Error(`copying ${localDir} into ${dest} failed: ${reason(res)}`);
  }
}

export async function readFile(
  exec: Exec,
  path: string,
  opts: ReadFileOptions = {},
): Promise<string> {
  const maxBytes = opts.maxBytes ?? DEFAULT_READ_MAX_BYTES;
  const res = await exec(['cat', '--', path], { maxOutputBytes: maxBytes });
  if (res.exitCode !== 0) throw new Error(`reading ${path} failed: ${reason(res)}`);
  if (res.truncated) throw new Error(`${path} is larger than ${maxBytes} bytes`);
  return res.stdout;
}
