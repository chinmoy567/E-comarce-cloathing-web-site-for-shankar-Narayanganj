import { describe, expect, it } from 'vitest';
import { getSupabase } from '../../src/lib/supabase.ts';
import { hasLiveSupabase } from './setup.ts';
import { checkDatabaseReachable } from '../../src/repositories/health.repository.ts';
/**
 * Regression guard for the health probe's QUERY SHAPE.
 *
 * app.test.ts mocks this repository, so nothing there would catch the probe
 * reporting "ok" against an unmigrated database. That bug was real: with
 * `head: true`, PostgREST answers an empty 204 for a MISSING relation, leaving
 * `error` null so `!error` was true regardless of whether the table existed.
 *
 * Needs the real Supabase project, so it is skipped without credentials rather
 * than silently passing — a mocked PostgREST is exactly what hid the bug.
 * The guard checks credential VALUES, not presence: applyTestEnv() installs a
 * placeholder SUPABASE_URL that a presence-only check would accept.
 */
const hasCredentials = hasLiveSupabase();
describe.skipIf(!hasCredentials)('health probe query shape', () => {
    it('reports reachable when the migrated table is present', async () => {
        await expect(checkDatabaseReachable()).resolves.toBe(true);
    }, 30_000);
    it('a missing relation surfaces an error instead of an empty success', async () => {
        const { error, count } = await getSupabase()
            .from('table_that_does_not_exist_health_probe')
            .select('id', { count: 'exact' })
            .limit(1);
        // The assertion the old `head: true` shape could not make.
        expect(error).not.toBeNull();
        expect(count).toBeNull();
        expect(!error && count !== null).toBe(false);
    }, 30_000);
});
