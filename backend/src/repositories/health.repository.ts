import { getSupabase } from '../lib/supabase.js';

/**
 * The only layer that touches the Supabase client (backend skill §2).
 *
 * Performs one trivial query to establish whether the database is reachable.
 * It never returns version strings or connection details.
 *
 * `head: true` is deliberately NOT used: PostgREST answers a HEAD request with
 * an empty 204 even when the relation is missing, so `error` comes back null
 * and the probe reports "ok" against a database that was never migrated. A
 * real (bounded) SELECT makes a missing table surface as PGRST205, and the
 * exact-count check keeps a malformed response from passing silently.
 */
export async function checkDatabaseReachable(): Promise<boolean> {
  try {
    const { error, count } = await getSupabase()
      .from('schema_migrations')
      .select('id', { count: 'exact' })
      .limit(1);

    return !error && count !== null;
  } catch {
    return false;
  }
}
