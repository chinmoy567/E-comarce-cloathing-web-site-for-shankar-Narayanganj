import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * The spec 06 suite on its own — RBAC and admin management.
 *
 * Spec 06 covers: role management (ADMIN/MANAGER/CUSTOMER), the permission matrix,
 * manager CRUD operations, permission assignment/revocation, and audit logging of
 * all permission changes.
 *
 * Running them alone, with `npm run test:spec06`, keeps the feedback loop short
 * while `npm test` still runs everything.
 *
 * Files listed explicitly rather than matched by a glob: a pattern would
 * silently pull in a later slice's tests the moment one is named similarly, and
 * this config's whole job is to delimit spec 06.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    root: fileURLToPath(new URL('../../..', import.meta.url)),
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    globals: false,
    restoreMocks: true,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    include: [
      // RBAC and permission management
      'tests/spec-06-rbac/permissions.repository.test.ts',
      'tests/spec-06-rbac/permissions.seed.test.ts',
      'tests/spec-06-rbac/permissions.service.test.ts',
      'tests/spec-06-rbac/rbacMatrix.test.ts',
      'tests/spec-06-rbac/requirePermission.test.ts',
      'tests/spec-06-rbac/managers.service.test.ts',
      'tests/spec-06-rbac/managers.api.test.ts',
    ],
  },
});
