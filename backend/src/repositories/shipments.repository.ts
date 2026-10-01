/**
 * Shipments repository — raw SQL operations for shipment state transitions
 *
 * Every write function takes an explicit pg.PoolClient (never opens its own
 * transaction). All operations join the caller's transaction so state changes
 * and audit records commit together (§5.21.11).
 */

import pg from 'pg';
import type { ShipmentStatus } from '../types/orderEnums.js';
import { run, type Db } from './db.js';
import { toDomainError } from './pgErrors.js';

export type ShipmentRow = {
  id: string;
  order_id: string;
  shipment_status: ShipmentStatus;
  courier: string | null;
  courier_order_id: string | null;
  courier_error: string | null;
  courier_error_at: Date | null;
  return_reason: string | null;
  // spec 14 (0014)
  tracking_url: string | null;
  cod_amount: string | null;
  declared_weight_grams: number | null;
  last_error_courier: string | null;
  created_with_courier_at: Date | null;
  shipped_at: Date | null;
  cancelled_with_courier_at: Date | null;
  // spec 15 (0015)
  status_sequence: number;
  last_synced_at: Date | null;
  last_events: TrackingEventSnapshot[] | null;
  last_estimated_delivery: Date | null;
  last_delivery_area: string | null;
  created_at: Date;
  updated_at: Date;
};

/** One normalized courier event as cached on the shipment (no raw provider data). */
export type TrackingEventSnapshot = { status: ShipmentStatus; occurredAt: string | null; description: string };

const COLUMNS = `
  id, order_id, shipment_status, courier, courier_order_id,
  courier_error, courier_error_at, return_reason, tracking_url, cod_amount,
  declared_weight_grams, last_error_courier, created_with_courier_at, shipped_at,
  cancelled_with_courier_at, status_sequence, last_synced_at, last_events,
  last_estimated_delivery, last_delivery_area, created_at, updated_at
`;

/**
 * Create a shipment record for an order (called once at order creation, status NOT_CREATED).
 * Joins the caller's transaction.
 */
export async function createShipmentRow(client: pg.PoolClient, orderId: string): Promise<ShipmentRow> {
  try {
    const { rows } = await client.query<ShipmentRow>(
      `INSERT INTO shipments (order_id, shipment_status)
       VALUES ($1, 'NOT_CREATED')
       RETURNING ${COLUMNS}`,
      [orderId],
    );
    return rows[0]!;
  } catch (err) {
    throw toDomainError(err);
  }
}

/**
 * Retrieve a shipment by order ID. Optional FOR UPDATE lock for transition-time
 * row locking.
 */
export async function getShipmentByOrderId(
  orderId: string,
  options?: { forUpdate?: boolean; db?: Db },
): Promise<ShipmentRow | null> {
  return run(options?.db, async (client) => {
    const lock = options?.forUpdate ? ' FOR UPDATE' : '';
    const { rows } = await client.query<ShipmentRow>(
      `SELECT ${COLUMNS} FROM shipments WHERE order_id = $1${lock}`,
      [orderId],
    );
    return rows[0] ?? null;
  });
}

/** Shipment status per order id, for customer order-history rows. Orders with no shipment row are absent from the map. */
export async function listStatusByOrderIds(
  orderIds: string[],
  db?: Db,
): Promise<Map<string, ShipmentStatus>> {
  if (orderIds.length === 0) return new Map();
  return run(db, async (client) => {
    const { rows } = await client.query<{ order_id: string; shipment_status: ShipmentStatus }>(
      `SELECT order_id, shipment_status FROM shipments WHERE order_id = ANY($1::uuid[])`,
      [orderIds],
    );
    return new Map(rows.map((row) => [row.order_id, row.shipment_status]));
  });
}

/**
 * Update shipment_status. Joins the caller's transaction.
 */
export async function updateShipmentStatus(
  client: pg.PoolClient,
  orderId: string,
  newStatus: ShipmentStatus,
): Promise<ShipmentRow> {
  try {
    const { rows } = await client.query<ShipmentRow>(
      `UPDATE shipments
       SET shipment_status = $2, updated_at = now()
       WHERE order_id = $1
       RETURNING ${COLUMNS}`,
      [orderId, newStatus],
    );
    if (rows.length === 0) {
      throw new Error(`Shipment for order ${orderId} not found`);
    }
    return rows[0]!;
  } catch (err) {
    throw toDomainError(err);
  }
}

/**
 * Update shipment status with optional courier details.
 */
export async function updateShipmentStatusWithCourierDetails(
  client: pg.PoolClient,
  orderId: string,
  newStatus: ShipmentStatus,
  courier?: string,
  courierOrderId?: string,
): Promise<ShipmentRow> {
  try {
    const { rows } = await client.query<ShipmentRow>(
      `UPDATE shipments
       SET shipment_status = $2,
           courier = COALESCE($3, courier),
           courier_order_id = COALESCE($4, courier_order_id),
           updated_at = now()
       WHERE order_id = $1
       RETURNING ${COLUMNS}`,
      [orderId, newStatus, courier ?? null, courierOrderId ?? null],
    );
    if (rows.length === 0) {
      throw new Error(`Shipment for order ${orderId} not found`);
    }
    return rows[0]!;
  } catch (err) {
    throw toDomainError(err);
  }
}

/**
 * Record a courier error for a shipment.
 */
export async function recordCourierError(
  client: pg.PoolClient,
  orderId: string,
  error: string,
): Promise<ShipmentRow> {
  try {
    const { rows } = await client.query<ShipmentRow>(
      `UPDATE shipments
       SET courier_error = $2, courier_error_at = now(), updated_at = now()
       WHERE order_id = $1
       RETURNING ${COLUMNS}`,
      [orderId, error],
    );
    if (rows.length === 0) {
      throw new Error(`Shipment for order ${orderId} not found`);
    }
    return rows[0]!;
  } catch (err) {
    throw toDomainError(err);
  }
}

/**
 * Spec 14: real orders have no shipment row until the first shipment action, so
 * creation upserts one and returns it row-locked (FOR UPDATE). Joins the caller's transaction.
 */
export async function ensureShipmentRowLocked(client: pg.PoolClient, orderId: string): Promise<ShipmentRow> {
  try {
    await client.query(
      `INSERT INTO shipments (order_id, shipment_status) VALUES ($1, 'NOT_CREATED') ON CONFLICT (order_id) DO NOTHING`,
      [orderId],
    );
    const { rows } = await client.query<ShipmentRow>(
      `SELECT ${COLUMNS} FROM shipments WHERE order_id = $1 FOR UPDATE`,
      [orderId],
    );
    return rows[0]!;
  } catch (err) {
    throw toDomainError(err);
  }
}

export type ShipmentFieldUpdate = {
  courier?: string;
  courierOrderId?: string | null;
  trackingUrl?: string | null;
  codAmount?: number | null;
  declaredWeightGrams?: number | null;
  createdWithCourierAt?: boolean;
  shippedAt?: boolean;
  cancelledWithCourierAt?: boolean;
  /** Records the failure (message, time, courier). */
  error?: { message: string; courier: string };
  /** Clears the previous failure when a new attempt starts. */
  clearError?: boolean;
};

/**
 * Writes the new status plus the courier-related fields in one UPDATE. Status
 * validity is the service's job (isValidShipmentTransition); this only persists.
 */
export async function applyTransition(
  client: pg.PoolClient,
  orderId: string,
  newStatus: ShipmentStatus,
  fields: ShipmentFieldUpdate = {},
): Promise<ShipmentRow> {
  const values: unknown[] = [orderId, newStatus];
  const sets = ['shipment_status = $2', 'updated_at = now()'];
  const add = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };
  if (fields.courier !== undefined) add('courier', fields.courier);
  if (fields.courierOrderId !== undefined) add('courier_order_id', fields.courierOrderId);
  if (fields.trackingUrl !== undefined) add('tracking_url', fields.trackingUrl);
  if (fields.codAmount !== undefined) add('cod_amount', fields.codAmount);
  if (fields.declaredWeightGrams !== undefined) add('declared_weight_grams', fields.declaredWeightGrams);
  if (fields.createdWithCourierAt) sets.push('created_with_courier_at = now()');
  if (fields.shippedAt) sets.push('shipped_at = now()');
  if (fields.cancelledWithCourierAt) sets.push('cancelled_with_courier_at = now()');
  if (fields.clearError) sets.push('courier_error = NULL', 'courier_error_at = NULL', 'last_error_courier = NULL');
  if (fields.error) {
    add('courier_error', fields.error.message);
    add('last_error_courier', fields.error.courier);
    sets.push('courier_error_at = now()');
  }
  try {
    const { rows } = await client.query<ShipmentRow>(
      `UPDATE shipments SET ${sets.join(', ')} WHERE order_id = $1 RETURNING ${COLUMNS}`,
      values,
    );
    if (rows.length === 0) throw new Error(`Shipment for order ${orderId} not found`);
    return rows[0]!;
  } catch (err) {
    throw toDomainError(err);
  }
}

/**
 * Track Order lookup (spec 15): shipments whose courier-issued id matches. More than one
 * row means two couriers issued the same string — callers treat that as not-found rather
 * than guessing (§4.15, §4.16). LIMIT 2 is enough to detect the collision.
 */
export async function findByCourierOrderId(courierOrderId: string, db?: Db): Promise<ShipmentRow[]> {
  return run(db, async (client) => {
    const { rows } = await client.query<ShipmentRow>(
      `SELECT ${COLUMNS} FROM shipments WHERE courier_order_id = $1 LIMIT 2`,
      [courierOrderId],
    );
    return rows;
  });
}

/** Webhook/poll resolution: the courier-scoped id (§4.15 — the id is only meaningful per courier). */
export async function findByCourierAndOrderId(courierCode: string, courierOrderId: string, db?: Db): Promise<ShipmentRow | null> {
  return run(db, async (client) => {
    const { rows } = await client.query<ShipmentRow>(
      `SELECT ${COLUMNS} FROM shipments WHERE courier = $1 AND courier_order_id = $2 LIMIT 1`,
      [courierCode, courierOrderId],
    );
    return rows[0] ?? null;
  });
}

/**
 * Atomically claims the right to refresh this shipment from the courier: true for exactly
 * one caller per TTL window, so concurrent requests/polls produce one provider call.
 */
export async function claimRefresh(shipmentId: string, ttlSeconds: number, db?: Db): Promise<boolean> {
  return run(db, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE shipments SET last_synced_at = now()
        WHERE id = $1 AND (last_synced_at IS NULL OR last_synced_at < now() - make_interval(secs => $2))`,
      [shipmentId, ttlSeconds],
    );
    return (rowCount ?? 0) > 0;
  });
}

export async function getShipmentById(shipmentId: string, db?: Db): Promise<ShipmentRow | null> {
  return run(db, async (client) => {
    const { rows } = await client.query<ShipmentRow>(`SELECT ${COLUMNS} FROM shipments WHERE id = $1`, [shipmentId]);
    return rows[0] ?? null;
  });
}

/** Locks a shipment row for the sync applier. */
export async function getShipmentByIdForUpdate(client: pg.PoolClient, shipmentId: string): Promise<ShipmentRow | null> {
  const { rows } = await client.query<ShipmentRow>(`SELECT ${COLUMNS} FROM shipments WHERE id = $1 FOR UPDATE`, [shipmentId]);
  return rows[0] ?? null;
}

/** Shipments the poller should ask the courier about (courier supports tracking, parcel exists, not terminal). */
export async function listPollable(limit: number, db?: Db): Promise<ShipmentRow[]> {
  return run(db, async (client) => {
    const { rows } = await client.query<ShipmentRow>(
      `SELECT ${COLUMNS.split(',').map((c) => `s.${c.trim()}`).join(', ')}
         FROM shipments s
         JOIN couriers c ON c.code = s.courier
        WHERE s.shipment_status IN ('CREATED','SHIPPED','IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERY_FAILED')
          AND s.courier_order_id IS NOT NULL
          AND c.is_enabled = true AND c.supports_tracking = true
        ORDER BY s.last_synced_at ASC NULLS FIRST
        LIMIT $1`,
      [limit],
    );
    return rows;
  });
}

export type TrackingSnapshotInput = {
  events: TrackingEventSnapshot[];
  estimatedDeliveryAt: string | null;
  deliveryAreaSummary: string | null;
};

/** Caches the last normalized tracking result so reads within the TTL need no provider call. */
export async function saveTrackingSnapshot(
  shipmentId: string,
  snapshot: TrackingSnapshotInput,
  db?: Db,
): Promise<void> {
  await run(db, async (client) => {
    await client.query(
      `UPDATE shipments
          SET last_synced_at = now(), last_events = $2::jsonb,
              last_estimated_delivery = $3, last_delivery_area = $4
        WHERE id = $1`,
      [shipmentId, JSON.stringify(snapshot.events), snapshot.estimatedDeliveryAt, snapshot.deliveryAreaSummary],
    );
  });
}

/** Marks a sync attempt without changing the cached events (provider returned nothing new). */
export async function touchSynced(shipmentId: string, db?: Db): Promise<void> {
  await run(db, async (client) => {
    await client.query(`UPDATE shipments SET last_synced_at = now() WHERE id = $1`, [shipmentId]);
  });
}

/** Marks the courier-side parcel cancelled without changing shipment_status. */
export async function markCancelledWithCourier(client: pg.PoolClient, orderId: string): Promise<void> {
  await client.query(
    `UPDATE shipments SET cancelled_with_courier_at = now(), updated_at = now() WHERE order_id = $1`,
    [orderId],
  );
}
