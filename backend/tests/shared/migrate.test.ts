import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../scripts/migrate.ts';
import { liveDatabaseUrl } from '../setup.ts';

/**
 * Spec 01 acceptance 1 / test 8 — migration idempotency.
 *
 * The test skill requires a REAL Postgres, never a mock: this is exactly the
 * logic a fake would hide. Set TEST_DATABASE_URL to a disposable Postgres or
 * Supabase database to run it. Without that variable the suite is skipped
 * rather than silently passing.
 *
 * The test creates the pristine state it asserts on, in a throwaway schema, so
 * it is repeatable and order-independent: asserting that the first run APPLIES
 * the baseline is only true against a database that has never been migrated,
 * and `public` has been migrated on any real environment. `public` is never
 * touched.
 */
const TEST_DATABASE_URL = liveDatabaseUrl();

/** Hard-coded: identifiers cannot be parameterized, so this is never derived from input. */
const TEST_SCHEMA = 'migtest';

/**
 * runMigrations opens its own client, so session state cannot be set on it from
 * here — the search_path travels with the connection string instead.
 */
const scopedUrl = (): string =>
  `${TEST_DATABASE_URL}?options=${encodeURIComponent(`-c search_path=${TEST_SCHEMA}`)}`;

async function withAdminClient(sql: string): Promise<void> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

describe.skipIf(!TEST_DATABASE_URL)('migration runner (spec 01 acceptance 1)', () => {
  beforeEach(async () => {
    await withAdminClient(
      `DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE; CREATE SCHEMA ${TEST_SCHEMA};`,
    );
  });

  afterEach(async () => {
    await withAdminClient(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE;`);
  });

  it('applies each migration once and is safe to re-run', async () => {
    const first = await runMigrations(scopedUrl());
    expect(first.applied).toContain('0001_baseline.sql');
    expect(first.skipped).toHaveLength(0);

    const second = await runMigrations(scopedUrl());
    expect(second.applied).toHaveLength(0);
    expect(second.skipped).toContain('0001_baseline.sql');
  }, 30_000);

  it('records every applied migration exactly once', async () => {
    await runMigrations(scopedUrl());
    await runMigrations(scopedUrl());

    const client = new pg.Client({ connectionString: scopedUrl() });
    await client.connect();
    try {
      const { rows } = await client.query<{ id: string; n: string }>(
        'SELECT id, count(*)::text AS n FROM schema_migrations GROUP BY id',
      );

      // Asserted per row rather than against a fixed row count: every migration
      // added by a later spec joins this table, and the claim under test is
      // "recorded exactly once", not "there is exactly one migration".
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.n, `${row.id} was recorded more than once`).toBe('1');
      }
      expect(rows.map((row) => row.id)).toContain('0001_baseline.sql');
    } finally {
      await client.end();
    }
  }, 30_000);
});
