import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * Storage and the bKash payment screenshot (implementation spec 06, private slice):
 * content-sniffed upload, WebP re-encode, private bucket, signed-URL admin read.
 * Labelled spec22 because the legacy `spec06` label is already RBAC (see TEST_ORGANIZATION.md).
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
    include: [
      'tests/spec-22-storage/paymentProof.api.test.ts',
      'tests/spec-22-storage/productImages.api.test.ts',
      'tests/spec-22-storage/paymentResubmission.api.test.ts',
    ],
  },
});
