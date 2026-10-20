import type { Readable } from 'node:stream';

export type SandboxLimits = {
  cpus: number;
  memoryMb: number;
  pids: number;
  tmpMb: number;
  workspaceMb: number;
};

export type SandboxOptions = {
  image: string;
  limits?: Partial<SandboxLimits>;
  labels?: Record<string, string>;
};

export type ExecOptions = {
  cwd?: string;
  env?: Record<string, string>;
  maxOutputBytes?: number;
  timeoutMs?: number;
  stdin?: string | Buffer | Readable;
};

export type PutFilesOptions = {
  timeoutMs?: number;
  ignore?: (path: string) => boolean;
};

export type ReadFileOptions = {
  maxBytes?: number;
};

export type ExecResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
  durationMs: number;
};

export type Sandbox = {
  readonly id: string;
  exec(command: string | string[], opts?: ExecOptions): Promise<ExecResult>;
  putFiles(localDir: string, dest?: string, opts?: PutFilesOptions): Promise<void>;
  readFile(path: string, opts?: ReadFileOptions): Promise<string>;
  destroy(): Promise<void>;
};
