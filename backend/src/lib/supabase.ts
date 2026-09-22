import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getEnv } from '../config/env.js';

/**
 * The single Supabase client, created with the service-role key.
 *
 * This module is imported ONLY by files under `repositories/` (spec 01
 * §Supabase client, backend skill §2). The service-role key is never logged,
 * never returned in a response, and never referenced in `frontend/`.
 *
 * RLS is not the authorization mechanism for this project (01-overview §1.1);
 * every route performs its own Express-layer check.
 */
let client: SupabaseClient | undefined;

export function getSupabase(): SupabaseClient {
  if (!client) {
    const env = getEnv();
    client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

/** Test seam: clears the memoized client. */
export function resetSupabaseClient(): void {
  client = undefined;
}
