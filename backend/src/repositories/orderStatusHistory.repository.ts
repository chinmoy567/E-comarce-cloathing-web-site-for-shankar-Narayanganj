/**
 * Order Status History Repository — Append-only audit trail
 *
 * 07-order-state-machine §5.21.11: Order/payment/shipment status changes
 * recorded separately from the generic audit_logs table for fast, order-scoped
 * queries in the Admin/Manager order-detail UI.
 */

import pg from 'pg';
import type { ActorType } from '../types/enums.js';
import { run, type Db } from './db.js';
import { toDomainError } from './pgErrors.js';

export type OrderStatusHistoryRow = {
  id: string;
  order_id: string;
  status_field: 'order_status' | 'payment_status' | 'shipment_status';
  previous_status: string | null;
  new_status: string;
  reason: string | null;
  actor_user_id: string | null;
  actor_type: ActorType;
  created_at: Date;
};

export type OrderStatusHistoryEntry = OrderStatusHistoryRow;

/**
 * Append a single status-change record to order_status_history.
 * Called inside the same transaction as the actual status update,
 * so the change and its audit record commit together (§5.21.11).
 */
export async function append(
  entry: {
    entityType: 'order';
    entityId: string;
    statusField: 'order_status' | 'payment_status' | 'shipment_status';
    previousStatus: string | null;
    newStatus: string;
    reason?: string | null;
    actorUserId?: string | null;
    actorType: ActorType;
    requestId?: string | null;
  },
  db?: Db,
): Promise<OrderStatusHistoryEntry> {
  return run(db, async (client) => {
    try {
      const { rows } = await client.query<OrderStatusHistoryRow>(
        `INSERT INTO order_status_history (
           order_id, status_field, previous_status, new_status, reason,
           actor_user_id, actor_type
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, order_id, status_field, previous_status, new_status, reason,
                   actor_user_id, actor_type, created_at`,
        [
          entry.entityId,
          entry.statusField,
          entry.previousStatus ?? null,
          entry.newStatus,
          entry.reason ?? null,
          entry.actorUserId ?? null,
          entry.actorType,
        ],
      );
      return rows[0]!;
    } catch (err) {
      throw toDomainError(err);
    }
  });
}

/**
 * List status history for an order (newest first).
 */
export async function listForOrder(
  orderId: string,
  pagination?: { page: number; pageSize: number },
  db?: Db,
): Promise<{ items: OrderStatusHistoryEntry[]; total: number }> {
  const page = pagination?.page ?? 1;
  const pageSize = pagination?.pageSize ?? 50;

  return run(db, async (client) => {
    const { rows } = await client.query<OrderStatusHistoryRow & { total: string }>(
      `SELECT id, order_id, status_field, previous_status, new_status, reason,
              actor_user_id, actor_type, created_at,
              count(*) OVER()::text AS total
       FROM order_status_history
       WHERE order_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [orderId, pageSize, (page - 1) * pageSize],
    );

    return {
      items: rows.map((r) => ({
        id: r.id,
        order_id: r.order_id,
        status_field: r.status_field,
        previous_status: r.previous_status,
        new_status: r.new_status,
        reason: r.reason,
        actor_user_id: r.actor_user_id,
        actor_type: r.actor_type,
        created_at: r.created_at,
      })),
      total: rows[0] ? Number(rows[0].total) : 0,
    };
  });
}
