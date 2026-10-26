import { describe, expect, it } from 'vitest';
import { containerSpec, DEFAULT_LIMITS, OWNER_LABEL, SANDBOX_LABEL } from '../src/spec.ts';

describe('containerSpec', () => {
  const spec = containerSpec({ image: 'img' });
  const host = spec.HostConfig!;

  it('locks the container down', () => {
    expect(spec.User).toBe('1000:1000');
    expect(host.NetworkMode).toBe('none');
    expect(host.ReadonlyRootfs).toBeUndefined();
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

  it('covers every world-writable directory of the image with tmpfs', () => {
    expect(Object.keys(host.Tmpfs!)).toEqual(['/tmp', '/var/tmp', '/run/lock']);
  });

  it('allows executing files in /tmp only, which docker otherwise mounts noexec', () => {
    expect(host.Tmpfs!['/tmp']!.split(',')).toContain('exec');
    expect(host.Tmpfs!['/var/tmp']!.split(',')).toContain('noexec');
    expect(host.Tmpfs!['/run/lock']!.split(',')).toContain('noexec');
  });

  it('always sets the sandbox label', () => {
    const s = containerSpec({ image: 'img', labels: { [SANDBOX_LABEL]: 'x', run: 'r1' } });
    expect(s.Labels).toEqual({ run: 'r1', [SANDBOX_LABEL]: '1' });
  });

  it('records the owner, which callers cannot spoof through labels', () => {
    const s = containerSpec({ image: 'img', owner: 'w1', labels: { [OWNER_LABEL]: 'evil' } });
    expect(s.Labels?.[OWNER_LABEL]).toBe('w1');
  });
});
