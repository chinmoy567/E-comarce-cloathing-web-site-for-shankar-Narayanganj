import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * Spec 05 — catalogue schema and admin catalogue management, isolated.
 *
 * Files listed explicitly, never globbed, so a later slice's similarly named
 * test cannot be pulled in (A.6). Shares the geography config's timeouts and
 * `fileParallelism: false` since every file here builds and drops its own
 * schema against the same Supabase connection cap.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    root: fileURLToPath(new URL('../../..', import.meta.url)),
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    globals: false,
    restoreMocks: true,
    testTimeout: 120_000,
    hookTimeout: 180_000,
    fileParallelism: false,
    include: [
      'tests/spec-05-catalogue/inventory.service.test.ts',
      'tests/spec-05-catalogue/catalogue.schema.test.ts',
      'tests/spec-05-catalogue/catalogue.service.test.ts',
      'tests/spec-05-catalogue/catalogue.api.test.ts',
    ],
  },
});
