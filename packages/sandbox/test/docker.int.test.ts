import Docker from 'dockerode';
import { describe, expect, it } from 'vitest';
import { createSandbox } from '../src/docker.ts';

const docker = new Docker();
const image = process.env.SANDBOX_IMAGE ?? 'weft-sandbox:dev';

describe('createSandbox', () => {
  it('starts a locked-down container and removes it', async () => {
    const sandbox = await createSandbox({ image, labels: { 'weft.test': '1' } }, docker);
    const info = await docker.getContainer(sandbox.id).inspect();

    expect(info.State.Running).toBe(true);
    expect(info.HostConfig.NetworkMode).toBe('none');
    expect(info.HostConfig.ReadonlyRootfs).toBe(true);
    expect(info.Config.Labels['weft.test']).toBe('1');

    await sandbox.destroy();
    await expect(docker.getContainer(sandbox.id).inspect()).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('destroy is idempotent', async () => {
    const sandbox = await createSandbox({ image }, docker);
    await sandbox.destroy();
    await expect(sandbox.destroy()).resolves.toBeUndefined();
  });

  it('makes concurrent destroy calls wait for the same removal', async () => {
    const sandbox = await createSandbox({ image }, docker);
    await Promise.all([sandbox.destroy(), sandbox.destroy(), sandbox.destroy()]);
    await expect(docker.getContainer(sandbox.id).inspect()).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('fails cleanly for a missing image', async () => {
    await expect(
      createSandbox({ image: 'weft-does-not-exist:nope' }, docker),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
