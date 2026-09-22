import pg from 'pg';
import { getEnv } from '../config/env.js';
import { STATEMENT_TIMEOUT_MS } from '../config/constants.js';

/**
 * The single multi-statement transaction mechanism (spec 02 assumption 3).
 *
 * The Supabase JS client does not expose interactive transactions, but order
 * creation, stock decrement, coupon usage, and the shipment/order cascade all
 * require genuine ones (03-payment-order §3, 05-admin-operations §5.1,
 * 10-coupon-discount §8.25, 07-order-state-machine §5.21.6). This helper uses a
 * direct PostgreSQL connection against the SAME Supabase Postgres instance —
 * no new database and no new framework, so CLAUDE.md §2 holds. Non-transactional
 * reads continue to go through the Supabase client in `lib/supabase.ts`.
 *
 * Every later slice uses this one helper; no slice opens its own connection.
 *
 * Pool sizing is explicit, not the driver default: this pool and the Supabase
 * client draw on the same instance connection limit, and an unbounded pool under
 * checkout load exhausts it — failing order creation, the one path that must not
 * fail. Each transaction also carries a statement timeout so a stuck statement
 * cannot hold a pooled connection indefinitely.
 */
let pool: pg.Pool | undefined;

function getPool(): pg.Pool {
  if (!pool) {
    const env = getEnv();
    pool = new pg.Pool({
      connectionString: env.DATABASE_URL,
      max: env.PG_POOL_MAX,
    });
    // A pool-level error (a connection dropped while idle) must not become an
    // unhandled 'error' event and take the process down.
    pool.on('error', () => {
      /* the connection is discarded by the pool; the next checkout reconnects */
    });
  }
  return pool;
}

/**
 * Runs `fn` inside a single transaction on one pooled connection.
 *
 * Commits when `fn` resolves; rolls back and rethrows when it throws. The
 * connection is always returned to the pool.
 *
 * Every statement `fn` issues must go through the client it receives —
 * a query made through the Supabase client inside the callback runs on a
 * different connection and is NOT part of the transaction.
 */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();

  try {
    await client.query('BEGIN');
    // SET LOCAL is scoped to this transaction, so it cannot leak to the next
    // caller that checks out the same pooled connection.
    await client.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);

    const result = await fn(client);

    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // A rollback failure means the connection is already broken; surfacing it
      // would mask the original error, which is the one worth reporting.
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Test seam: closes and clears the pool, mirroring `resetSupabaseClient()`. */
export async function resetTransactionPool(): Promise<void> {
  const existing = pool;
  pool = undefined;
  if (existing) {
    await existing.end();
  }
}
