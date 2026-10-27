import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/fixtures/**'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
