import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * The spec 02 suite on its own — core schema: identity, role enum, the
 * Bangladesh address model, permissions, and the audit log.
 *
 * Spec 02 adds no endpoint, so its tests are the only evidence the slice is
 * correct, and most of them need a real Postgres (a CHECK, an enum, and a
 * partial unique index either exist or they do not — a mock asserts nothing).
 * Running them alone, with `npm run test:spec02`, keeps that feedback loop short
 * while `npm test` still runs everything.
 *
 * Files listed explicitly rather than matched by a glob: a pattern would
 * silently pull in a later slice's tests the moment one is named similarly, and
 * this config's whole job is to delimit spec 02.
 */
export default defineConfig({
  test: {
    root: fileURLToPath(new URL('../../..', import.meta.url)),
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    globals: false,
    restoreMocks: true,
    // The database-backed suites each build and drop their own schema.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    include: [
      // Migration and schema constraints
      'tests/shared/migrate.test.ts',
      'tests/spec-01-auth/schema.identity.test.ts',
      'tests/shared/enums.parity.test.ts',
      // Seed data
      'tests/spec-02-admin-rbac/permissions.seed.test.ts',
      // Shared libraries
      'tests/spec-01-auth/phone.test.ts',
      'tests/spec-01-auth/password.test.ts',
      'tests/shared/transaction.test.ts',
      // Repositories
      'tests/shared/users.repository.test.ts',
      'tests/shared/customers.repository.test.ts',
      'tests/spec-02-admin-rbac/permissions.repository.test.ts',
      'tests/spec-03-audit/audit.repository.test.ts',
    ],
  },
});
