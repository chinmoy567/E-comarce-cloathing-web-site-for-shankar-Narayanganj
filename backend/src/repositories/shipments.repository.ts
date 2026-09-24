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
  created_at: Date;
  updated_at: Date;
};

const COLUMNS = `
  id, order_id, shipment_status, courier, courier_order_id,
  courier_error, courier_error_at, return_reason, created_at, updated_at
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
