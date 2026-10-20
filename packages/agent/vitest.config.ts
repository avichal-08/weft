import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'fixtures/**'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
