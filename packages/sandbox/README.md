# @weft/sandbox

Runs untrusted code in a locked-down Docker container. Every agent run gets its own sandbox,
and every tool call the agent makes (read a file, run tests, grep) executes inside it.

```ts
import { createSandbox } from '@weft/sandbox';

const sandbox = await createSandbox({ image: 'weft-sandbox:dev', limits: { cpus: 2 } });
try {
  await sandbox.putFiles('./checkout', '/workspace', { ignore: (p) => p.includes('node_modules') });
  const res = await sandbox.exec('npm test', { cwd: '/workspace', timeoutMs: 60_000 });
  const pkg = await sandbox.readFile('/workspace/package.json');
  console.log(res.exitCode, res.timedOut, res.stdout, res.stderr, res.truncated, res.durationMs);
} finally {
  await sandbox.destroy();
}
```

## API

| Export                                                              | What it does                                                                                                                                                                       |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createSandbox(opts, docker?)`                                      | Creates and starts a container. Removes it again if `start` fails.                                                                                                                 |
| `sandbox.exec(cmd, { cwd, env, stdin, maxOutputBytes, timeoutMs })` | Runs a command. A string runs via `sh -c`; an array runs as-is. `stdin` takes a string, Buffer or stream. Returns exit code, stdout, stderr, `truncated`, `timedOut` and duration. |
| `sandbox.putFiles(localDir, dest?, { ignore, timeoutMs })`          | Copies a local directory into the sandbox (default `/workspace`). Files end up owned by uid 1000, modes kept.                                                                      |
| `sandbox.readFile(path, { maxBytes })`                              | Returns a file's contents as text. Throws if it's missing or over `maxBytes` (default 1 MB).                                                                                       |
| `sandbox.destroy()`                                                 | Force-removes the container. Safe to call more than once.                                                                                                                          |
| `containerSpec(opts)`                                               | Pure function: options → Docker create request. Useful to inspect or test the policy.                                                                                              |
| `DEFAULT_LIMITS`, `DEFAULT_MAX_OUTPUT_BYTES`, `DEFAULT_TIMEOUT_MS`  | 1 CPU, 1 GB memory, 256 processes, 256 MB `/tmp`, 1 GB `/workspace`; 1 MB output per stream; 120 s per command.                                                                    |

## Isolation policy

| Setting                             | Why                                                                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NetworkMode: none`                 | No exfiltration, no downloading payloads.                                                                                                                                |
| `ReadonlyRootfs` + tmpfs mounts     | Only `/tmp` and `/workspace` are writable, both size-capped. Both are mounted `exec`, since Docker adds `noexec` by default and that breaks `node_modules/.bin` scripts. |
| `CapDrop: ALL`, `no-new-privileges` | No root-level powers, no privilege gain through setuid binaries.                                                                                                         |
| `User: 1000:1000`                   | Never runs as root.                                                                                                                                                      |
| `MemorySwap = Memory`               | Swap off, so a memory hog is killed instead of thrashing.                                                                                                                |
| `PidsLimit`                         | Fork bombs hit the limit instead of taking down the host.                                                                                                                |
| `weft.sandbox` label                | Lets a janitor find and reap sandboxes left behind by a crashed worker.                                                                                                  |

## How `exec` works

Without a TTY, Docker multiplexes stdout and stderr onto one connection, as frames with an
8-byte header naming the stream. `exec` demuxes them into two `CappedBuffer`s, which keep the
first `maxOutputBytes` and count the rest, so `yes` can't exhaust the worker's memory. The exit
code comes from `exec.inspect()` once the stream ends.

## Copying files

Docker's copy API (`putArchive`) refuses to write into a container with a read-only root
filesystem, even into its writable tmpfs mounts. So `putFiles` packs the directory as a tar
stream on the host and pipes it into `tar -x` running inside the sandbox, through the command's
stdin. Because the unprivileged user does the extracting, files are owned by uid 1000 without
any `chown`, and the copy gets `exec`'s timeout for free. `readFile` is `cat` with the output
cap. A full workspace makes `putFiles` throw with tar's error; the sandbox stays usable.

## Timeouts

Docker has no API to kill an exec, so timeouts work in three layers:

1. **`timeout` inside the sandbox.** Every command runs as
   `timeout --signal=TERM --kill-after=2 <secs> ...`. On expiry it signals its whole process
   group, so child processes die too, and sends SIGKILL 2 s later if anything ignores SIGTERM.
   Exit code 124 (or 137 after SIGKILL) past the deadline means `timedOut: true`.
2. **A sweep after any timeout.** A process can leave the group with `setsid` and survive step 1.
   Every `docker exec` starts its own session, while the container's own processes (tini and its
   child) live in session 1, so after a timeout a second exec kills every process outside
   session 1. Assumes one command runs at a time per sandbox.
3. **A host backstop.** If the output stream is still open at deadline + 2 s + 5 s (say the command
   froze `timeout` with `kill -STOP $PPID`), the host kills the whole container and the sandbox
   refuses further commands.

A more precise per-command process tracker (an in-sandbox daemon) is planned for M2.

## Testing

```bash
pnpm --filter @weft/sandbox test               # unit tests, no docker needed
pnpm sandbox:build                             # once: build weft-sandbox:dev
pnpm --filter @weft/sandbox test:integration   # real containers
```

Integration tests use `SANDBOX_IMAGE` (default `weft-sandbox:dev`) and run in CI's `infra` job.
