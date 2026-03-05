import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/slow/**/*.test.ts'],
    reporters: ['verbose'],
    testTimeout: 120_000,
    env: {
      PROSECHECK_SLOW_TESTS: '1',
      PROSECHECK_VERBOSE: '1',
    },
  },
});
