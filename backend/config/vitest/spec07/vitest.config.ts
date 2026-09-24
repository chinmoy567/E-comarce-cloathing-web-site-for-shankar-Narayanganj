import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: fileURLToPath(new URL('../../../', import.meta.url)),
    include: [
      'tests/spec-07-order-state-machine/**/*.test.ts',
      // Shared enums parity test (all specs depend on this)
      'tests/shared/enums.parity.test.ts',
    ],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
