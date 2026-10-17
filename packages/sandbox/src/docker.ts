import Docker from 'dockerode';
import { containerSpec } from './spec.ts';
import type { Sandbox, SandboxOptions } from './types.ts';

const isNotFound = (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { statusCode?: number }).statusCode === 404;

export async function createSandbox(
  opts: SandboxOptions,
  docker: Docker = new Docker(),
): Promise<Sandbox> {
  const container = await docker.createContainer(containerSpec(opts));

  try {
    await container.start();
  } catch (err) {
    await container.remove({ force: true }).catch(() => {});
    throw err;
  }

  return {
    id: container.id,
    async destroy() {
      try {
        await container.remove({ force: true });
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }
    },
  };
}
