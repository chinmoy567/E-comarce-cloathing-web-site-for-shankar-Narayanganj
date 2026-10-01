import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * Admin order panel, customer management and dashboard (implementation spec 13):
 * order list filters/sorts, detail, payment verify/reject, COD confirm and
 * collection resolution, the PATCH whitelist, customer panel and counters.
 * Files listed explicitly, like every other per-slice config here.
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
    include: ['tests/spec-12-admin-order-panel/adminOrderPanel.api.test.ts'],
  },
});
