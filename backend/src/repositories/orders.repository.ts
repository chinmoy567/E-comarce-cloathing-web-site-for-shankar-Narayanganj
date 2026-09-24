/**
 * Orders repository — raw SQL operations for order state transitions
 *
 * Every write function takes an explicit pg.PoolClient (never opens its own
 * transaction), following the pattern of inventory.repository.ts. All operations
 * join the caller's transaction so state changes and audit records commit
 * together (§5.21.11).
 */

import pg from 'pg';
import type { OrderStatus, PaymentStatus, PaymentMethod } from '../types/orderEnums.js';
import { run, type Db } from './db.js';
import { toDomainError } from './pgErrors.js';

export type OrderRow = {
  id: string;
  order_number: string;
  customer_id: string;
  payment_method: PaymentMethod;
  order_status: OrderStatus;
  payment_status: PaymentStatus;
  subtotal: string;
  shipping_amount: string;
  coupon_id: string | null;
  discount_amount: string | null;
  total_amount: string;
  cancellation_reason: string | null;
  cancelled_at: Date | null;
  cancelled_by: string | null;
  created_at: Date;
  updated_at: Date;
};

export type Order = OrderRow & {
  subtotal: number;
  shipping_amount: number;
  discount_amount: number | null;
  total_amount: number;
};

function toOrder(row: OrderRow): Order {
  return {
    ...row,
    subtotal: Number(row.subtotal),
    shipping_amount: Number(row.shipping_amount),
    discount_amount: row.discount_amount !== null ? Number(row.discount_amount) : null,
    total_amount: Number(row.total_amount),
  };
}

const COLUMNS = `
  id, order_number, customer_id, payment_method, order_status, payment_status,
  subtotal, shipping_amount, coupon_id, discount_amount, total_amount,
  cancellation_reason, cancelled_at, cancelled_by, created_at, updated_at
`;

/**
 * Create an order record with initial statuses. Called at order creation time.
 * Joins the caller's transaction.
 */
export async function createOrder(
  client: pg.PoolClient,
  data: {
    order_number: string;
    customer_id: string;
    payment_method: PaymentMethod;
    order_status: OrderStatus;
    payment_status: PaymentStatus;
    subtotal: number;
    shipping_amount: number;
    discount_amount: number | null;
    total_amount: number;
  },
): Promise<Order> {
  try {
    const { rows } = await client.query<OrderRow>(
      `INSERT INTO orders (
         order_number, customer_id, payment_method, order_status, payment_status,
         subtotal, shipping_amount, coupon_id, discount_amount, total_amount
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,$8,$9)
       RETURNING ${COLUMNS}`,
      [
        data.order_number,
        data.customer_id,
        data.payment_method,
        data.order_status,
        data.payment_status,
        data.subtotal,
        data.shipping_amount,
        data.discount_amount,
        data.total_amount,
      ],
    );
    return toOrder(rows[0]!);
  } catch (err) {
    throw toDomainError(err);
  }
}

/**
 * Retrieve an order by ID. Optional FOR UPDATE lock for transition-time
 * row locking (prevents concurrent transitions on the same order).
 */
export async function getOrderById(
  orderId: string,
  options?: { forUpdate?: boolean; db?: Db },
): Promise<Order | null> {
  return run(options?.db, async (client) => {
    const lock = options?.forUpdate ? ' FOR UPDATE' : '';
    const { rows } = await client.query<OrderRow>(
      `SELECT ${COLUMNS} FROM orders WHERE id = $1${lock}`,
      [orderId],
    );
    return rows[0] ? toOrder(rows[0]) : null;
  });
}

/**
 * Update order_status only. Joins the caller's transaction.
 */
export async function updateOrderStatus(
  client: pg.PoolClient,
  orderId: string,
  newStatus: OrderStatus,
): Promise<Order> {
  try {
    const { rows } = await client.query<OrderRow>(
      `UPDATE orders
       SET order_status = $2, updated_at = now()
       WHERE id = $1
       RETURNING ${COLUMNS}`,
      [orderId, newStatus],
    );
    if (rows.length === 0) {
      throw new Error(`Order ${orderId} not found`);
    }
    return toOrder(rows[0]!);
  } catch (err) {
    throw toDomainError(err);
  }
}

/**
 * Update payment_status only. Joins the caller's transaction.
 */
export async function updatePaymentStatus(
  client: pg.PoolClient,
  orderId: string,
  newStatus: PaymentStatus,
): Promise<Order> {
  try {
    const { rows } = await client.query<OrderRow>(
      `UPDATE orders
       SET payment_status = $2, updated_at = now()
       WHERE id = $1
       RETURNING ${COLUMNS}`,
      [orderId, newStatus],
    );
    if (rows.length === 0) {
      throw new Error(`Order ${orderId} not found`);
    }
    return toOrder(rows[0]!);
  } catch (err) {
    throw toDomainError(err);
  }
}

/**
 * Update order_status with optional cancellation tracking.
 */
export async function updateOrderStatusWithCancellation(
  client: pg.PoolClient,
  orderId: string,
  newStatus: OrderStatus,
  cancelledBy?: string,
  reason?: string,
): Promise<Order> {
  try {
    const { rows } = await client.query<OrderRow>(
      `UPDATE orders
       SET order_status = $2,
           cancelled_at = CASE WHEN $2::order_status IN ('CANCELLED', 'RETURNED') THEN now() ELSE cancelled_at END,
           cancelled_by = CASE WHEN $2::order_status IN ('CANCELLED', 'RETURNED') THEN $4 ELSE cancelled_by END,
           cancellation_reason = CASE WHEN $2::order_status IN ('CANCELLED', 'RETURNED') THEN $5 ELSE cancellation_reason END,
           updated_at = now()
       WHERE id = $1
       RETURNING ${COLUMNS}`,
      [orderId, newStatus, newStatus, cancelledBy ?? null, reason ?? null],
    );
    if (rows.length === 0) {
      throw new Error(`Order ${orderId} not found`);
    }
    return toOrder(rows[0]!);
  } catch (err) {
    throw toDomainError(err);
  }
}

/**
 * List orders with pagination and optional filtering.
 * §5.2: mandatory pagination per 11-security-hardening §11.4.
 */
export async function listOrders(
  filter?: {
    order_status?: OrderStatus;
    payment_method?: PaymentMethod;
    payment_status?: PaymentStatus;
    customer_id?: string;
    created_after?: Date;
    created_before?: Date;
  },
  pagination?: { page: number; pageSize: number },
  db?: Db,
): Promise<{ items: Order[]; total: number }> {
  const page = pagination?.page ?? 1;
  const pageSize = pagination?.pageSize ?? 20;

  return run(db, async (client) => {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filter?.order_status) {
      values.push(filter.order_status);
      conditions.push(`order_status = $${values.length}`);
    }
    if (filter?.payment_method) {
      values.push(filter.payment_method);
      conditions.push(`payment_method = $${values.length}`);
    }
    if (filter?.payment_status) {
      values.push(filter.payment_status);
      conditions.push(`payment_status = $${values.length}`);
    }
    if (filter?.customer_id) {
      values.push(filter.customer_id);
      conditions.push(`customer_id = $${values.length}`);
    }
    if (filter?.created_after) {
      values.push(filter.created_after);
      conditions.push(`created_at >= $${values.length}`);
    }
    if (filter?.created_before) {
      values.push(filter.created_before);
      conditions.push(`created_at <= $${values.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    values.push(pageSize, (page - 1) * pageSize);

    const { rows } = await client.query<OrderRow & { total: string }>(
      `SELECT ${COLUMNS}, count(*) OVER()::text AS total
       FROM orders
       ${where}
       ORDER BY created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );

    return {
      items: rows.map(toOrder),
      total: rows[0] ? Number(rows[0].total) : 0,
    };
  });
}
