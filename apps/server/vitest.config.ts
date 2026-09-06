/** Vitest config for @wcc/server. */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // The suite shares one physical Postgres (wcc_test) and one Express app,
    // so files must run one at a time; within a file tests run sequentially.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 90_000,
    // Fail fast in CI-like runs; unhandled rejections shouldn't hang the suite.
    passWithNoTests: false,
  },
});