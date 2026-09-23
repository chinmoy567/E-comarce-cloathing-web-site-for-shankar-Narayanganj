import type pg from 'pg';
import { toDomainError } from './pgErrors.js';

/**
 * The raw conditional stock UPDATEs (spec 05 §Stock primitives).
 *
 * This module is deliberately separate from `productVariants.repository.ts`:
 * it is the one file `services/inventory.service.ts` (and, later, spec 12)
 * calls directly. Every function here takes the caller's transaction client
 * explicitly — none opens its own transaction or `run()` fallback — because
 * `decrementStock`/`restoreStock` must never be called outside a caller-owned
 * transaction (spec 05 §Stock primitives: "Both functions must be called
 * INSIDE a caller-provided transaction; they never open their own.").
 */

export type StockUpdateResult = {
  updated: boolean;
  /** The row's stock_quantity BEFORE this update — null if no row matched. */
  previousQuantity: number | null;
  /** The row's stock_quantity AFTER this update — null if no row matched. */
  newQuantity: number | null;
};

/**
 * Conditional check-and-decrement: `UPDATE ... WHERE stock_quantity >= $qty`.
 * Never a read-then-write. Returns `updated: false` (zero rows affected)
 * when insufficient stock remains, without throwing.
 */
export async function conditionalDecrement(
  client: pg.PoolClient,
  variantId: string,
  quantity: number,
): Promise<StockUpdateResult> {
  try {
    const { rows } = await client.query<{ old_quantity: number; new_quantity: number }>(
      `UPDATE product_variants
          SET stock_quantity = stock_quantity - $2,
              updated_at = now()
        WHERE id = $1
          AND stock_quantity >= $2
        RETURNING stock_quantity + $2 AS old_quantity, stock_quantity AS new_quantity`,
      [variantId, quantity],
    );
    if (rows.length === 0) {
      return { updated: false, previousQuantity: null, newQuantity: null };
    }
    return { updated: true, previousQuantity: rows[0]!.old_quantity, newQuantity: rows[0]!.new_quantity };
  } catch (err) {
    throw toDomainError(err);
  }
}

/** Current stock for a variant — used to report `available` on a shortfall. */
export async function getStockQuantity(
  client: pg.PoolClient,
  variantId: string,
): Promise<number | null> {
  const { rows } = await client.query<{ stock_quantity: number }>(
    `SELECT stock_quantity FROM product_variants WHERE id = $1 FOR UPDATE`,
    [variantId],
  );
  return rows[0] ? rows[0].stock_quantity : null;
}

/** Unconditional restore: `stock_quantity + qty`. One uniform rule, no branching. */
export async function unconditionalIncrement(
  client: pg.PoolClient,
  variantId: string,
  quantity: number,
): Promise<StockUpdateResult> {
  try {
    const { rows } = await client.query<{ old_quantity: number; new_quantity: number }>(
      `UPDATE product_variants
          SET stock_quantity = stock_quantity + $2,
              updated_at = now()
        WHERE id = $1
        RETURNING stock_quantity - $2 AS old_quantity, stock_quantity AS new_quantity`,
      [variantId, quantity],
    );
    if (rows.length === 0) {
      return { updated: false, previousQuantity: null, newQuantity: null };
    }
    return { updated: true, previousQuantity: rows[0]!.old_quantity, newQuantity: rows[0]!.new_quantity };
  } catch (err) {
    throw toDomainError(err);
  }
}

/** Manual stock set, used by `PATCH /variants/:id/stock` (a Admin/Manager correction). */
export async function setQuantity(
  client: pg.PoolClient,
  variantId: string,
  quantity: number,
): Promise<StockUpdateResult> {
  try {
    // A CTE referenced only inside RETURNING's correlated subquery is
    // evaluated after the UPDATE has already applied, so `previous` would
    // read the post-update row and always return the new quantity as "old" —
    // read the locked pre-update value into a plain variable first instead.
    const { rows: lockedRows } = await client.query<{ stock_quantity: number }>(
      `SELECT stock_quantity FROM product_variants WHERE id = $1 FOR UPDATE`,
      [variantId],
    );
    if (lockedRows.length === 0) {
      return { updated: false, previousQuantity: null, newQuantity: null };
    }
    const oldQuantity = lockedRows[0]!.stock_quantity;

    const { rows } = await client.query<{ new_quantity: number }>(
      `UPDATE product_variants
          SET stock_quantity = $2,
              updated_at = now()
        WHERE id = $1
        RETURNING stock_quantity AS new_quantity`,
      [variantId, quantity],
    );
    if (rows.length === 0) {
      return { updated: false, previousQuantity: null, newQuantity: null };
    }
    return { updated: true, previousQuantity: oldQuantity, newQuantity: rows[0]!.new_quantity };
  } catch (err) {
    throw toDomainError(err);
  }
}
