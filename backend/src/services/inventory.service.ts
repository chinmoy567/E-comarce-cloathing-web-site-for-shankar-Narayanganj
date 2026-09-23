import type pg from 'pg';
import * as auditRepository from '../repositories/audit.repository.js';
import * as inventoryRepository from '../repositories/inventory.repository.js';

/**
 * The atomic stock primitives spec 12 calls from inside the order
 * state-transition transaction (spec 05 §Stock primitives). Defined and
 * tested here in isolation — nothing in this slice calls them from a status
 * transition (that wiring is spec 12's).
 */

const DEADLOCK_SQLSTATE = '40P01';

export type StockItem = { variantId: string; quantity: number };

export type DecrementContext = { orderId: string; actorUserId: string | null };
export type RestoreContext = { orderId: string; reason: string; actorUserId: string | null };

export type DecrementResult =
  | { ok: true }
  | { ok: false; insufficient: Array<{ variantId: string; available: number; requested: number }> };

/**
 * Sorts items by `variantId` — the deadlock-free lock-ordering guarantee
 * (spec 05 §Stock primitives "Lock ordering"). Each conditional UPDATE below
 * takes a row lock held until the enclosing transaction commits; two
 * concurrent transactions touching the same two variants in opposite order
 * would otherwise deadlock (Postgres SQLSTATE 40P01). Sorting makes every
 * transaction acquire locks in the same global order, so the wait-for cycle
 * cannot form. This is NOT optional — do not remove this sort.
 */
function sortedByVariantId<T extends { variantId: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0));
}

function isDeadlock(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === DEADLOCK_SQLSTATE;
}

/**
 * Atomic check-and-decrement per §5.1 "Stock decrement concurrency". Issues a
 * conditional `UPDATE ... WHERE stock_quantity >= $qty` per item, never a
 * read-then-write. If ANY item's update affects zero rows, the whole call
 * returns `ok: false` and nothing else in this transaction commits — the
 * caller's transaction rolls back. Never partial.
 *
 * Must run inside a caller-supplied transaction (`client`); this function
 * never opens its own. One retry on SQLSTATE 40P01 (a deadlock that still
 * escapes despite lock ordering).
 */
export async function decrementStock(
  client: pg.PoolClient,
  items: StockItem[],
  ctx: DecrementContext,
): Promise<DecrementResult> {
  return withDeadlockRetry(() => decrementStockOnce(client, items, ctx));
}

async function decrementStockOnce(
  client: pg.PoolClient,
  items: StockItem[],
  ctx: DecrementContext,
): Promise<DecrementResult> {
  const sorted = sortedByVariantId(items);
  const insufficient: Array<{ variantId: string; available: number; requested: number }> = [];

  for (const item of sorted) {
    const result = await inventoryRepository.conditionalDecrement(client, item.variantId, item.quantity);
    if (!result.updated) {
      // Zero rows affected: either the variant doesn't exist, or stock is
      // insufficient. Read the current quantity (0 if the row is missing) to
      // report the shortfall detail the Admin/Manager notification needs.
      const available = (await inventoryRepository.getStockQuantity(client, item.variantId)) ?? 0;
      insufficient.push({ variantId: item.variantId, available, requested: item.quantity });
      continue;
    }

    await auditRepository.append(
      {
        entityType: 'product_variant',
        entityId: item.variantId,
        action: 'stock_decrement',
        previousValue: { stockQuantity: result.previousQuantity },
        newValue: { stockQuantity: result.newQuantity, orderId: ctx.orderId },
        reason: `order ${ctx.orderId}`,
        actorUserId: ctx.actorUserId,
        actorType: ctx.actorUserId ? 'USER' : 'SYSTEM',
      },
      client,
    );
  }

  if (insufficient.length > 0) {
    return { ok: false, insufficient };
  }
  return { ok: true };
}

/**
 * The single uniform restoration rule per §5.1 "Stock restoration rule" — one
 * function, one code path, for every `CANCELLED`/`RETURNED` entry from at or
 * after `CONFIRMED`. Unconditional `+quantity` update, same lock ordering as
 * `decrementStock`. Must run inside a caller-supplied transaction.
 */
export async function restoreStock(
  client: pg.PoolClient,
  items: StockItem[],
  ctx: RestoreContext,
): Promise<void> {
  return withDeadlockRetry(() => restoreStockOnce(client, items, ctx));
}

async function restoreStockOnce(
  client: pg.PoolClient,
  items: StockItem[],
  ctx: RestoreContext,
): Promise<void> {
  const sorted = sortedByVariantId(items);

  for (const item of sorted) {
    const result = await inventoryRepository.unconditionalIncrement(client, item.variantId, item.quantity);
    if (!result.updated) {
      continue; // variant no longer exists — nothing to restore or audit
    }

    await auditRepository.append(
      {
        entityType: 'product_variant',
        entityId: item.variantId,
        action: 'stock_restore',
        previousValue: { stockQuantity: result.previousQuantity },
        newValue: { stockQuantity: result.newQuantity, orderId: ctx.orderId },
        reason: ctx.reason,
        actorUserId: ctx.actorUserId,
        actorType: ctx.actorUserId ? 'USER' : 'SYSTEM',
      },
      client,
    );
  }
}

/**
 * Retries once on a deadlock that escapes despite lock ordering
 * (spec 05 §Stock primitives). A second consecutive deadlock is surfaced —
 * retrying indefinitely would risk masking a real problem.
 */
async function withDeadlockRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isDeadlock(err)) {
      return fn();
    }
    throw err;
  }
}
