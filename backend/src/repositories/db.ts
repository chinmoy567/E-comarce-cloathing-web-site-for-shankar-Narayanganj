import type pg from 'pg';
import { withTransaction } from '../lib/transaction.js';

/**
 * A runnable database handle for repository functions.
 *
 * Repositories accept an optional `pg.PoolClient`. When a caller is already
 * inside `withTransaction`, it passes its client and the repository's writes
 * join that transaction; when it is not, the repository runs the statement on
 * its own short transaction. This is what lets spec 11's order creation compose
 * several repository calls atomically without any repository knowing about it.
 */
export type Db = pg.PoolClient | undefined;

/** Runs `fn` on the caller's transaction client, or on a fresh one. */
export async function run<T>(db: Db, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  return db ? fn(db) : withTransaction(fn);
}
