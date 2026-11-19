import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // The core is pure functions over plain data, so per-file process
    // isolation buys nothing; threads keep `pnpm test` working in restricted
    // sandboxes that block piped child-process stdio.
    pool: 'threads',
    include: ['packages/*/src/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    // S9/S10 are bounded searches; a hung test is a bug, not a slow machine.
    testTimeout: 10_000,
  },
});
