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
import type { AreaUnitType, WardUnitType } from '../types/enums.js';
import type { DiscountType } from './coupon.repository.js';
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
  // 0018_shipping.sql — snapshot of the zone used at order time (spec 21), never recalculated.
  shipping_zone_code: string | null;
  coupon_id: string | null;
  discount_amount: string | null;
  total_amount: string;
  cancellation_reason: string | null;
  cancelled_at: Date | null;
  cancelled_by: string | null;
  // 0011_customer_checkout.sql — delivery-address snapshot (02-customer §2.9.4).
  full_name: string | null;
  phone_number: string | null;
  division: string | null;
  district: string | null;
  area_unit_type: AreaUnitType | null;
  area_unit_name: string | null;
  ward_unit_type: WardUnitType | null;
  ward_unit_name: string | null;
  detailed_address: string | null;
  postal_code: string | null;
  // 0011_customer_checkout.sql — payment idempotency/dedup (03-payment-order §3.1).
  bkash_transaction_id: string | null;
  idempotency_key: string | null;
  // 0011_customer_checkout.sql — coupon historical snapshot (10-coupon-discount §8.23).
  coupon_code: string | null;
  discount_type: DiscountType | null;
  eligible_subtotal: string | null;
  // 0012_admin_order_views.sql � admin panel (spec 13).
  last_payment_rejected_at: Date | null;
  internal_note: string | null;
  created_at: Date;
  updated_at: Date;
};

export type Order = Omit<OrderRow, 'subtotal' | 'shipping_amount' | 'discount_amount' | 'total_amount' | 'eligible_subtotal'> & {
  subtotal: number;
  shipping_amount: number;
  discount_amount: number | null;
  total_amount: number;
  eligible_subtotal: number | null;
};

function toOrder(row: OrderRow): Order {
  return {
    ...row,
    subtotal: Number(row.subtotal),
    shipping_amount: Number(row.shipping_amount),
    discount_amount: row.discount_amount !== null ? Number(row.discount_amount) : null,
    total_amount: Number(row.total_amount),
    eligible_subtotal: row.eligible_subtotal !== null ? Number(row.eligible_subtotal) : null,
  };
}

const COLUMNS = `
  id, order_number, customer_id, payment_method, order_status, payment_status,
  subtotal, shipping_amount, shipping_zone_code, coupon_id, discount_amount, total_amount,
  cancellation_reason, cancelled_at, cancelled_by,
  full_name, phone_number, division, district,
  area_unit_type, area_unit_name, ward_unit_type, ward_unit_name,
  detailed_address, postal_code,
  bkash_transaction_id, idempotency_key,
  coupon_code, discount_type, eligible_subtotal,
  last_payment_rejected_at, internal_note,
  created_at, updated_at
`;

/** Delivery-address snapshot input — mirrors `customers` table's address shape exactly (§2.9.4). */
export type OrderAddressSnapshot = {
  fullName: string;
  phoneNumber: string;
  division: string;
  district: string;
  areaUnitType: AreaUnitType;
  areaUnitName: string;
  wardUnitType: WardUnitType;
  wardUnitName: string;
  detailedAddress: string;
  postalCode: string | null;
};

/**
 * Create an order record with initial statuses. Called at order creation time,
 * inside the caller's transaction (spec 11 §4, §8).
 *
 * `couponId` is nullable — 0006_orders.sql's own comment says spec 11 "wires
 * the real write path"; this is that write path. Coupon snapshot fields
 * (couponCode/discountType/eligibleSubtotal, §8.23) travel together and are
 * all-or-nothing with couponId.
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
    shipping_zone_code?: string | null;
    coupon_id?: string | null;
    discount_amount: number | null;
    total_amount: number;
    address: OrderAddressSnapshot;
    bkash_transaction_id?: string | null;
    idempotency_key?: string | null;
    coupon_code?: string | null;
    discount_type?: DiscountType | null;
    eligible_subtotal?: number | null;
  },
): Promise<Order> {
  try {
    const { rows } = await client.query<OrderRow>(
      `INSERT INTO orders (
         order_number, customer_id, payment_method, order_status, payment_status,
         subtotal, shipping_amount, coupon_id, discount_amount, total_amount,
         full_name, phone_number, division, district,
         area_unit_type, area_unit_name, ward_unit_type, ward_unit_name,
         detailed_address, postal_code,
         bkash_transaction_id, idempotency_key,
         coupon_code, discount_type, eligible_subtotal, shipping_zone_code
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
       RETURNING ${COLUMNS}`,
      [
        data.order_number,
        data.customer_id,
        data.payment_method,
        data.order_status,
        data.payment_status,
        data.subtotal,
        data.shipping_amount,
        data.coupon_id ?? null,
        data.discount_amount,
        data.total_amount,
        data.address.fullName,
        data.address.phoneNumber,
        data.address.division,
        data.address.district,
        data.address.areaUnitType,
        data.address.areaUnitName,
        data.address.wardUnitType,
        data.address.wardUnitName,
        data.address.detailedAddress,
        data.address.postalCode,
        data.bkash_transaction_id ?? null,
        data.idempotency_key ?? null,
        data.coupon_code ?? null,
        data.discount_type ?? null,
        data.eligible_subtotal ?? null,
        data.shipping_zone_code ?? null,
      ],
    );
    return toOrder(rows[0]!);
  } catch (err) {
    throw toDomainError(err);
  }
}

/**
 * Idempotency dedup lookup (03-payment-order §3.1) — a repeated order-creation
 * request carrying the same client-generated key resolves to the original
 * order rather than creating a second one.
 */
export async function findByIdempotencyKey(key: string, db?: Db): Promise<Order | null> {
  return run(db, async (client) => {
    const { rows } = await client.query<OrderRow>(
      `SELECT ${COLUMNS} FROM orders WHERE idempotency_key = $1`,
      [key],
    );
    return rows[0] ? toOrder(rows[0]) : null;
  });
}

/**
 * Guest order lookup by (Order Number, Phone Number) pair — 02-customer
 * §2.9.5/§2.9.7: BOTH values must match in the SAME query, never two separate
 * lookups whose independent failure could leak which field was wrong. A
 * mismatched pair (wrong order number OR wrong phone OR both) returns null,
 * identically.
 */
export async function findByOrderNumberAndPhone(
  orderNumber: string,
  phoneNumber: string,
  db?: Db,
): Promise<Order | null> {
  return run(db, async (client) => {
    const { rows } = await client.query<OrderRow>(
      `SELECT ${COLUMNS} FROM orders WHERE order_number = $1 AND phone_number = $2`,
      [orderNumber, phoneNumber],
    );
    return rows[0] ? toOrder(rows[0]) : null;
  });
}

/** One order by its store Order Number (spec 15 account detail / Track Order's not-available-yet check). */
export async function findByOrderNumber(orderNumber: string, db?: Db): Promise<Order | null> {
  return run(db, async (client) => {
    const { rows } = await client.query<OrderRow>(`SELECT ${COLUMNS} FROM orders WHERE order_number = $1`, [orderNumber]);
    return rows[0] ? toOrder(rows[0]) : null;
  });
}

/**
 * Generates a human-friendly, unique order number: `FBK-YYYYMMDD-XXXXXX`
 * (date-based + a random uppercase-alphanumeric suffix). No generator existed
 * elsewhere in the codebase (grepped) — callers must retry on a
 * `ORDER_NUMBER_EXISTS` conflict (the `orders_order_number_key` unique
 * constraint is the actual enforcement point, per this repo's constraint-
 * mapping convention in `pgErrors.ts`), since this runs inside the same
 * transaction as the insert and cannot pre-check without racing.
 */
export function generateOrderNumber(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I ambiguity
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `FBK-${y}${m}${d}-${suffix}`;
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
       SET payment_status = $2::payment_status,
           last_payment_rejected_at = CASE
             WHEN $2::payment_status = 'REJECTED' AND payment_method = 'BKASH' THEN now()
             ELSE last_payment_rejected_at END,
           updated_at = now()
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
       SET order_status = $2::order_status,
           cancelled_at = CASE WHEN $2::order_status IN ('CANCELLED', 'RETURNED') THEN now() ELSE cancelled_at END,
           cancelled_by = CASE WHEN $2::order_status IN ('CANCELLED', 'RETURNED') THEN $3::uuid ELSE cancelled_by END,
           cancellation_reason = CASE WHEN $2::order_status IN ('CANCELLED', 'RETURNED') THEN $4::text ELSE cancellation_reason END,
           updated_at = now()
       WHERE id = $1
       RETURNING ${COLUMNS}`,
      [orderId, newStatus, cancelledBy ?? null, reason ?? null],
    );
    if (rows.length === 0) {
      throw new Error(`Order ${orderId} not found`);
    }
    return toOrder(rows[0]!);
  } catch (err) {
    throw toDomainError(err);
  }
}

export type OrderListFilter = {
  order_status?: OrderStatus[];
  payment_method?: PaymentMethod;
  payment_status?: PaymentStatus[];
  shipment_status?: string[];
  customer_id?: string;
  is_guest_order?: boolean;
  has_coupon?: boolean;
  has_cod_discrepancy?: boolean;
  /** Surfaces unconfirmed orders older than this many hours (never cancels them). */
  stale_after_hours?: number;
  created_after?: Date;
  created_before?: Date;
  q?: string;
};

export type OrderListSort = 'created_at' | 'total_amount' | 'last_payment_rejected_at';

/** An order plus the list-only derived fields �5.2 / �5.21.3 require (all computed per query, none stored). */
export type AdminOrderListItem = Order & {
  customer_account_type: 'GUEST' | 'REGISTERED';
  is_guest_order: boolean;
  shipment_status: string;
  has_coupon_applied: boolean;
  has_cod_collection_discrepancy: boolean;
};

const SORT_COLUMNS: Record<OrderListSort, string> = {
  created_at: 'o.created_at',
  total_amount: 'o.total_amount',
  last_payment_rejected_at: 'o.last_payment_rejected_at',
};

/**
 * List orders with pagination and optional filtering.
 * �5.2: mandatory pagination per 11-security-hardening �11.4.
 *
 * Joins `customers` (guest/registered, display only) and `shipments`
 * (a missing row reads as NOT_CREATED). The COD discrepancy is computed here
 * from the two statuses it derives from, never stored (�5.21.3).
 */
export async function listOrders(
  filter?: OrderListFilter,
  pagination?: { page: number; pageSize: number },
  db?: Db,
  sort?: { by: OrderListSort; direction: 'asc' | 'desc' },
): Promise<{ items: AdminOrderListItem[]; total: number }> {
  const page = pagination?.page ?? 1;
  const pageSize = pagination?.pageSize ?? 20;

  return run(db, async (client) => {
    const conditions: string[] = [];
    const values: unknown[] = [];
    const param = (v: unknown) => {
      values.push(v);
      return `$${values.length}`;
    };

    const shipmentStatusExpr = `COALESCE(sh.shipment_status::text, 'NOT_CREATED')`;
    const discrepancyExpr = `(o.payment_method = 'COD' AND o.order_status = 'DELIVERED' AND o.payment_status = 'PENDING_COLLECTION')`;

    if (filter?.order_status?.length) conditions.push(`o.order_status = ANY(${param(filter.order_status)}::order_status[])`);
    if (filter?.payment_method) conditions.push(`o.payment_method = ${param(filter.payment_method)}`);
    if (filter?.payment_status?.length) conditions.push(`o.payment_status = ANY(${param(filter.payment_status)}::payment_status[])`);
    if (filter?.shipment_status?.length) conditions.push(`${shipmentStatusExpr} = ANY(${param(filter.shipment_status)}::text[])`);
    if (filter?.customer_id) conditions.push(`o.customer_id = ${param(filter.customer_id)}`);
    if (filter?.is_guest_order !== undefined) {
      conditions.push(`(c.account_type = 'GUEST') = ${param(filter.is_guest_order)}`);
    }
    if (filter?.has_coupon !== undefined) conditions.push(`(o.coupon_id IS NOT NULL) = ${param(filter.has_coupon)}`);
    if (filter?.has_cod_discrepancy !== undefined) conditions.push(`${discrepancyExpr} = ${param(filter.has_cod_discrepancy)}`);
    if (filter?.stale_after_hours !== undefined) {
      conditions.push(
        `o.order_status IN ('PENDING_CONFIRMATION','COD_VERIFICATION_PENDING')
         AND o.created_at < now() - (${param(filter.stale_after_hours)}::int * interval '1 hour')`,
      );
    }
    if (filter?.created_after) conditions.push(`o.created_at >= ${param(filter.created_after)}`);
    if (filter?.created_before) conditions.push(`o.created_at <= ${param(filter.created_before)}`);
    if (filter?.q) {
      // Escape LIKE metacharacters so a search for "%" or "_" is literal.
      const escapeLike = (v: string) => v.replace(/[\\%_]/g, (m) => `\\${m}`);
      const like = `%${escapeLike(filter.q)}%`;
      const p = param(like);
      conditions.push(`(o.order_number ILIKE ${p} OR o.full_name ILIKE ${p} OR o.phone_number ILIKE ${p})`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sortColumn = SORT_COLUMNS[sort?.by ?? 'created_at'];
    const direction = sort?.direction === 'asc' ? 'ASC' : 'DESC';

    const limit = param(pageSize);
    const offset = param((page - 1) * pageSize);

    const columns = COLUMNS.split(',')
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => `o.${c}`)
      .join(', ');

    const { rows } = await client.query<
      OrderRow & {
        total: string;
        customer_account_type: 'GUEST' | 'REGISTERED';
        shipment_status: string;
        has_coupon_applied: boolean;
        has_cod_collection_discrepancy: boolean;
      }
    >(
      `SELECT ${columns},
              c.account_type AS customer_account_type,
              ${shipmentStatusExpr} AS shipment_status,
              (o.coupon_id IS NOT NULL) AS has_coupon_applied,
              ${discrepancyExpr} AS has_cod_collection_discrepancy,
              count(*) OVER()::text AS total
         FROM orders o
         JOIN customers c ON c.id = o.customer_id
         LEFT JOIN shipments sh ON sh.order_id = o.id
         ${where}
        ORDER BY ${sortColumn} ${direction} NULLS LAST, o.id DESC
        LIMIT ${limit} OFFSET ${offset}`,
      values,
    );

    return {
      items: rows.map((r) => ({
        ...toOrder(r),
        customer_account_type: r.customer_account_type,
        is_guest_order: r.customer_account_type === 'GUEST',
        shipment_status: r.shipment_status,
        has_coupon_applied: r.has_coupon_applied,
        has_cod_collection_discrepancy: r.has_cod_collection_discrepancy,
      })),
      total: rows[0] ? Number(rows[0].total) : 0,
    };
  });
}
