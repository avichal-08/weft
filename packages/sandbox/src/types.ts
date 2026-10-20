import type { Readable, Writable } from 'node:stream';

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
  owner?: string;
  network?: 'none' | 'bridge';
};

export type ExecOptions = {
  cwd?: string;
  env?: Record<string, string>;
  maxOutputBytes?: number;
  timeoutMs?: number;
  stdin?: string | Buffer | Readable;
  stdout?: Writable;
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
  disconnectNetwork(): Promise<void>;
  killStrays(): Promise<void>;
  destroy(): Promise<void>;
};

export type ReapReason = 'not-running' | 'too-old' | 'owner-dead';

export type SandboxInfo = {
  id: string;
  state: string;
  ageMs: number;
  owner: string | undefined;
};

export type ReapPolicy = {
  minAgeMs: number;
  maxAgeMs: number;
};

export type ReapOptions = Partial<ReapPolicy> & {
  isOwnerAlive?: (owner: string) => boolean | Promise<boolean>;
  labels?: Record<string, string>;
  now?: number;
};

export type Reaped = { id: string; reason: ReapReason };
