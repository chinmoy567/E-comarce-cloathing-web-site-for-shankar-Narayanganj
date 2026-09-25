import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    root: fileURLToPath(new URL('../../../', import.meta.url)),
    include: [
      'tests/spec-08-analytics-meta/**/*.test.ts',
      // Shared enums parity test (all specs depend on this)
      'tests/shared/enums.parity.test.ts',
    ],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
