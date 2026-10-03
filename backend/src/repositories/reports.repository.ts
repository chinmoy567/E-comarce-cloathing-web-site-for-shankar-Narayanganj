import type pg from 'pg';
import { run, type Db } from './db.js';
import type { Granularity, StockFilter, StockSortKey, SalesSortKey, CategorySortKey } from '../validation/reports.validation.js';

/**
 * Reporting queries (spec 20). Every function is READ-ONLY: a single grouped SQL statement (no
 * per-row loops, no N+1), parameterized, with sort keys mapped through the fixed allowlists below
 * so a caller string never reaches SQL. The CSV export worker calls these same functions, so a
 * downloaded file can never disagree with the screen it came from.
 *
 * Date basis: every date-bounded figure is bucketed by `orders.created_at` on the Asia/Dhaka
 * calendar. `[from, to]` becomes `[from 00:00 Dhaka, (to + 1 day) 00:00 Dhaka)`.
 */

/** `$1`/`$2` are the ISO from/to dates. Dhaka is UTC+6 with no DST, so this is exact. */
const ORDER_IN_RANGE = `o.created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Dhaka')
  AND o.created_at < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Dhaka')`;

/** Orders still moving toward delivery: reported as pipeline value, not revenue (§5.9). */
const PIPELINE_STATUSES = `('PENDING_CONFIRMATION','COD_VERIFICATION_PENDING','CONFIRMED','PROCESSING')`;

const n = (v: unknown): number => Number(v ?? 0);

// ---- sort allowlists: key -> fixed SQL fragment -------------------------------------------------
const SALES_SORT_SQL: Record<SalesSortKey, string> = {
  unitsSold: 'units_sold',
  revenue: 'revenue',
  orderCount: 'order_count',
};
const CATEGORY_SORT_SQL: Record<CategorySortKey, string> = { revenue: 'revenue', unitsSold: 'units_sold' };
const STOCK_SORT_SQL: Record<StockSortKey, string> = { stockQuantity: 'v.stock_quantity', productName: 'p.name' };
const dir = (order: 'asc' | 'desc'): 'ASC' | 'DESC' => (order === 'asc' ? 'ASC' : 'DESC');

export type Range = { from: string; to: string };
export type PageArgs = { page: number; pageSize: number };

// ---- Sales ---------------------------------------------------------------------------------------

export type SalesSummaryRow = {
  deliveredRevenue: number;
  pipelineValue: number;
  cancelledValue: number;
  ordersDelivered: number;
  totalDiscountGiven: number;
  totalShipping: number;
};

export async function salesSummary(range: Range, db?: Db): Promise<SalesSummaryRow> {
  return run(db, async (c) => {
    const { rows } = await c.query(
      `SELECT
         COALESCE(sum(o.total_amount) FILTER (WHERE o.order_status = 'DELIVERED'), 0)::text AS delivered_revenue,
         COALESCE(sum(o.total_amount) FILTER (WHERE o.order_status IN ${PIPELINE_STATUSES}), 0)::text AS pipeline_value,
         COALESCE(sum(o.total_amount) FILTER (WHERE o.order_status = 'CANCELLED'), 0)::text AS cancelled_value,
         count(*) FILTER (WHERE o.order_status = 'DELIVERED')::text AS orders_delivered,
         COALESCE(sum(COALESCE(o.discount_amount, 0)) FILTER (WHERE o.order_status NOT IN ('CANCELLED','RETURNED')), 0)::text AS total_discount,
         COALESCE(sum(o.shipping_amount) FILTER (WHERE o.order_status NOT IN ('CANCELLED','RETURNED')), 0)::text AS total_shipping
       FROM orders o WHERE ${ORDER_IN_RANGE}`,
      [range.from, range.to],
    );
    const r = rows[0] as Record<string, string>;
    return {
      deliveredRevenue: n(r.delivered_revenue),
      pipelineValue: n(r.pipeline_value),
      cancelledValue: n(r.cancelled_value),
      ordersDelivered: n(r.orders_delivered),
      totalDiscountGiven: n(r.total_discount),
      totalShipping: n(r.total_shipping),
    };
  });
}

export type TrendPointRow = {
  day: string;
  ordersPlaced: number;
  ordersConfirmed: number;
  ordersDelivered: number;
  ordersCancelled: number;
  ordersReturned: number;
  grossSubtotal: number;
  totalDiscount: number;
  totalShipping: number;
  netRevenue: number;
  bkashOrders: number;
  codOrders: number;
  couponOrders: number;
};

/** Trend reads ONLY the rollup. `refreshedAt` is the OLDEST refresh in range so staleness shows. */
export async function salesTrend(
  range: Range,
  granularity: Granularity,
  db?: Db,
): Promise<{ points: TrendPointRow[]; refreshedAt: Date | null }> {
  return run(db, async (c) => {
    const { rows } = await c.query(
      `SELECT to_char(date_trunc($3, d.day::timestamp), 'YYYY-MM-DD') AS bucket,
              sum(d.orders_placed)::text AS orders_placed,
              sum(d.orders_confirmed)::text AS orders_confirmed,
              sum(d.orders_delivered)::text AS orders_delivered,
              sum(d.orders_cancelled)::text AS orders_cancelled,
              sum(d.orders_returned)::text AS orders_returned,
              sum(d.gross_subtotal)::text AS gross_subtotal,
              sum(d.total_discount)::text AS total_discount,
              sum(d.total_shipping)::text AS total_shipping,
              sum(d.net_revenue)::text AS net_revenue,
              sum(d.bkash_orders)::text AS bkash_orders,
              sum(d.cod_orders)::text AS cod_orders,
              sum(d.coupon_orders)::text AS coupon_orders,
              min(d.refreshed_at) AS refreshed_at
         FROM report_daily_sales d
        WHERE d.day BETWEEN $1::date AND $2::date
        GROUP BY 1 ORDER BY 1`,
      [range.from, range.to, granularity],
    );
    let refreshedAt: Date | null = null;
    const points = rows.map((r: Record<string, string | Date>) => {
      const at = r.refreshed_at as Date;
      if (!refreshedAt || at < refreshedAt) refreshedAt = at;
      return {
        day: String(r.bucket),
        ordersPlaced: n(r.orders_placed),
        ordersConfirmed: n(r.orders_confirmed),
        ordersDelivered: n(r.orders_delivered),
        ordersCancelled: n(r.orders_cancelled),
        ordersReturned: n(r.orders_returned),
        grossSubtotal: n(r.gross_subtotal),
        totalDiscount: n(r.total_discount),
        totalShipping: n(r.total_shipping),
        netRevenue: n(r.net_revenue),
        bkashOrders: n(r.bkash_orders),
        codOrders: n(r.cod_orders),
        couponOrders: n(r.coupon_orders),
      };
    });
    return { points, refreshedAt };
  });
}

export type ProductSalesRow = { productId: string; productName: string; unitsSold: number; revenue: number; orderCount: number };

/** Units/revenue per product over DELIVERED orders (line_total is pre-coupon; discounts are not allocated to lines). */
export async function salesByProduct(
  range: Range,
  sort: SalesSortKey,
  order: 'asc' | 'desc',
  page: PageArgs,
  db?: Db,
): Promise<{ rows: ProductSalesRow[]; total: number }> {
  return run(db, async (c) => {
    const from = `FROM order_items oi
       JOIN orders o ON o.id = oi.order_id AND o.order_status = 'DELIVERED'
       JOIN products p ON p.id = oi.product_id
      WHERE ${ORDER_IN_RANGE}`;
    const total = await c.query(`SELECT count(DISTINCT p.id)::text AS total ${from}`, [range.from, range.to]);
    const { rows } = await c.query(
      `SELECT p.id AS product_id, p.name AS product_name,
              sum(oi.quantity)::text AS units_sold,
              sum(oi.line_total)::text AS revenue,
              count(DISTINCT oi.order_id)::text AS order_count
         ${from}
        GROUP BY p.id, p.name
        ORDER BY ${SALES_SORT_SQL[sort]} ${dir(order)}, p.name ASC, p.id ASC
        LIMIT $3 OFFSET $4`,
      [range.from, range.to, page.pageSize, (page.page - 1) * page.pageSize],
    );
    return {
      total: n(total.rows[0].total),
      rows: rows.map((r: Record<string, string>) => ({
        productId: r.product_id as string,
        productName: r.product_name as string,
        unitsSold: n(r.units_sold),
        revenue: n(r.revenue),
        orderCount: n(r.order_count),
      })),
    };
  });
}

export type CategorySalesRow = { categoryId: string; categoryName: string; unitsSold: number; revenue: number };

export async function salesByCategory(
  range: Range,
  sort: CategorySortKey,
  order: 'asc' | 'desc',
  page: PageArgs,
  db?: Db,
): Promise<{ rows: CategorySalesRow[]; total: number }> {
  return run(db, async (c) => {
    const from = `FROM order_items oi
       JOIN orders o ON o.id = oi.order_id AND o.order_status = 'DELIVERED'
       JOIN products p ON p.id = oi.product_id
       JOIN categories cat ON cat.id = p.category_id
      WHERE ${ORDER_IN_RANGE}`;
    const total = await c.query(`SELECT count(DISTINCT cat.id)::text AS total ${from}`, [range.from, range.to]);
    const { rows } = await c.query(
      `SELECT cat.id AS category_id, cat.name AS category_name,
              sum(oi.quantity)::text AS units_sold, sum(oi.line_total)::text AS revenue
         ${from}
        GROUP BY cat.id, cat.name
        ORDER BY ${CATEGORY_SORT_SQL[sort]} ${dir(order)}, cat.name ASC, cat.id ASC
        LIMIT $3 OFFSET $4`,
      [range.from, range.to, page.pageSize, (page.page - 1) * page.pageSize],
    );
    return {
      total: n(total.rows[0].total),
      rows: rows.map((r: Record<string, string>) => ({
        categoryId: r.category_id as string,
        categoryName: r.category_name as string,
        unitsSold: n(r.units_sold),
        revenue: n(r.revenue),
      })),
    };
  });
}

// ---- Orders / payments ---------------------------------------------------------------------------

export async function ordersSummary(
  range: Range,
  db?: Db,
): Promise<{ byStatus: Record<string, number>; failedShipments: number; byPaymentMethod: Record<string, number> }> {
  return run(db, async (c) => {
    const status = await c.query(
      `SELECT o.order_status::text AS k, count(*)::text AS v FROM orders o WHERE ${ORDER_IN_RANGE} GROUP BY 1`,
      [range.from, range.to],
    );
    const method = await c.query(
      `SELECT o.payment_method::text AS k, count(*)::text AS v FROM orders o WHERE ${ORDER_IN_RANGE} GROUP BY 1`,
      [range.from, range.to],
    );
    const failed = await c.query(
      `SELECT count(*)::text AS v
         FROM shipments sh JOIN orders o ON o.id = sh.order_id
        WHERE ${ORDER_IN_RANGE} AND sh.shipment_status IN ('CREATION_FAILED','DELIVERY_FAILED')`,
      [range.from, range.to],
    );
    const toMap = (rows: Array<{ k: string; v: string }>) => Object.fromEntries(rows.map((r) => [r.k, n(r.v)]));
    return { byStatus: toMap(status.rows), byPaymentMethod: toMap(method.rows), failedShipments: n(failed.rows[0].v) };
  });
}

export type PaymentsSummaryRow = {
  bkashOrders: number;
  codOrders: number;
  bkashPendingVerification: number;
  bkashVerified: number;
  bkashRejected: number;
  codPendingCollection: number;
  codCollected: number;
  codCollectionDiscrepancies: number;
};

export async function paymentsSummary(range: Range, db?: Db): Promise<PaymentsSummaryRow> {
  return run(db, async (c) => {
    const { rows } = await c.query(
      `SELECT
         count(*) FILTER (WHERE o.payment_method = 'BKASH')::text AS bkash_orders,
         count(*) FILTER (WHERE o.payment_method = 'COD')::text AS cod_orders,
         count(*) FILTER (WHERE o.payment_method = 'BKASH' AND o.payment_status = 'PENDING_VERIFICATION')::text AS bkash_pending,
         count(*) FILTER (WHERE o.payment_method = 'BKASH' AND o.payment_status = 'PAID_VERIFIED')::text AS bkash_verified,
         count(*) FILTER (WHERE o.payment_method = 'BKASH' AND o.payment_status = 'REJECTED')::text AS bkash_rejected,
         count(*) FILTER (WHERE o.payment_method = 'COD' AND o.payment_status = 'PENDING_COLLECTION')::text AS cod_pending,
         count(*) FILTER (WHERE o.payment_method = 'COD' AND o.payment_status = 'PAID_COLLECTED')::text AS cod_collected,
         count(*) FILTER (WHERE o.payment_method = 'COD' AND o.order_status = 'DELIVERED'
                            AND o.payment_status = 'PENDING_COLLECTION')::text AS cod_discrepancy
       FROM orders o WHERE ${ORDER_IN_RANGE}`,
      [range.from, range.to],
    );
    const r = rows[0] as Record<string, string>;
    return {
      bkashOrders: n(r.bkash_orders),
      codOrders: n(r.cod_orders),
      bkashPendingVerification: n(r.bkash_pending),
      bkashVerified: n(r.bkash_verified),
      bkashRejected: n(r.bkash_rejected),
      codPendingCollection: n(r.cod_pending),
      codCollected: n(r.cod_collected),
      codCollectionDiscrepancies: n(r.cod_discrepancy),
    };
  });
}

// ---- Stock ---------------------------------------------------------------------------------------

export type StockRow = {
  productId: string;
  productName: string;
  variantId: string;
  variantLabel: string;
  sku: string | null;
  stockQuantity: number;
  lowStockThreshold: number | null;
  stockState: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';
};

/**
 * Out-of-stock and low-stock are DERIVED from stock_quantity and the variant's own threshold,
 * never stored (§5.1). `low_stock` means in stock but at/below threshold; zero is `out_of_stock`.
 */
export async function productsStock(
  filter: StockFilter,
  sort: StockSortKey,
  order: 'asc' | 'desc',
  page: PageArgs,
  db?: Db,
): Promise<{ rows: StockRow[]; total: number }> {
  const where =
    filter === 'out_of_stock'
      ? 'WHERE v.stock_quantity = 0'
      : filter === 'low_stock'
        ? 'WHERE v.stock_quantity > 0 AND v.stock_quantity <= v.low_stock_threshold'
        : '';
  return run(db, async (c) => {
    const total = await c.query(`SELECT count(*)::text AS total FROM product_variants v ${where}`);
    const { rows } = await c.query(
      `SELECT v.id AS variant_id, v.product_id, p.name AS product_name, v.sku, v.stock_quantity, v.low_stock_threshold,
              COALESCE((SELECT string_agg(av.value, ' / ' ORDER BY pa.display_order, av.display_order, av.value)
                          FROM product_variant_values vv
                          JOIN product_attribute_values av ON av.id = vv.attribute_value_id
                          JOIN product_attributes pa ON pa.id = av.attribute_id
                         WHERE vv.variant_id = v.id), 'Default') AS variant_label,
              CASE WHEN v.stock_quantity = 0 THEN 'OUT_OF_STOCK'
                   WHEN v.stock_quantity <= v.low_stock_threshold THEN 'LOW_STOCK'
                   ELSE 'IN_STOCK' END AS stock_state
         FROM product_variants v JOIN products p ON p.id = v.product_id
         ${where}
        ORDER BY ${STOCK_SORT_SQL[sort]} ${dir(order)}, p.name ASC, v.id ASC
        LIMIT $1 OFFSET $2`,
      [page.pageSize, (page.page - 1) * page.pageSize],
    );
    return {
      total: n(total.rows[0].total),
      rows: rows.map((r: Record<string, string | number | null>) => ({
        productId: String(r.product_id),
        productName: String(r.product_name),
        variantId: String(r.variant_id),
        variantLabel: String(r.variant_label),
        sku: (r.sku as string | null) ?? null,
        stockQuantity: n(r.stock_quantity),
        lowStockThreshold: r.low_stock_threshold === null ? null : n(r.low_stock_threshold),
        stockState: r.stock_state as StockRow['stockState'],
      })),
    };
  });
}

// ---- Customers -----------------------------------------------------------------------------------

export type CustomersSummaryRow = {
  totalCustomers: number;
  registeredCustomers: number;
  guestReferences: number;
  newCustomersInRange: number;
  returningCustomers: number;
  ordersByRegistered: number;
  ordersByGuest: number;
  averageOrdersPerCustomer: number;
};

/** Counts over `customers` rows, so a guest who later claimed an account is counted once (§2.9.8). No personal data. */
export async function customersSummary(range: Range, db?: Db): Promise<CustomersSummaryRow> {
  return run(db, async (c) => {
    const base = await c.query(
      `SELECT
         count(*)::text AS total,
         count(*) FILTER (WHERE account_type = 'REGISTERED')::text AS registered,
         count(*) FILTER (WHERE account_type = 'GUEST')::text AS guests,
         count(*) FILTER (WHERE created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Dhaka')
                            AND created_at < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Dhaka'))::text AS new_in_range
       FROM customers`,
      [range.from, range.to],
    );
    const orders = await c.query(
      `SELECT
         count(*) FILTER (WHERE cu.account_type = 'REGISTERED')::text AS by_registered,
         count(*) FILTER (WHERE cu.account_type = 'GUEST')::text AS by_guest,
         count(DISTINCT o.customer_id)::text AS distinct_customers
       FROM orders o JOIN customers cu ON cu.id = o.customer_id
      WHERE ${ORDER_IN_RANGE}`,
      [range.from, range.to],
    );
    const returning = await c.query(
      `SELECT count(*)::text AS v FROM (SELECT customer_id FROM orders GROUP BY customer_id HAVING count(*) >= 2) t`,
    );
    const b = base.rows[0] as Record<string, string>;
    const o = orders.rows[0] as Record<string, string>;
    const orderTotal = n(o.by_registered) + n(o.by_guest);
    const distinct = n(o.distinct_customers);
    return {
      totalCustomers: n(b.total),
      registeredCustomers: n(b.registered),
      guestReferences: n(b.guests),
      newCustomersInRange: n(b.new_in_range),
      returningCustomers: n(returning.rows[0].v),
      ordersByRegistered: n(o.by_registered),
      ordersByGuest: n(o.by_guest),
      averageOrdersPerCustomer: distinct === 0 ? 0 : Math.round((orderTotal / distinct) * 100) / 100,
    };
  });
}

// ---- Shipments -----------------------------------------------------------------------------------

export type CourierStatsRow = {
  courierCode: string;
  courierName: string;
  total: number;
  delivered: number;
  failedDelivery: number;
  returned: number;
  creationFailed: number;
};

/** Courier rows come from the `couriers` registry (LEFT JOIN), so a newly added courier appears with no code change (§4.9). */
export async function shipmentsSummary(
  range: Range,
  db?: Db,
): Promise<{ byCourier: CourierStatsRow[]; byStatus: Record<string, number> }> {
  return run(db, async (c) => {
    const couriers = await c.query(
      `SELECT cr.code, cr.name,
              count(sh.id)::text AS total,
              count(sh.id) FILTER (WHERE sh.shipment_status = 'DELIVERED')::text AS delivered,
              count(sh.id) FILTER (WHERE sh.shipment_status = 'DELIVERY_FAILED')::text AS failed_delivery,
              count(sh.id) FILTER (WHERE sh.shipment_status = 'RETURNED')::text AS returned,
              count(sh.id) FILTER (WHERE sh.shipment_status = 'CREATION_FAILED')::text AS creation_failed
         FROM couriers cr
         LEFT JOIN (SELECT s.id, s.courier, s.shipment_status
                      FROM shipments s JOIN orders o ON o.id = s.order_id
                     WHERE ${ORDER_IN_RANGE}) sh ON sh.courier = cr.code
        GROUP BY cr.code, cr.name, cr.display_order
        ORDER BY cr.display_order, cr.code`,
      [range.from, range.to],
    );
    const statuses = await c.query(
      `SELECT s.shipment_status::text AS k, count(*)::text AS v
         FROM shipments s JOIN orders o ON o.id = s.order_id
        WHERE ${ORDER_IN_RANGE} GROUP BY 1`,
      [range.from, range.to],
    );
    return {
      byCourier: couriers.rows.map((r: Record<string, string>) => ({
        courierCode: r.code as string,
        courierName: r.name as string,
        total: n(r.total),
        delivered: n(r.delivered),
        failedDelivery: n(r.failed_delivery),
        returned: n(r.returned),
        creationFailed: n(r.creation_failed),
      })),
      byStatus: Object.fromEntries(statuses.rows.map((r: { k: string; v: string }) => [r.k, n(r.v)])),
    };
  });
}

// ---- Coupons -------------------------------------------------------------------------------------

export type TopCouponRow = {
  couponId: string;
  code: string;
  usageCount: number;
  usageLimit: number | null;
  totalDiscount: number;
  distinctCustomers: number;
};

/**
 * Aggregates only: `distinctCustomers` is a count, never an identity (§8.30, §5.7). `usageCount` counts every
 * usage (it is what consumes the coupon's limit); `totalDiscount` excludes cancelled/returned orders so the
 * per-coupon figures add up to `totalDiscountGiven`.
 */
export async function couponsSummary(
  range: Range,
  topLimit: number,
  db?: Db,
): Promise<{ totalDiscountGiven: number; ordersWithCoupon: number; ordersWithoutCoupon: number; topCoupons: TopCouponRow[] }> {
  return run(db, async (c) => {
    const totals = await c.query(
      `SELECT
         COALESCE(sum(COALESCE(o.discount_amount, 0)) FILTER (WHERE o.coupon_id IS NOT NULL AND o.order_status NOT IN ('CANCELLED','RETURNED')), 0)::text AS discount,
         count(*) FILTER (WHERE o.coupon_id IS NOT NULL)::text AS with_coupon,
         count(*) FILTER (WHERE o.coupon_id IS NULL)::text AS without_coupon
       FROM orders o WHERE ${ORDER_IN_RANGE}`,
      [range.from, range.to],
    );
    const top = await c.query(
      `SELECT cp.id AS coupon_id, cp.code, cp.usage_limit,
              count(cu.id)::text AS usage_count,
              COALESCE(sum(cu.discount_amount) FILTER (WHERE o.order_status NOT IN ('CANCELLED','RETURNED')), 0)::text AS total_discount,
              count(DISTINCT cu.customer_id)::text AS distinct_customers
         FROM coupon_usages cu
         JOIN coupons cp ON cp.id = cu.coupon_id
         JOIN orders o ON o.id = cu.order_id
        WHERE ${ORDER_IN_RANGE}
        GROUP BY cp.id, cp.code, cp.usage_limit
        ORDER BY count(cu.id) DESC, cp.code ASC
        LIMIT $3`,
      [range.from, range.to, topLimit],
    );
    const t = totals.rows[0] as Record<string, string>;
    return {
      totalDiscountGiven: n(t.discount),
      ordersWithCoupon: n(t.with_coupon),
      ordersWithoutCoupon: n(t.without_coupon),
      topCoupons: top.rows.map((r: Record<string, string | number | null>) => ({
        couponId: String(r.coupon_id),
        code: String(r.code),
        usageCount: n(r.usage_count),
        usageLimit: r.usage_limit === null ? null : n(r.usage_limit),
        totalDiscount: n(r.total_discount),
        distinctCustomers: n(r.distinct_customers),
      })),
    };
  });
}

// ---- Rollup refresh (the only write in this slice; touches report_daily_sales only) --------------

export type Queryable = Pick<pg.PoolClient, 'query'>;

/**
 * Recomputes each Dhaka day in [from, to] from `orders` — recomputed, never incremented, so a re-run
 * is idempotent and a late cancellation is picked up on the next refresh. Days with no orders get a
 * zero row so the trend has no holes.
 */
export async function refreshDailySales(range: Range, client: Queryable): Promise<number> {
  const { rowCount } = await client.query(
    `INSERT INTO report_daily_sales AS r
       (day, orders_placed, orders_confirmed, orders_delivered, orders_cancelled, orders_returned,
        gross_subtotal, total_discount, total_shipping, net_revenue, bkash_orders, cod_orders, coupon_orders, refreshed_at)
     SELECT d.day,
            count(o.id),
            count(o.id) FILTER (WHERE o.order_status = 'CONFIRMED'),
            count(o.id) FILTER (WHERE o.order_status = 'DELIVERED'),
            count(o.id) FILTER (WHERE o.order_status = 'CANCELLED'),
            count(o.id) FILTER (WHERE o.order_status = 'RETURNED'),
            COALESCE(sum(o.subtotal) FILTER (WHERE o.order_status NOT IN ('CANCELLED','RETURNED')), 0),
            COALESCE(sum(COALESCE(o.discount_amount, 0)) FILTER (WHERE o.order_status NOT IN ('CANCELLED','RETURNED')), 0),
            COALESCE(sum(o.shipping_amount) FILTER (WHERE o.order_status NOT IN ('CANCELLED','RETURNED')), 0),
            COALESCE(sum(o.total_amount) FILTER (WHERE o.order_status = 'DELIVERED'), 0),
            count(o.id) FILTER (WHERE o.payment_method = 'BKASH'),
            count(o.id) FILTER (WHERE o.payment_method = 'COD'),
            count(o.id) FILTER (WHERE o.coupon_id IS NOT NULL),
            now()
       FROM (SELECT ($1::date + g.i) AS day FROM generate_series(0, ($2::date - $1::date)) AS g(i)) d
       LEFT JOIN orders o
         ON o.created_at >= (d.day::timestamp AT TIME ZONE 'Asia/Dhaka')
        AND o.created_at < ((d.day + 1)::timestamp AT TIME ZONE 'Asia/Dhaka')
      GROUP BY d.day
     ON CONFLICT (day) DO UPDATE SET
       orders_placed = EXCLUDED.orders_placed, orders_confirmed = EXCLUDED.orders_confirmed,
       orders_delivered = EXCLUDED.orders_delivered, orders_cancelled = EXCLUDED.orders_cancelled,
       orders_returned = EXCLUDED.orders_returned, gross_subtotal = EXCLUDED.gross_subtotal,
       total_discount = EXCLUDED.total_discount, total_shipping = EXCLUDED.total_shipping,
       net_revenue = EXCLUDED.net_revenue, bkash_orders = EXCLUDED.bkash_orders,
       cod_orders = EXCLUDED.cod_orders, coupon_orders = EXCLUDED.coupon_orders, refreshed_at = now()`,
    [range.from, range.to],
  );
  return rowCount ?? 0;
}

// ---- Exports (report_exports is operational queue state, not business data) ---------------------

export type ExportRow = {
  id: string;
  requestedBy: string;
  report: string;
  rangeFrom: string;
  rangeTo: string;
  status: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';
  storagePath: string | null;
  errorMessage: string | null;
};

const EXPORT_COLS = `id, requested_by, report, to_char(range_from,'YYYY-MM-DD') AS range_from,
  to_char(range_to,'YYYY-MM-DD') AS range_to, status, storage_path, error_message`;

function mapExport(r: Record<string, string | null>): ExportRow {
  return {
    id: r.id as string,
    requestedBy: r.requested_by as string,
    report: r.report as string,
    rangeFrom: r.range_from as string,
    rangeTo: r.range_to as string,
    status: r.status as ExportRow['status'],
    storagePath: r.storage_path ?? null,
    errorMessage: r.error_message ?? null,
  };
}

export async function insertExport(
  input: { requestedBy: string; report: string; from: string; to: string },
  db?: Db,
): Promise<ExportRow> {
  return run(db, async (c) => {
    const { rows } = await c.query(
      `INSERT INTO report_exports (requested_by, report, range_from, range_to)
       VALUES ($1, $2, $3::date, $4::date) RETURNING ${EXPORT_COLS}`,
      [input.requestedBy, input.report, input.from, input.to],
    );
    return mapExport(rows[0]);
  });
}

/** Owner-scoped: another admin's id returns null (the route answers 404, never leaking existence). */
export async function findExportForOwner(id: string, ownerId: string, db?: Db): Promise<ExportRow | null> {
  return run(db, async (c) => {
    const { rows } = await c.query(`SELECT ${EXPORT_COLS} FROM report_exports WHERE id = $1 AND requested_by = $2`, [id, ownerId]);
    return rows[0] ? mapExport(rows[0]) : null;
  });
}

/** Atomically claims the oldest PENDING export (SKIP LOCKED: concurrent workers never take the same job). */
export async function claimNextExport(db?: Db): Promise<ExportRow | null> {
  return run(db, async (c) => {
    const { rows } = await c.query(
      `UPDATE report_exports SET status = 'PROCESSING', started_at = now()
        WHERE id = (SELECT id FROM report_exports WHERE status = 'PENDING' ORDER BY created_at
                     FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING ${EXPORT_COLS}`,
    );
    return rows[0] ? mapExport(rows[0]) : null;
  });
}

export async function markExportReady(id: string, storagePath: string, db?: Db): Promise<void> {
  await run(db, (c) =>
    c.query(`UPDATE report_exports SET status = 'READY', storage_path = $2, completed_at = now(), error_message = NULL WHERE id = $1`, [id, storagePath]),
  );
}

export async function markExportFailed(id: string, message: string, db?: Db): Promise<void> {
  await run(db, (c) =>
    c.query(`UPDATE report_exports SET status = 'FAILED', error_message = $2, completed_at = now() WHERE id = $1`, [id, message.slice(0, 500)]),
  );
}
