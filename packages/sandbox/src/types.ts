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
  destroy(): Promise<void>;
};
