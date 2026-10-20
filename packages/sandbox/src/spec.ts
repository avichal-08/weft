import type { ContainerCreateOptions } from 'dockerode';
import type { SandboxLimits, SandboxOptions } from './types.ts';

export const DEFAULT_LIMITS: SandboxLimits = {
  cpus: 1,
  memoryMb: 1024,
  pids: 256,
  tmpMb: 256,
  workspaceMb: 1024,
};

export const SANDBOX_LABEL = 'weft.sandbox';
export const OWNER_LABEL = 'weft.owner';

const MB = 1024 * 1024;

export function containerSpec(opts: SandboxOptions): ContainerCreateOptions {
  const limits = { ...DEFAULT_LIMITS, ...opts.limits };

  return {
    Image: opts.image,
    User: '1000:1000',
    WorkingDir: '/workspace',
    Labels: {
      ...opts.labels,
      [SANDBOX_LABEL]: '1',
      ...(opts.owner ? { [OWNER_LABEL]: opts.owner } : {}),
    },
    HostConfig: {
      NetworkMode: opts.network === 'bridge' ? 'bridge' : 'none',
      ReadonlyRootfs: true,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'],
      NanoCpus: Math.round(limits.cpus * 1e9),
      Memory: limits.memoryMb * MB,
      MemorySwap: limits.memoryMb * MB,
      PidsLimit: limits.pids,
      Tmpfs: {
        '/tmp': `rw,exec,nosuid,nodev,size=${limits.tmpMb}m`,
        '/workspace': `rw,exec,nosuid,nodev,size=${limits.workspaceMb}m,uid=1000,gid=1000`,
      },
    },
  };
}
