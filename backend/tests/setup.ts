import { config as loadDotenv } from 'dotenv';
import { afterAll } from 'vitest';

/**
 * Loads `backend/.env` into the test process.
 *
 * Integration suites (the migration runner, the health probe's query shape)
 * cannot be verified with a mock — a fake PostgREST is precisely what hid the
 * `head: true` bug — so they run against the real project when credentials are
 * present and skip otherwise. Without this, `.env` was never read during tests
 * and those suites always skipped.
 *
 * `override` stays false: a variable already set in the environment wins, so an
 * explicit `TEST_DATABASE_URL=... vitest` and CI secrets are never clobbered.
 * This runs before each test FILE, but after that file's own imports have been
 * evaluated, so `applyTestEnv()`'s deliberate placeholders are also preserved.
 */
const explicitPoolMax = process.env.PG_POOL_MAX;
loadDotenv({ override: false });

/**
 * Test runs share one Supabase instance with a hard connection cap, and files
 * run one at a time, so a production-sized transaction pool (PG_POOL_MAX=10 in
 * .env) only wastes slots. A small pool still allows the concurrency tests
 * (parallel seed runs, coupon last-use races) to overlap. An explicit
 * `PG_POOL_MAX=... vitest` still wins.
 */
process.env.PG_POOL_MAX = explicitPoolMax ?? '4';

/**
 * Every test file gets a fresh module graph, so the transaction pool it opened
 * is unreachable afterwards. If a suite forgets `resetTransactionPool()`, the
 * pool's idle connections would hold their slots until the worker is reaped and
 * starve the next file ("too many clients already"). Closing it here makes that
 * impossible; suites that already close it are unaffected (it is idempotent).
 */
afterAll(async () => {
  try {
    const mod = await import('../src/lib/transaction.js');
    await mod.resetTransactionPool?.();
  } catch {
    /* module mocked out or never loaded: no pool to close */
  }
});

/**
 * A real Supabase project is reachable — not the placeholder that
 * tests/helpers/testEnv.ts installs for the middleware tests.
 *
 * Checked by VALUE, not mere presence: `applyTestEnv()` sets SUPABASE_URL to
 * `https://example.supabase.co`, which would satisfy a presence-only guard and
 * send an integration suite at a host that does not exist.
 */
export function hasLiveSupabase(): boolean {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return false;
  if (url.includes('example.supabase.co')) return false;
  if (key === 'test-service-role-key') return false;
  return true;
}

/** A real Postgres the migration runner may create and drop schemas in. */
export function liveDatabaseUrl(): string | undefined {
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) return undefined;
  if (url.includes('@localhost:5432')) return undefined;
  return url;
}
