/**
 * Courier status synchronization — the one idempotent applier (spec 15,
 * 04-courier §4.6, 07-order-state-machine §5.21.4/§5.21.6/§5.21.9).
 *
 * Webhooks and polling both funnel through `applyCourierStatusUpdate`. Neither
 * ingestion path writes a status column itself, so a webhook and a poll reporting the
 * same transition apply it once, and a replayed or out-of-order update corrupts nothing
 * and duplicates no history (§4.6).
 *
 * Everything for one update happens in ONE transaction under the order and shipment row
 * locks: duplicate check → staleness check → path of SYSTEM transitions → the DELIVERED /
 * RETURNED order cascade (+ stock restoration). If the cascade cannot apply, a savepoint
 * rolls the shipment change back too, so the system is never left with a delivered
 * shipment on a processing order (§5.21.6).
 *
 * Courier sync never takes over an ADMIN action: CREATED → SHIPPED stays the manual
 * parcel-handover step (§5.21.9), so an update that needs it is recorded as
 * INVALID_TRANSITION and applies on a later poll once an admin has marked the parcel shipped.
 */

import type pg from 'pg';
import { InvalidTransitionError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { withTransaction } from '../lib/transaction.js';
import { append as appendAudit } from '../repositories/audit.repository.js';
import { listByOrderId } from '../repositories/orderItems.repository.js';
import { append as appendStatusHistory } from '../repositories/orderStatusHistory.repository.js';
import * as ordersRepository from '../repositories/orders.repository.js';
import * as shipmentsRepository from '../repositories/shipments.repository.js';
import * as syncEvents from '../repositories/shipmentSyncEvents.repository.js';
import type { SkipReason, SyncSource } from '../repositories/shipmentSyncEvents.repository.js';
import type { ShipmentStatus } from '../types/orderEnums.js';
import { restoreStock } from './inventory.service.js';
import { isValidOrderTransition, SHIPMENT_STATUS_TRANSITIONS } from './orderStateMachine.js';
import { transitionInTx } from './shipment.service.js';

/** Mirrors the SQL function shipment_status_ordinal() (migration 0015). */
const ORDINAL: Record<ShipmentStatus, number> = {
  NOT_CREATED: 0,
  CREATING: 1,
  CREATION_FAILED: 1,
  CREATED: 2,
  SHIPPED: 3,
  IN_TRANSIT: 4,
  OUT_FOR_DELIVERY: 5,
  DELIVERY_FAILED: 5,
  DELIVERED: 6,
  RETURNED: 6,
};

/** Failure states can legitimately repeat an ordinal, so they are exempt from the ordinal staleness test. */
const FAILURE_STATES: readonly ShipmentStatus[] = ['CREATION_FAILED', 'DELIVERY_FAILED'];

/** States courier sync may move a shipment between. Creation states belong to the admin/creation path. */
const SYNCABLE: ReadonlySet<ShipmentStatus> = new Set<ShipmentStatus>([
  'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED', 'RETURNED',
]);

export function shipmentStatusOrdinal(status: ShipmentStatus): number {
  return ORDINAL[status];
}

/**
 * Shortest chain of SYSTEM-triggered transitions from `from` to `to` that stays inside the
 * syncable states. A courier may skip a step it never reported (e.g. SHIPPED → OUT_FOR_DELIVERY),
 * so the intermediate transitions are applied — each recorded in history — rather than rejected.
 */
export function systemTransitionPath(from: ShipmentStatus, to: ShipmentStatus): ShipmentStatus[] | null {
  if (!SYNCABLE.has(from) || !SYNCABLE.has(to)) return null;
  const queue: ShipmentStatus[][] = [[from]];
  const seen = new Set<ShipmentStatus>([from]);
  while (queue.length > 0) {
    const path = queue.shift()!;
    const current = path[path.length - 1]!;
    for (const t of SHIPMENT_STATUS_TRANSITIONS) {
      if (t.from !== current || t.trigger !== 'SYSTEM' || !SYNCABLE.has(t.to) || seen.has(t.to)) continue;
      const next = [...path, t.to];
      if (t.to === to) return next.slice(1);
      seen.add(t.to);
      queue.push(next);
    }
  }
  return null;
}

export type SyncUpdate = {
  courierCode: string;
  courierOrderId: string;
  /** Normalized status; null = unrecognized provider status (logged and ignored, never guessed). */
  status: ShipmentStatus | null;
  providerEventId?: string | null;
  occurredAt?: string | null;
  source: SyncSource;
};

export type SyncOutcome = {
  applied: boolean;
  skipReason: SkipReason | null;
  shipmentId: string | null;
  status: ShipmentStatus | null;
};

function dedupeKeyOf(update: SyncUpdate & { status: ShipmentStatus }): string {
  return update.providerEventId ?? `${update.status}|${update.occurredAt ?? ''}`;
}

/** DELIVERED / RETURNED order cascade, inside the caller's transaction (§5.21.4, §5.21.6). */
async function cascadeToOrder(client: pg.PoolClient, order: ordersRepository.Order, target: 'DELIVERED' | 'RETURNED'): Promise<void> {
  if (!isValidOrderTransition(order.payment_method, order.order_status, target)) {
    throw new InvalidTransitionError(`Order ${order.order_status} cannot become ${target} from courier sync.`);
  }
  const reason = `Cascaded from shipment ${target === 'DELIVERED' ? 'delivered' : 'returned'}`;

  if (target === 'RETURNED') {
    // §5.1 uniform restoration rule: any transition into RETURNED from a state at or after CONFIRMED restores stock.
    const items = (await listByOrderId(client, order.id))
      .filter((i) => i.product_variant_id)
      .map((i) => ({ variantId: i.product_variant_id as string, quantity: i.quantity }));
    await restoreStock(client, items, { orderId: order.id, reason: `order ${order.id} returned`, actorUserId: null });
    await ordersRepository.updateOrderStatusWithCancellation(client, order.id, 'RETURNED', undefined, reason);
  } else {
    // payment_status is deliberately untouched: a delivered COD order stays PENDING_COLLECTION until collected (§5.21.3).
    await ordersRepository.updateOrderStatus(client, order.id, 'DELIVERED');
  }

  await appendStatusHistory(
    {
      entityType: 'order',
      entityId: order.id,
      statusField: 'order_status',
      previousStatus: order.order_status,
      newStatus: target,
      reason,
      actorUserId: null,
      actorType: 'SYSTEM',
    },
    client,
  );
  await appendAudit(
    {
      entityType: 'order',
      entityId: order.id,
      action: 'order_status_change',
      previousValue: order.order_status,
      newValue: target,
      reason,
      actorType: 'SYSTEM',
    },
    client,
  );
}

export async function applyCourierStatusUpdate(update: SyncUpdate, requestId?: string): Promise<SyncOutcome> {
  const base = {
    courierCode: update.courierCode,
    courierOrderId: update.courierOrderId,
    source: update.source,
    providerEventId: update.providerEventId ?? null,
    occurredAt: update.occurredAt ?? null,
  };

  const located = await shipmentsRepository.findByCourierAndOrderId(update.courierCode, update.courierOrderId);

  if (!located || update.status === null) {
    const skipReason: SkipReason = !located ? 'UNKNOWN_SHIPMENT' : 'UNRECOGNIZED_STATUS';
    if (update.status === null) logger.warn({ courier: update.courierCode }, 'unrecognized courier status ignored');
    await withTransaction((client) =>
      syncEvents.record(client, {
        ...base,
        shipmentId: located?.id ?? null,
        reportedStatus: update.status,
        dedupeKey: update.status ? dedupeKeyOf({ ...update, status: update.status }) : 'unrecognized',
        applied: false,
        skipReason,
      }),
    );
    return { applied: false, skipReason, shipmentId: located?.id ?? null, status: located?.shipment_status ?? null };
  }

  const target: ShipmentStatus = update.status;
  const dedupeKey = dedupeKeyOf({ ...update, status: target });

  return withTransaction(async (client): Promise<SyncOutcome> => {
    // Lock order first, then shipment — the same order shipment creation uses, so the two cannot deadlock.
    const order = await ordersRepository.getOrderById(located.order_id, { forUpdate: true, db: client });
    const shipment = await shipmentsRepository.getShipmentByIdForUpdate(client, located.id);
    if (!order || !shipment) {
      throw new Error('Shipment or order disappeared during sync.');
    }

    const skip = async (skipReason: SkipReason): Promise<SyncOutcome> => {
      await syncEvents.record(client, {
        ...base,
        shipmentId: shipment.id,
        reportedStatus: target,
        dedupeKey,
        applied: false,
        skipReason,
      });
      return { applied: false, skipReason, shipmentId: shipment.id, status: shipment.shipment_status };
    };

    const current = shipment.shipment_status;

    // §4.6 duplicate: same provider event seen before, or the shipment is already in that status.
    if (current === target || (await syncEvents.appliedExists(client, shipment.id, dedupeKey))) {
      return skip('DUPLICATE');
    }
    // §4.6 out of order: an update that is not ahead of what is recorded never regresses status.
    if (!FAILURE_STATES.includes(target) && ORDINAL[target] <= shipment.status_sequence) {
      return skip('STALE');
    }

    const path = systemTransitionPath(current, target);
    if (!path) return skip('INVALID_TRANSITION');

    await client.query('SAVEPOINT sync_apply');
    try {
      let from = current;
      for (const step of path) {
        await transitionInTx(client, order.id, from, step, { type: 'SYSTEM' }, requestId, {}, `courier sync (${update.source.toLowerCase()})`);
        from = step;
      }
      if (target === 'DELIVERED' || target === 'RETURNED') {
        await cascadeToOrder(client, order, target);
      }
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT sync_apply');
      if (err instanceof InvalidTransitionError) {
        logger.warn({ shipmentId: shipment.id, from: current, to: target }, 'courier sync update could not be applied');
        return skip('INVALID_TRANSITION');
      }
      throw err;
    }

    await syncEvents.record(client, {
      ...base,
      shipmentId: shipment.id,
      reportedStatus: target,
      dedupeKey,
      applied: true,
      skipReason: null,
    });
    return { applied: true, skipReason: null, shipmentId: shipment.id, status: target };
  });
}
