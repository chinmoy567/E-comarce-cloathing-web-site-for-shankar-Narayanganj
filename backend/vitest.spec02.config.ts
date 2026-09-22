import { defineConfig } from 'vitest/config';

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
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    globals: false,
    restoreMocks: true,
    // The database-backed suites each build and drop their own schema.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    include: [
      // Migration and schema constraints
      'tests/migrate.test.ts',
      'tests/schema.identity.test.ts',
      'tests/enums.parity.test.ts',
      // Seed data
      'tests/permissions.seed.test.ts',
      // Shared libraries
      'tests/phone.test.ts',
      'tests/password.test.ts',
      'tests/transaction.test.ts',
      // Repositories
      'tests/users.repository.test.ts',
      'tests/customers.repository.test.ts',
      'tests/permissions.repository.test.ts',
      'tests/audit.repository.test.ts',
    ],
  },
});
