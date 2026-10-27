import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ExecResult, Sandbox } from '@weft/sandbox';

export type Manager = 'npm' | 'pnpm' | 'yarn' | 'bun';
export type SetupPlan = { manager: Manager; command: string };

export const SETUP_TIMEOUT_MS = 300_000;
export const SETUP_CACHE = '/workspace/.weft-cache';

export class SetupError extends Error {
  override name = 'SetupError';
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

const NPM_FLAGS = '--no-audit --no-fund --loglevel=error';

const FRESH: Record<Manager, string> = {
  npm: `npm install ${NPM_FLAGS}`,
  pnpm: 'pnpm install',
  yarn: 'yarn install',
  bun: 'bun install',
};

export async function detectSetup(dir: string): Promise<SetupPlan | null> {
  let pkg: {
    packageManager?: string;
    dependencies?: object;
    devDependencies?: object;
    optionalDependencies?: object;
  };
  try {
    pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as typeof pkg;
  } catch {
    return null;
  }
  const deps = [pkg.dependencies, pkg.devDependencies, pkg.optionalDependencies];
  if (deps.every((d) => !d || Object.keys(d).length === 0)) return null;

  if ((await exists(join(dir, 'bun.lock'))) || (await exists(join(dir, 'bun.lockb')))) {
    return { manager: 'bun', command: 'bun install --frozen-lockfile' };
  }
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
  const named = pkg.packageManager?.split('@')[0] ?? '';
  const manager: Manager = Object.hasOwn(FRESH, named) ? (named as Manager) : 'npm';
  return { manager, command: FRESH[manager] };
}

const SETUP_ENV = {
  HOME: `${SETUP_CACHE}/home`,
  npm_config_cache: `${SETUP_CACHE}/npm`,
  npm_config_store_dir: `${SETUP_CACHE}/pnpm`,
  npm_config_fetch_retries: '5',
  npm_config_fetch_retry_maxtimeout: '120000',
  BUN_INSTALL_CACHE_DIR: `${SETUP_CACHE}/bun`,
};

const NETWORK_ERROR = /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|ECONNREFUSED|socket hang up/;

export const INCREMENTAL: Partial<Record<Manager, string>> = {
  npm: `npm install --no-save ${NPM_FLAGS}`,
};

async function install(sandbox: Sandbox, root: string, command: string): Promise<ExecResult> {
  const attempt = () =>
    sandbox.exec(`mkdir -p ${SETUP_CACHE}/home && ${command}`, {
      cwd: root,
      env: SETUP_ENV,
      timeoutMs: SETUP_TIMEOUT_MS,
    });
  const res = await attempt();
  const retry = res.exitCode !== 0 && !res.timedOut && NETWORK_ERROR.test(res.stdout + res.stderr);
  return retry ? attempt() : res;
}

function failure(command: string, res: ExecResult): SetupError {
  const why = res.timedOut
    ? `timed out after ${SETUP_TIMEOUT_MS / 1000}s`
    : `exit code ${res.exitCode}`;
  const output = `${res.stdout}\n${res.stderr}`.trim();
  return new SetupError(`${command} failed (${why})\n${output.slice(-3000)}`);
}

async function finish(sandbox: Sandbox) {
  await sandbox.exec(['rm', '-rf', ...['npm', 'pnpm', 'bun'].map((c) => `${SETUP_CACHE}/${c}`)]);
  await sandbox.killStrays();
  await sandbox.disconnectNetwork();
}

export async function runSetup(sandbox: Sandbox, root: string, plan: SetupPlan): Promise<number> {
  const started = performance.now();
  const res = await install(sandbox, root, plan.command);
  if (res.exitCode !== 0) throw failure(plan.command, res);
  await finish(sandbox);
  return Math.round(performance.now() - started);
}

export async function runIncrementalSetup(
  sandbox: Sandbox,
  root: string,
  plan: SetupPlan,
  onFallback: (why: string) => void = () => {},
): Promise<boolean> {
  const command = INCREMENTAL[plan.manager];
  if (command) {
    const res = await install(sandbox, root, command);
    if (res.exitCode === 0) {
      await finish(sandbox);
      return true;
    }
    onFallback(failure(command, res).message.split('\n')[0]!);
    await sandbox.exec('find . -name node_modules -type d -prune -exec rm -rf {} +', { cwd: root });
  }
  await runSetup(sandbox, root, plan);
  return false;
}
