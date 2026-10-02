import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * Analytics and business reports (implementation spec 20, 05-admin §5.9): revenue recognition,
 * discounted totals, enum buckets, derived stock, customer composition, registry-driven couriers,
 * coupon aggregates, analytics.view enforcement, bounded ranges/pagination/sort allowlists, the
 * no-PII key-set, no writes, the daily rollup and the asynchronous export. Files listed explicitly,
 * like every other per-slice config here.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    root: fileURLToPath(new URL('../../..', import.meta.url)),
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    globals: false,
    restoreMocks: false,
    testTimeout: 120_000,
    hookTimeout: 180_000,
    fileParallelism: false,
    include: ['tests/spec-20-analytics-reports/reports.api.test.ts', 'tests/spec-20-analytics-reports/reports.unit.test.ts'],
  },
});
