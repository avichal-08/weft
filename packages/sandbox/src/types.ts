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

export type Sandbox = {
  readonly id: string;
  destroy(): Promise<void>;
};
