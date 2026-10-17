export const DEFAULT_TIMEOUT_MS = 120_000;
export const KILL_AFTER_SECONDS = 2;

export function wrapCommand(command: string | string[], timeoutMs: number): string[] {
  const argv = typeof command === 'string' ? ['sh', '-c', command] : command;
  const seconds = Math.max(timeoutMs, 1) / 1000;
  return ['timeout', '--signal=TERM', `--kill-after=${KILL_AFTER_SECONDS}`, `${seconds}`, ...argv];
}

export function isTimeoutExit(exitCode: number, durationMs: number, timeoutMs: number): boolean {
  return (exitCode === 124 || exitCode === 137) && durationMs >= timeoutMs;
}

export const SWEEP_SCRIPT = `
mine=$(cat /proc/self/stat); mine=\${mine##*\\) }; set -- $mine; mysid=$4
for d in /proc/[0-9]*; do
  s=$(cat "$d/stat" 2>/dev/null) || continue
  s=\${s##*\\) }; set -- $s
  [ "$4" = 1 ] || [ "$4" = "$mysid" ] || kill -9 "\${d#/proc/}" 2>/dev/null
done
true
`;
