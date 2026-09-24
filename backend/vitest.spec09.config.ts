import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    setupFiles: [],
    include: ['tests/spec-09-fraud-risk/**/*.test.ts'],
    exclude: ['node_modules', '.idea', '.git', '.cache'],
  },
});
