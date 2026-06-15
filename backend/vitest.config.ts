import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // headroom for Testcontainers startup
    testTimeout: 60_000,
    hookTimeout: 120_000,
    exclude: ['node_modules', 'dist'],
  },
});
