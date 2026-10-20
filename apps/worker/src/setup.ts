import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Sandbox } from '@weft/sandbox';

export type SetupPlan = { manager: 'npm' | 'pnpm' | 'yarn'; command: string };

export const SETUP_TIMEOUT_MS = 300_000;

export class SetupError extends Error {
  override name = 'SetupError';
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

const NPM_FLAGS = '--no-audit --no-fund --loglevel=error';

export async function detectSetup(dir: string): Promise<SetupPlan | null> {
  let pkg: { dependencies?: object; devDependencies?: object; optionalDependencies?: object };
  try {
    pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as typeof pkg;
  } catch {
    return null;
  }
  const deps = [pkg.dependencies, pkg.devDependencies, pkg.optionalDependencies];
  if (deps.every((d) => !d || Object.keys(d).length === 0)) return null;

  if (await exists(join(dir, 'pnpm-lock.yaml'))) {
    return { manager: 'pnpm', command: 'pnpm install --frozen-lockfile' };
  }
  if (await exists(join(dir, 'yarn.lock'))) {
    const berry = await exists(join(dir, '.yarnrc.yml'));
    return {
      manager: 'yarn',
      command: berry ? 'yarn install --immutable' : 'yarn install --frozen-lockfile',
    };
  }
  if (
    (await exists(join(dir, 'package-lock.json'))) ||
    (await exists(join(dir, 'npm-shrinkwrap.json')))
  ) {
    return { manager: 'npm', command: `npm ci ${NPM_FLAGS}` };
  }
  return { manager: 'npm', command: `npm install ${NPM_FLAGS}` };
}

export async function runSetup(sandbox: Sandbox, root: string, plan: SetupPlan): Promise<number> {
  const started = performance.now();
  const res = await sandbox.exec(`mkdir -p /tmp/home && ${plan.command}`, {
    cwd: root,
    env: { HOME: '/tmp/home', npm_config_cache: '/tmp/home/.npm' },
    timeoutMs: SETUP_TIMEOUT_MS,
  });
  if (res.exitCode !== 0) {
    const why = res.timedOut
      ? `timed out after ${SETUP_TIMEOUT_MS / 1000}s`
      : `exit code ${res.exitCode}`;
    const output = `${res.stdout}\n${res.stderr}`.trim();
    throw new SetupError(`${plan.command} failed (${why})\n${output.slice(-3000)}`);
  }
  await sandbox.killStrays();
  await sandbox.disconnectNetwork();
  return Math.round(performance.now() - started);
}
