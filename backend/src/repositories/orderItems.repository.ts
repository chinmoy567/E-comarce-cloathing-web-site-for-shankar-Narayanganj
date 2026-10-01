import type pg from 'pg';
import { toDomainError } from './pgErrors.js';

/**
 * Order line items — snapshot rows written once at order creation
 * (0011_customer_checkout.sql, spec 11). `insertMany` takes the caller's
 * transaction client explicitly and never opens its own, matching
 * `inventory.repository.ts`/`coupon.repository.ts::recordCouponUsage`'s
 * contract — it can only ever run inside a caller-managed `withTransaction`
 * block (the same order-creation transaction that inserts the order row).
 */

export type OrderItemRow = {
  id: string;
  order_id: string;
  product_id: string;
  product_variant_id: string | null;
  product_name: string;
  variant_description: string | null;
  unit_price: string;
  quantity: number;
  line_total: string;
  created_at: Date;
};

export type OrderItem = Omit<OrderItemRow, 'unit_price' | 'line_total'> & {
  unitPrice: number;
  lineTotal: number;
};

function toOrderItem(row: OrderItemRow): OrderItem {
  return {
    id: row.id,
    order_id: row.order_id,
    product_id: row.product_id,
    product_variant_id: row.product_variant_id,
    product_name: row.product_name,
    variant_description: row.variant_description,
    unitPrice: Number(row.unit_price),
    quantity: row.quantity,
    lineTotal: Number(row.line_total),
    created_at: row.created_at,
  };
}

export type OrderItemInput = {
  productId: string;
  productVariantId: string | null;
  productName: string;
  variantDescription: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
};

/** Bulk-inserts every order line in one statement. Joins the caller's transaction. */
export async function insertMany(
  client: pg.PoolClient,
  orderId: string,
  items: OrderItemInput[],
): Promise<OrderItem[]> {
  if (items.length === 0) return [];

  try {
    const values: unknown[] = [];
    const placeholders = items
      .map((item, i) => {
        const base = i * 8;
        values.push(
          orderId,
          item.productId,
          item.productVariantId,
          item.productName,
          item.variantDescription,
          item.unitPrice,
          item.quantity,
          item.lineTotal,
        );
        return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8})`;
      })
      .join(',');

    const { rows } = await client.query<OrderItemRow>(
      `INSERT INTO order_items (
         order_id, product_id, product_variant_id, product_name,
         variant_description, unit_price, quantity, line_total
       ) VALUES ${placeholders}
       RETURNING id, order_id, product_id, product_variant_id, product_name,
                 variant_description, unit_price, quantity, line_total, created_at`,
      values,
    );
    return rows.map(toOrderItem);
  } catch (err) {
    throw toDomainError(err);
  }
}

/** Lists items for an order (order-detail views). */
export async function listByOrderId(client: pg.PoolClient, orderId: string): Promise<OrderItem[]> {
  const { rows } = await client.query<OrderItemRow>(
    `SELECT id, order_id, product_id, product_variant_id, product_name,
            variant_description, unit_price, quantity, line_total, created_at
       FROM order_items
      WHERE order_id = $1
      ORDER BY created_at ASC`,
    [orderId],
  );
  return rows.map(toOrderItem);
}

/** Total units per order, for the customer order-history rows (spec 15). */
export async function sumQuantityByOrderIds(client: pg.PoolClient, orderIds: string[]): Promise<Map<string, number>> {
  if (orderIds.length === 0) return new Map();
  const { rows } = await client.query<{ order_id: string; units: string }>(
    `SELECT order_id, sum(quantity)::text AS units FROM order_items WHERE order_id = ANY($1::uuid[]) GROUP BY order_id`,
    [orderIds],
  );
  return new Map(rows.map((r) => [r.order_id, Number(r.units)]));
}
