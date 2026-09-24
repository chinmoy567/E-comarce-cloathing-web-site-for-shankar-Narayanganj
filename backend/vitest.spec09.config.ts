import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import dotenv from 'dotenv';
import path from 'path';

// Load .env file
const envPath = path.resolve(__dirname, '.env');
dotenv.config({ path: envPath });

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    setupFiles: [],
    include: ['tests/spec-09-fraud-risk/**/*.test.ts'],
    exclude: ['node_modules', '.idea', '.git', '.cache'],
    env: {
      ...process.env,
    },
  },
});
