import { config as loadDotenv } from 'dotenv';
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
loadDotenv({ override: false });
/**
 * A real Supabase project is reachable — not the placeholder that
 * tests/helpers/testEnv.ts installs for the middleware tests.
 *
 * Checked by VALUE, not mere presence: `applyTestEnv()` sets SUPABASE_URL to
 * `https://example.supabase.co`, which would satisfy a presence-only guard and
 * send an integration suite at a host that does not exist.
 */
export function hasLiveSupabase() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key)
        return false;
    if (url.includes('example.supabase.co'))
        return false;
    if (key === 'test-service-role-key')
        return false;
    return true;
}
/** A real Postgres the migration runner may create and drop schemas in. */
export function liveDatabaseUrl() {
    const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!url)
        return undefined;
    if (url.includes('@localhost:5432'))
        return undefined;
    return url;
}
