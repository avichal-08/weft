import { describe, expect, it } from 'vitest';
import { containerSpec, DEFAULT_LIMITS, SANDBOX_LABEL } from '../src/spec.ts';

describe('containerSpec', () => {
  const spec = containerSpec({ image: 'img' });
  const host = spec.HostConfig!;

  it('locks the container down', () => {
    expect(spec.User).toBe('1000:1000');
    expect(host.NetworkMode).toBe('none');
    expect(host.ReadonlyRootfs).toBe(true);
    expect(host.CapDrop).toEqual(['ALL']);
    expect(host.SecurityOpt).toEqual(['no-new-privileges']);
  });

  it('applies default limits with swap disabled', () => {
    expect(host.NanoCpus).toBe(1e9);
    expect(host.Memory).toBe(DEFAULT_LIMITS.memoryMb * 1024 * 1024);
    expect(host.MemorySwap).toBe(host.Memory);
    expect(host.PidsLimit).toBe(DEFAULT_LIMITS.pids);
  });

  it('merges partial limits', () => {
    const h = containerSpec({ image: 'img', limits: { cpus: 0.5, pids: 64 } }).HostConfig!;
    expect(h.NanoCpus).toBe(5e8);
    expect(h.PidsLimit).toBe(64);
    expect(h.Memory).toBe(DEFAULT_LIMITS.memoryMb * 1024 * 1024);
  });

  it('makes /tmp and /workspace the only writable paths', () => {
    expect(Object.keys(host.Tmpfs!)).toEqual(['/tmp', '/workspace']);
    expect(host.Tmpfs!['/workspace']).toContain('uid=1000');
  });

  it('always sets the sandbox label', () => {
    const s = containerSpec({ image: 'img', labels: { [SANDBOX_LABEL]: 'x', run: 'r1' } });
    expect(s.Labels).toEqual({ run: 'r1', [SANDBOX_LABEL]: '1' });
  });
});
