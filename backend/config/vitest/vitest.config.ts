import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    root: fileURLToPath(new URL('../..', import.meta.url)),
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    globals: false,
    restoreMocks: true,
    // The database-backed suites build their own schema, run every migration
    // into it, and (for geography) seed 579 official rows in `beforeAll`. The
    // 5s/10s defaults are far below that, so the whole run must allow for it —
    // the per-slice configs set the same budgets.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    // Those suites each create and drop a schema on one Supabase instance with
    // a shared connection cap; running the files concurrently exhausts it.
    fileParallelism: false,
  },
});
