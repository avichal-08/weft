# @weft/sandbox

Runs untrusted code in a locked-down Docker container. Every agent run gets its own sandbox,
and every tool call the agent makes (read a file, run tests, grep) executes inside it.

```ts
import { createSandbox } from '@weft/sandbox';

const sandbox = await createSandbox({ image: 'weft-sandbox:dev', limits: { cpus: 2 } });
try {
  const res = await sandbox.exec('npm test', { cwd: '/workspace' });
  console.log(res.exitCode, res.stdout, res.stderr, res.truncated, res.durationMs);
} finally {
  await sandbox.destroy();
}
```

## API

| Export                                            | What it does                                                                                                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `createSandbox(opts, docker?)`                    | Creates and starts a container. Removes it again if `start` fails.                                                           |
| `sandbox.exec(cmd, { cwd, env, maxOutputBytes })` | Runs a command. A string runs via `sh -c`; an array runs as-is. Returns exit code, stdout, stderr, `truncated` and duration. |
| `sandbox.destroy()`                               | Force-removes the container. Safe to call more than once.                                                                    |
| `containerSpec(opts)`                             | Pure function: options → Docker create request. Useful to inspect or test the policy.                                        |
| `DEFAULT_LIMITS`, `DEFAULT_MAX_OUTPUT_BYTES`      | 1 CPU, 1 GB memory, 256 processes, 256 MB `/tmp`, 1 GB `/workspace`; 1 MB output per stream.                                 |

## Isolation policy

| Setting                             | Why                                                                     |
| ----------------------------------- | ----------------------------------------------------------------------- |
| `NetworkMode: none`                 | No exfiltration, no downloading payloads.                               |
| `ReadonlyRootfs` + tmpfs mounts     | Only `/tmp` and `/workspace` are writable, both size-capped.            |
| `CapDrop: ALL`, `no-new-privileges` | No root-level powers, no privilege gain through setuid binaries.        |
| `User: 1000:1000`                   | Never runs as root.                                                     |
| `MemorySwap = Memory`               | Swap off, so a memory hog is killed instead of thrashing.               |
| `PidsLimit`                         | Fork bombs hit the limit instead of taking down the host.               |
| `weft.sandbox` label                | Lets a janitor find and reap sandboxes left behind by a crashed worker. |

## How `exec` works

Without a TTY, Docker multiplexes stdout and stderr onto one connection, as frames with an
8-byte header naming the stream. `exec` demuxes them into two `CappedBuffer`s, which keep the
first `maxOutputBytes` and count the rest, so `yes` can't exhaust the worker's memory. The exit
code comes from `exec.inspect()` once the stream ends.

## Testing

```bash
pnpm --filter @weft/sandbox test               # unit tests, no docker needed
pnpm sandbox:build                             # once: build weft-sandbox:dev
pnpm --filter @weft/sandbox test:integration   # real containers
```

Integration tests use `SANDBOX_IMAGE` (default `weft-sandbox:dev`) and run in CI's `infra` job.
