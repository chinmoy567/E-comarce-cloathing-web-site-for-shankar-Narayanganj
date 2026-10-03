import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.ts';
import { applyTestEnv } from '../helpers/testEnv.ts';
import { resetEnvCache } from '../../src/config/env.ts';
import { loginAsAdmin } from '../helpers/adminSession.ts';

/**
 * Analytics and business reports (implementation spec 20, 05-admin §5.9, 06-rbac §5.18,
 * 11-security-hardening §11.4). Real HTTP, real middleware, real schema. Covers the figures that inform
 * business decisions (revenue recognition, discounted totals, enum buckets, derived stock, customer
 * composition, registry-driven couriers, coupon aggregates), the analytics.view permission matrix,
 * bounded ranges / pagination / sort allowlists, the no-PII key-set, no writes, the rollup, and the
 * asynchronous export.
 *
 * Fixture (all in the report range 2026-06-02..2026-06-30, Asia/Dhaka):
 *   O1 DELIVERED  COD   PAID_COLLECTED       1000 (coupon, discount 100, shipping 60)  reg
 *   O2 DELIVERED  BKASH PAID_VERIFIED        2000                                      guest1
 *   O3 PENDING_CONFIRMATION BKASH PENDING_VERIFICATION 500                              guest2
 *   O4 CONFIRMED  COD   PENDING_COLLECTION    300                                      reg
 *   O5 PROCESSING COD   PENDING_COLLECTION    200                                      guest1
 *   O6 CANCELLED  BKASH REJECTED              700                                      reg
 *   O7 RETURNED   COD   PENDING_COLLECTION    400                                      guest2
 *   O8 DELIVERED  COD   PENDING_COLLECTION    600 (collection discrepancy)             guest1
 *   O9 COD_VERIFICATION_PENDING COD PENDING_COLLECTION 150                             reg
 * Outside the range: O10 DELIVERED 9999 on 31 May Dhaka; O11 DELIVERED 50 on 1 Jun Dhaka (both guest2).
 */
const SCHEMA = 'spec20_reports';
const PW = 'ReportsApiPass12';
const RANGE = 'from=2026-06-02&to=2026-06-30';

const fakeStorage = vi.hoisted(() => ({ files: new Map<string, string>(), failNext: false }));
vi.mock('../../src/services/storage/reportExports.service.js', () => ({
  uploadExportCsv: async (path: string, csv: string) => {
    if (fakeStorage.failNext) {
      fakeStorage.failNext = false;
      throw new Error('bucket down');
    }
    fakeStorage.files.set(path, csv);
  },
  signExportUrl: async (path: string) => ({
    url: `https://signed.example/${path}?token=abc`,
    expiresAt: new Date(Date.now() + 300_000),
  }),
  resetExportBucketCache: () => undefined,
}));

describe.skipIf(!TEST_DATABASE_URL)('analytics and business reports (spec 20)', () => {
  let app: Express;
  let q: <T = any>(sql: string, params?: unknown[]) => Promise<T[]>;
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;
  let permissionsRepository: typeof import('../../src/repositories/permissions.repository.js');
  let adminId: string;
  let managerId: string;
  let ids: Record<string, string> = {};
  let orderIds: Record<string, string> = {};

  async function order(
    key: string,
    o: {
      customer: string;
      method: 'BKASH' | 'COD';
      status: string;
      pay: string;
      total: number;
      at: string;
      subtotal?: number;
      shipping?: number;
      discount?: number | null;
      couponId?: string | null;
      product?: string;
      qty?: number;
      line?: number;
    },
  ): Promise<void> {
    const [r] = await q<{ id: string }>(
      `INSERT INTO orders (order_number, customer_id, payment_method, order_status, payment_status, subtotal, shipping_amount,
                           discount_amount, coupon_id, total_amount, full_name, phone_number, detailed_address, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Order Tester','01711111111','House 1',$11::timestamptz) RETURNING id`,
      [key, o.customer, o.method, o.status, o.pay, o.subtotal ?? o.total, o.shipping ?? 0, o.discount ?? null, o.couponId ?? null, o.total, o.at],
    );
    orderIds[key] = r!.id;
    await q(
      `INSERT INTO order_items (order_id, product_id, product_variant_id, product_name, unit_price, quantity, line_total)
       VALUES ($1,$2,$3,'Item',$4,$5,$6)`,
      [r!.id, ids[o.product ?? 'productA'], ids[o.product === 'productB' ? 'variantB' : 'variantA'], 100, o.qty ?? 1, o.line ?? o.total],
    );
  }

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    applyTestEnv();
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    process.env.RL_REPORT_EXPORT_MAX = '1000';
    resetEnvCache();

    const tx = await import('../../src/lib/transaction.js');
    resetTransactionPool = tx.resetTransactionPool;
    await tx.resetTransactionPool();
    q = (sql, params) => tx.withTransaction(async (c) => (await c.query(sql, params as any[])).rows);

    const { hashPassword } = await import('../../src/lib/password.js');
    const users = await import('../../src/repositories/users.repository.js');
    permissionsRepository = await import('../../src/repositories/permissions.repository.js');
    const passwordHash = await hashPassword(PW);
    adminId = (await users.create({ role: 'ADMIN', userIdentifier: 'r-admin', passwordHash, mustChangePassword: false })).id;
    await users.create({ role: 'ADMIN', userIdentifier: 'r-admin2', passwordHash, mustChangePassword: false });
    managerId = (await users.create({ role: 'MANAGER', userIdentifier: 'r-mgr', passwordHash, mustChangePassword: false })).id;

    const { createApp } = await import('../../src/app.js');
    app = createApp();

    const cust = async (type: string, name: string, phone: string, createdAt: string) =>
      (
        await q<{ id: string }>(
          `INSERT INTO customers (account_type, full_name, phone_number, division, district, area_unit_type, area_unit_name, ward_unit_type, ward_unit_name, detailed_address, created_at)
           VALUES ($1,$2,$3,'Dhaka','Dhaka','THANA','Dhanmondi','WARD','Ward 1','House 1', $4::timestamptz) RETURNING id`,
          [type, name, phone, createdAt],
        )
      )[0]!.id;
    ids.reg = await cust('REGISTERED', 'Reg Customer', '01711000001', '2026-06-05T10:00:00Z');
    ids.guest1 = await cust('GUEST', 'Guest One', '01711000002', '2026-06-06T10:00:00Z');
    ids.guest2 = await cust('GUEST', 'Guest Two', '01711000003', '2026-05-20T10:00:00Z');

    const cat = async (name: string, slug: string) =>
      (await q<{ id: string }>(`INSERT INTO categories (name, slug, status) VALUES ($1,$2,'ACTIVE') RETURNING id`, [name, slug]))[0]!.id;
    ids.catA = await cat('Shirts', 'shirts');
    ids.catB = await cat('Pants', 'pants');
    const prod = async (name: string, slug: string, category: string) =>
      (await q<{ id: string }>(`INSERT INTO products (category_id, name, slug, base_price, status) VALUES ($1,$2,$3,100,'ACTIVE') RETURNING id`, [category, name, slug]))[0]!.id;
    ids.productA = await prod('Shirt A', 'shirt-a', ids.catA!);
    ids.productB = await prod('Pant B', 'pant-b', ids.catB!);
    const variant = async (product: string, sku: string, stock: number, threshold: number) =>
      (
        await q<{ id: string }>(
          `INSERT INTO product_variants (product_id, sku, price, stock_quantity, low_stock_threshold, is_active) VALUES ($1,$2,100,$3,$4,true) RETURNING id`,
          [product, sku, stock, threshold],
        )
      )[0]!.id;
    ids.variantA = await variant(ids.productA!, 'A-OUT', 0, 5); // OUT_OF_STOCK
    ids.variantB = await variant(ids.productB!, 'B-LOW', 3, 5); // LOW_STOCK (3 <= 5)
    ids.variantC = await variant(ids.productA!, 'A-OK', 3, 2); // IN_STOCK: same stock as B but its own threshold is 2
    ids.variantD = await variant(ids.productB!, 'B-PLENTY', 100, 5); // IN_STOCK

    ids.coupon = (
      await q<{ id: string }>(
        `INSERT INTO coupons (code, name, discount_type, discount_value, starts_at, expires_at, usage_limit, usage_count, status)
         VALUES ('SAVE100','Save 100','FIXED_AMOUNT',100,'2026-01-01T00:00:00Z','2027-01-01T00:00:00Z',100,1,'ACTIVE') RETURNING id`,
      )
    )[0]!.id;

    const at = (d: number) => `2026-06-${String(d).padStart(2, '0')}T10:00:00Z`;
    await order('O1', { customer: ids.reg!, method: 'COD', status: 'DELIVERED', pay: 'PAID_COLLECTED', total: 1000, subtotal: 1040, shipping: 60, discount: 100, couponId: ids.coupon!, at: at(10), qty: 2, line: 1100 });
    await order('O2', { customer: ids.guest1!, method: 'BKASH', status: 'DELIVERED', pay: 'PAID_VERIFIED', total: 2000, at: at(11), product: 'productB', qty: 1, line: 2000 });
    await order('O3', { customer: ids.guest2!, method: 'BKASH', status: 'PENDING_CONFIRMATION', pay: 'PENDING_VERIFICATION', total: 500, at: at(12), qty: 5 });
    await order('O4', { customer: ids.reg!, method: 'COD', status: 'CONFIRMED', pay: 'PENDING_COLLECTION', total: 300, at: at(13) });
    await order('O5', { customer: ids.guest1!, method: 'COD', status: 'PROCESSING', pay: 'PENDING_COLLECTION', total: 200, at: at(14) });
    await order('O6', { customer: ids.reg!, method: 'BKASH', status: 'CANCELLED', pay: 'REJECTED', total: 700, at: at(15) });
    await order('O7', { customer: ids.guest2!, method: 'COD', status: 'RETURNED', pay: 'PENDING_COLLECTION', total: 400, at: at(16) });
    await order('O8', { customer: ids.guest1!, method: 'COD', status: 'DELIVERED', pay: 'PENDING_COLLECTION', total: 600, at: at(17), qty: 1, line: 600 });
    await order('O9', { customer: ids.reg!, method: 'COD', status: 'COD_VERIFICATION_PENDING', pay: 'PENDING_COLLECTION', total: 150, at: at(18) });
    await order('O10', { customer: ids.guest2!, method: 'COD', status: 'DELIVERED', pay: 'PAID_COLLECTED', total: 9999, at: '2026-05-31T17:30:00Z' });
    await order('O11', { customer: ids.guest2!, method: 'COD', status: 'DELIVERED', pay: 'PAID_COLLECTED', total: 50, at: '2026-05-31T18:30:00Z' });

    await q(`INSERT INTO coupon_usages (coupon_id, order_id, customer_id, discount_amount) VALUES ($1,$2,$3,100)`, [ids.coupon, orderIds.O1, ids.reg]);
    await q(`INSERT INTO couriers (code, name, adapter_key, display_order) VALUES ('TESTEX','Test Express','testex',9)`);
    const ship = (o: string, status: string, courier: string) =>
      q(`INSERT INTO shipments (order_id, shipment_status, courier) VALUES ($1,$2,$3)`, [orderIds[o], status, courier]);
    await ship('O1', 'DELIVERED', 'PATHAO');
    await ship('O7', 'RETURNED', 'PATHAO');
    await ship('O8', 'DELIVERY_FAILED', 'STEADFAST');
    await ship('O5', 'CREATION_FAILED', 'STEADFAST');
  }, 120_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  const admin = () => loginAsAdmin(app, 'r-admin', PW);
  const manager = () => loginAsAdmin(app, 'r-mgr', PW);
  const get = async (path: string) => (await admin()).agent.get(`/api/admin/reports${path}`);

  describe('sales and revenue recognition (§5.9)', () => {
    it('reports delivered revenue, pipeline, cancelled, AOV, discount and shipping separately', async () => {
      const res = await get(`/sales/summary?${RANGE}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        deliveredRevenue: 3600, // O1 (discounted 1000) + O2 + O8; never the 1040 subtotal
        pipelineValue: 1150, // O3 + O4 + O5 + O9
        cancelledValue: 700, // O6 only: RETURNED (O7) is in none of the three
        ordersDelivered: 3,
        averageOrderValue: 1200,
        totalDiscountGiven: 100,
        totalShipping: 60,
        range: { from: '2026-06-02', to: '2026-06-30' },
      });
      expect(res.body.data.meta).toMatchObject({ revenueRecognition: 'ORDER_STATUS_DELIVERED', rollupRefreshedAt: null });
      expect(typeof res.body.data.meta.computedAt).toBe('string');
    });

    it.each([
      ['PENDING_CONFIRMATION', 'pipeline'],
      ['COD_VERIFICATION_PENDING', 'pipeline'],
      ['CONFIRMED', 'pipeline'],
      ['PROCESSING', 'pipeline'],
      ['DELIVERED', 'revenue'],
      ['CANCELLED', 'cancelled'],
      ['RETURNED', 'none'],
    ])('a %s order lands in the "%s" bucket only', async (status, bucket) => {
      // An isolated single-day window so only this order counts.
      const day = '2026-07-01';
      const num = `ISO-${status}`;
      await q(
        `INSERT INTO orders (order_number, customer_id, payment_method, order_status, payment_status, subtotal, total_amount, created_at)
         VALUES ($1,$2,'COD',$3,'PENDING_COLLECTION',777,777,'2026-07-01T10:00:00Z')`,
        [num, ids.reg, status],
      );
      try {
        const d = (await get(`/sales/summary?from=${day}&to=${day}`)).body.data;
        expect([d.deliveredRevenue, d.pipelineValue, d.cancelledValue]).toEqual([
          bucket === 'revenue' ? 777 : 0,
          bucket === 'pipeline' ? 777 : 0,
          bucket === 'cancelled' ? 777 : 0,
        ]);
      } finally {
        await q(`DELETE FROM orders WHERE order_number = $1`, [num]);
      }
    });

    it('buckets days on the Asia/Dhaka calendar, not UTC', async () => {
      // 17:30Z on 31 May is 23:30 on 31 May in Dhaka; 18:30Z is 00:30 on 1 June.
      expect((await get('/sales/summary?from=2026-05-31&to=2026-05-31')).body.data.deliveredRevenue).toBe(9999);
      expect((await get('/sales/summary?from=2026-06-01&to=2026-06-01')).body.data.deliveredRevenue).toBe(50);
    });

    it('sales-by-product counts DELIVERED orders only, is sortable and paginated', async () => {
      const res = await get(`/sales/by-product?${RANGE}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([
        { productId: ids.productA, productName: 'Shirt A', unitsSold: 3, revenue: 1700, orderCount: 2 },
        { productId: ids.productB, productName: 'Pant B', unitsSold: 1, revenue: 2000, orderCount: 1 },
      ]);
      expect(res.body.pagination).toEqual({ page: 1, pageSize: 20, total: 2, totalPages: 1 });

      const byRevenue = await get(`/sales/by-product?${RANGE}&sort=revenue&order=desc`);
      expect(byRevenue.body.data[0].productName).toBe('Pant B');

      const paged = await get(`/sales/by-product?${RANGE}&pageSize=1&page=2`);
      expect(paged.body.data).toHaveLength(1);
      expect(paged.body.pagination).toMatchObject({ page: 2, pageSize: 1, total: 2, totalPages: 2 });
    });

    it('sales-by-category groups by the product category', async () => {
      const res = await get(`/sales/by-category?${RANGE}`);
      expect(res.body.data).toEqual([
        { categoryId: ids.catB, categoryName: 'Pants', unitsSold: 1, revenue: 2000 },
        { categoryId: ids.catA, categoryName: 'Shirts', unitsSold: 3, revenue: 1700 },
      ]);
    });
  });

  describe('orders and payments (§5.9, §5.21)', () => {
    it('returns a count for every one of the seven order statuses, using the exact enum keys', async () => {
      const d = (await get(`/orders/summary?${RANGE}`)).body.data;
      expect(Object.keys(d.byStatus).sort()).toEqual(
        ['CANCELLED', 'COD_VERIFICATION_PENDING', 'CONFIRMED', 'DELIVERED', 'PENDING_CONFIRMATION', 'PROCESSING', 'RETURNED'],
      );
      expect(d.byStatus).toEqual({
        PENDING_CONFIRMATION: 1, COD_VERIFICATION_PENDING: 1, CONFIRMED: 1, PROCESSING: 1, DELIVERED: 3, CANCELLED: 1, RETURNED: 1,
      });
      expect(d.byPaymentMethod).toEqual({ BKASH: 3, COD: 6 });
      expect(d.failedShipments).toBe(2); // O8 DELIVERY_FAILED + O5 CREATION_FAILED
    });

    it('zero-fills statuses with no orders', async () => {
      const d = (await get('/orders/summary?from=2026-08-01&to=2026-08-02')).body.data;
      expect(Object.values(d.byStatus)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    });

    it('returns every payments line §5.9 lists, and derives the COD discrepancy', async () => {
      const d = (await get(`/payments/summary?${RANGE}`)).body.data;
      expect(d).toMatchObject({
        bkashOrders: 3,
        codOrders: 6,
        bkashPendingVerification: 1,
        bkashVerified: 1,
        bkashRejected: 1,
        codPendingCollection: 5,
        codCollected: 1,
        codCollectionDiscrepancies: 1, // O8: COD + DELIVERED + PENDING_COLLECTION
      });
      // The discrepancy is computed from the status pair, never read from a stored flag.
      const cols = await q(`SELECT column_name FROM information_schema.columns WHERE table_name IN ('orders','shipments') AND column_name ILIKE '%discrepan%'`);
      expect(cols).toHaveLength(0);
    });
  });

  describe('stock (§5.1: derived, never stored)', () => {
    it('lists exactly the out-of-stock variants', async () => {
      const res = await get('/products/stock?filter=out_of_stock');
      expect(res.body.data.map((r: any) => r.sku)).toEqual(['A-OUT']);
      expect(res.body.data[0]).toMatchObject({ stockQuantity: 0, stockState: 'OUT_OF_STOCK', variantLabel: 'Default' });
    });

    it('respects each variant\'s own low-stock threshold', async () => {
      const res = await get('/products/stock?filter=low_stock');
      // B-LOW: 3 <= 5. A-OK also has 3 in stock but a threshold of 2, so it is not low.
      expect(res.body.data.map((r: any) => r.sku)).toEqual(['B-LOW']);
      const all = await get('/products/stock?filter=all&sort=productName&order=asc');
      const bySku = Object.fromEntries(all.body.data.map((r: any) => [r.sku, r.stockState]));
      expect(bySku).toEqual({ 'A-OUT': 'OUT_OF_STOCK', 'B-LOW': 'LOW_STOCK', 'A-OK': 'IN_STOCK', 'B-PLENTY': 'IN_STOCK' });
    });

    it('stores no stock-state flag anywhere', async () => {
      const cols = await q(`SELECT column_name FROM information_schema.columns WHERE table_name IN ('product_variants','products') AND column_name ~* '(out_of_stock|low_stock_flag|stock_state)'`);
      expect(cols).toHaveLength(0);
    });

    it('products/performance shares the by-product figures', async () => {
      const res = await get(`/products/performance?${RANGE}`);
      expect(res.body.data[0]).toMatchObject({ productName: 'Shirt A', unitsSold: 3 });
    });
  });

  describe('customers (§5.9, §5.7)', () => {
    it('counts registered and guest references, the order share, new and returning customers', async () => {
      const d = (await get(`/customers/summary?${RANGE}`)).body.data;
      expect(d).toMatchObject({
        totalCustomers: 3,
        registeredCustomers: 1,
        guestReferences: 2,
        newCustomersInRange: 2, // reg (5 Jun) and guest1 (6 Jun); guest2 joined in May
        returningCustomers: 3, // every customer has >= 2 orders all-time
        ordersByRegistered: 4,
        ordersByGuest: 5,
      });
      expect(d.averageOrdersPerCustomer).toBe(3); // 9 orders / 3 distinct customers in range
    });

    it('counts a guest who later claimed an account once, not twice', async () => {
      await q(`UPDATE customers SET account_type='REGISTERED' WHERE id=$1`, [ids.guest2]);
      try {
        const d = (await get(`/customers/summary?${RANGE}`)).body.data;
        expect(d).toMatchObject({ totalCustomers: 3, registeredCustomers: 2, guestReferences: 1 });
      } finally {
        await q(`UPDATE customers SET account_type='GUEST' WHERE id=$1`, [ids.guest2]);
      }
    });
  });

  describe('shipments (§4.9: registry-driven)', () => {
    it('groups by courier from the registry, so a newly added courier appears with no code change', async () => {
      const d = (await get(`/shipments/summary?${RANGE}`)).body.data;
      const byCode = Object.fromEntries(d.byCourier.map((c: any) => [c.courierCode, c]));
      expect(byCode.PATHAO).toMatchObject({ total: 2, delivered: 1, returned: 1, failedDelivery: 0, deliverySuccessRatePercent: 50 });
      expect(byCode.STEADFAST).toMatchObject({ total: 2, delivered: 0, failedDelivery: 1, creationFailed: 1, deliverySuccessRatePercent: 0 });
      // TESTEX was inserted in the registry only; it has no shipments, so its rate is null (not 0%).
      expect(byCode.TESTEX).toMatchObject({ courierName: 'Test Express', total: 0, deliverySuccessRatePercent: null });
      expect(Object.keys(d.byStatus)).toHaveLength(10);
      expect(d.byStatus).toMatchObject({ DELIVERED: 1, RETURNED: 1, DELIVERY_FAILED: 1, CREATION_FAILED: 1, NOT_CREATED: 0 });
    });
  });

  describe('coupons (§5.9, §8.29-8.30)', () => {
    it('reports discount given, coupon vs non-coupon orders, and usage against the limit', async () => {
      const d = (await get(`/coupons/summary?${RANGE}`)).body.data;
      expect(d).toMatchObject({ totalDiscountGiven: 100, ordersWithCoupon: 1, ordersWithoutCoupon: 8 });
      expect(d.topCoupons).toEqual([
        { couponId: ids.coupon, code: 'SAVE100', usageCount: 1, usageLimit: 100, totalDiscount: 100, distinctCustomers: 1 },
      ]);
    });
  });

  describe('coupon figures reconcile', () => {
    it('a usage on a cancelled order still counts toward the limit but not toward discount given', async () => {
      const [o] = await q<{ id: string }>(
        `INSERT INTO orders (order_number, customer_id, payment_method, order_status, payment_status, subtotal, discount_amount, coupon_id, total_amount, created_at)
         VALUES ('CXL-COUPON',$1,'COD','CANCELLED','PENDING_COLLECTION',500,50,$2,450,'2026-06-20T10:00:00Z') RETURNING id`,
        [ids.reg, ids.coupon],
      );
      await q(`INSERT INTO coupon_usages (coupon_id, order_id, customer_id, discount_amount) VALUES ($1,$2,$3,50)`, [ids.coupon, o!.id, ids.reg]);
      try {
        const d = (await get(`/coupons/summary?${RANGE}`)).body.data;
        expect(d.totalDiscountGiven).toBe(100);
        expect(d.topCoupons[0]).toMatchObject({ usageCount: 2, totalDiscount: 100 });
        const perCouponSum = d.topCoupons.reduce((a: number, c: any) => a + c.totalDiscount, 0);
        expect(perCouponSum).toBe(d.totalDiscountGiven);
      } finally {
        await q(`DELETE FROM coupon_usages WHERE order_id=$1`, [o!.id]);
        await q(`DELETE FROM orders WHERE id=$1`, [o!.id]);
      }
    });
  });

  describe('bounded, validated queries (§11.4, §11.6)', () => {
    const REPORTS = [
      '/sales/summary', '/sales/trend', '/sales/by-product', '/sales/by-category', '/orders/summary',
      '/payments/summary', '/products/performance', '/customers/summary', '/shipments/summary', '/coupons/summary',
    ];

    it.each(REPORTS)('%s rejects a missing from/to with 400 VALIDATION_ERROR', async (path) => {
      const s = await admin();
      for (const qs of ['', '?from=2026-06-01', '?to=2026-06-30']) {
        const res = await s.agent.get(`/api/admin/reports${path}${qs}`);
        expect(res.status, `${path}${qs}`).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('rejects a range over the cap with RANGE_TOO_LARGE, and accepts exactly the cap', async () => {
      const over = await get('/sales/summary?from=2025-01-01&to=2026-06-30');
      expect(over.status).toBe(400);
      expect(over.body.error.code).toBe('RANGE_TOO_LARGE');
      // 2025-06-30..2026-06-30 inclusive is 366 days: allowed.
      expect((await get('/sales/summary?from=2025-06-30&to=2026-06-30')).status).toBe(200);
      expect((await get('/sales/summary?from=2025-06-29&to=2026-06-30')).body.error.code).toBe('RANGE_TOO_LARGE');
    });

    it('rejects from after to, malformed dates and unknown parameters', async () => {
      expect((await get('/sales/summary?from=2026-06-30&to=2026-06-01')).body.error.code).toBe('VALIDATION_ERROR');
      expect((await get('/sales/summary?from=2026-13-40&to=2026-06-01')).status).toBe(400);
      expect((await get('/sales/summary?from=June&to=2026-06-01')).status).toBe(400);
      expect((await get(`/sales/summary?${RANGE}&evil=1`)).status).toBe(400);
    });

    it('rejects an arbitrary sort field instead of reaching SQL', async () => {
      for (const path of ['/sales/by-product', '/sales/by-category', '/products/performance']) {
        for (const sort of ['name; DROP TABLE orders', 'product_name', 'password_hash']) {
          const res = await get(`${path}?${RANGE}&sort=${encodeURIComponent(sort)}`);
          expect(res.status, `${path} ${sort}`).toBe(400);
        }
      }
      expect((await get('/products/stock?sort=sku')).status).toBe(400);
      expect((await get('/products/stock?filter=everything')).status).toBe(400);
      expect(await q(`SELECT 1 FROM orders LIMIT 1`)).toHaveLength(1);
    });

    it('bounds the page size on every list-shaped report', async () => {
      for (const path of ['/sales/by-product', '/sales/by-category', '/products/performance']) {
        expect((await get(`${path}?${RANGE}&pageSize=101`)).status).toBe(400);
        expect((await get(`${path}?${RANGE}&pageSize=1`)).body.data.length).toBeLessThanOrEqual(1);
      }
      expect((await get('/products/stock?pageSize=101')).status).toBe(400);
      const stock = await get('/products/stock?pageSize=2');
      expect(stock.body.data).toHaveLength(2);
      expect(stock.body.pagination).toMatchObject({ pageSize: 2, total: 4, totalPages: 2 });
    });

    it('marks every report response no-store (financial data, signed links)', async () => {
      const res = await get(`/sales/summary?${RANGE}`);
      expect(res.headers['cache-control']).toBe('no-store');
      expect((await get('/config')).headers['cache-control']).toBe('no-store');
    });

    it('exposes the cap and timezone through /config', async () => {
      expect((await get('/config')).body.data).toEqual({ maxRangeDays: 366, timezone: 'Asia/Dhaka' });
    });
  });

  describe('analytics.view enforcement (§5.18, §5.9)', () => {
    const ALL: Array<['get' | 'post', string]> = [
      ['get', `/config`],
      ['get', `/sales/summary?${RANGE}`],
      ['get', `/sales/trend?${RANGE}`],
      ['get', `/sales/by-product?${RANGE}`],
      ['get', `/sales/by-category?${RANGE}`],
      ['get', `/orders/summary?${RANGE}`],
      ['get', `/payments/summary?${RANGE}`],
      ['get', `/products/performance?${RANGE}`],
      ['get', `/products/stock`],
      ['get', `/customers/summary?${RANGE}`],
      ['get', `/shipments/summary?${RANGE}`],
      ['get', `/coupons/summary?${RANGE}`],
      ['post', `/exports`],
      ['get', `/exports/00000000-0000-0000-0000-000000000000`],
    ];

    it('requires authentication on every report endpoint (401)', async () => {
      const { default: request } = await import('supertest');
      for (const [verb, url] of ALL) {
        expect((await (request(app) as any)[verb](`/api/admin/reports${url}`).send({})).status, url).toBe(401);
      }
    });

    it('an ungranted Manager gets 403 on every endpoint; the grant makes them 200; revoking restores 403', async () => {
      const denied = await manager();
      for (const [verb, url] of ALL) {
        const res = await (denied.agent as any)[verb](`/api/admin/reports${url}`).set('X-CSRF-Token', denied.csrfToken).send({});
        expect(res.status, `${verb} ${url}`).toBe(403);
      }

      await permissionsRepository.grant(managerId, 'analytics.view', adminId);
      try {
        const granted = await manager();
        for (const [, url] of ALL.filter(([v, u]) => v === 'get' && !u.startsWith('/exports'))) {
          expect((await granted.agent.get(`/api/admin/reports${url}`)).status, url).toBe(200);
        }
      } finally {
        await permissionsRepository.revoke(managerId, 'analytics.view');
      }
      const again = await manager();
      expect((await again.agent.get(`/api/admin/reports/sales/summary?${RANGE}`)).status).toBe(403);
    });

    it('dashboard.view stays separate: a Manager can still read the dashboard without analytics.view', async () => {
      const s = await manager();
      expect((await s.agent.get('/api/admin/dashboard/summary')).status).toBe(200);
    });
  });

  describe('no personal data in any report (§8.30, §5.7, §6.6, §2.9.6, §4.16)', () => {
    /** Every key any report may return. A new field fails this test until it is reviewed and added here. */
    const ALLOWED_KEYS = new Set([
      'data', 'pagination', 'page', 'pageSize', 'total', 'totalPages', 'meta', 'computedAt', 'rollupRefreshedAt', 'revenueRecognition',
      'range', 'from', 'to', 'granularity', 'points', 'day', 'maxRangeDays', 'timezone',
      'deliveredRevenue', 'pipelineValue', 'cancelledValue', 'ordersDelivered', 'averageOrderValue', 'totalDiscountGiven', 'totalShipping',
      'ordersPlaced', 'ordersConfirmed', 'ordersCancelled', 'ordersReturned', 'grossSubtotal', 'totalDiscount', 'netRevenue', 'bkashOrders', 'codOrders', 'couponOrders',
      'productId', 'productName', 'unitsSold', 'revenue', 'orderCount', 'categoryId', 'categoryName',
      'byStatus', 'failedShipments', 'byPaymentMethod', 'BKASH', 'COD',
      'PENDING_CONFIRMATION', 'COD_VERIFICATION_PENDING', 'CONFIRMED', 'PROCESSING', 'DELIVERED', 'CANCELLED', 'RETURNED',
      'bkashPendingVerification', 'bkashVerified', 'bkashRejected', 'codPendingCollection', 'codCollected', 'codCollectionDiscrepancies',
      'variantId', 'variantLabel', 'sku', 'stockQuantity', 'lowStockThreshold', 'stockState',
      'totalCustomers', 'registeredCustomers', 'guestReferences', 'newCustomersInRange', 'returningCustomers', 'ordersByRegistered', 'ordersByGuest', 'averageOrdersPerCustomer',
      'byCourier', 'courierCode', 'courierName', 'total', 'delivered', 'failedDelivery', 'returned', 'creationFailed', 'deliverySuccessRatePercent',
      'NOT_CREATED', 'CREATING', 'CREATED', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'CREATION_FAILED', 'DELIVERY_FAILED',
      'ordersWithCoupon', 'ordersWithoutCoupon', 'topCoupons', 'couponId', 'code', 'usageCount', 'usageLimit', 'distinctCustomers',
    ]);
    const FORBIDDEN = /(full_?name|phone|email|address|transaction|proof|risk|customer_?id|password|note)/i;

    function keysOf(value: unknown, out = new Set<string>()): Set<string> {
      if (Array.isArray(value)) value.forEach((v) => keysOf(v, out));
      else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
          out.add(k);
          keysOf(v, out);
        }
      }
      return out;
    }

    it('every payload uses only reviewed keys and no customer contact, payment or risk field', async () => {
      const urls = [
        `/sales/summary?${RANGE}`, `/sales/trend?${RANGE}`, `/sales/by-product?${RANGE}`, `/sales/by-category?${RANGE}`,
        `/orders/summary?${RANGE}`, `/payments/summary?${RANGE}`, `/products/performance?${RANGE}`, `/products/stock`,
        `/customers/summary?${RANGE}`, `/shipments/summary?${RANGE}`, `/coupons/summary?${RANGE}`, `/config`,
      ];
      for (const url of urls) {
        const body = (await get(url)).body;
        const keys = [...keysOf(body)];
        expect(keys.filter((k) => FORBIDDEN.test(k)), url).toEqual([]);
        expect(keys.filter((k) => !ALLOWED_KEYS.has(k)), `unreviewed key in ${url}`).toEqual([]);
        const text = JSON.stringify(body);
        for (const secret of ['Reg Customer', 'Guest One', 'Guest Two', '01711000001', '01711111111', 'Order Tester']) {
          expect(text, `${url} leaks ${secret}`).not.toContain(secret);
        }
      }
    });
  });

  describe('reports perform no writes', () => {
    const TABLES = ['orders', 'order_items', 'customers', 'products', 'product_variants', 'categories', 'coupons', 'coupon_usages', 'shipments', 'couriers', 'order_status_history', 'audit_logs', 'users', 'user_permissions'];
    const snapshot = async () =>
      Object.fromEntries(
        await Promise.all(
          TABLES.map(async (t) => [t, (await q(`SELECT md5(COALESCE(string_agg(x::text, '|' ORDER BY x::text), '')) AS h, count(*)::int AS n FROM ${t} x`))[0]]),
        ),
      );

    it('leaves every business table byte-identical after the full report suite', async () => {
      const s = await admin();
      const before = await snapshot();
      for (const url of [
        `/sales/summary?${RANGE}`, `/sales/trend?${RANGE}`, `/sales/by-product?${RANGE}`, `/sales/by-category?${RANGE}`,
        `/orders/summary?${RANGE}`, `/payments/summary?${RANGE}`, `/products/performance?${RANGE}`, `/products/stock?filter=low_stock`,
        `/customers/summary?${RANGE}`, `/shipments/summary?${RANGE}`, `/coupons/summary?${RANGE}`, `/config`,
      ]) {
        expect((await s.agent.get(`/api/admin/reports${url}`)).status, url).toBe(200);
      }
      expect(await snapshot()).toEqual(before);
    });
  });

  describe('daily rollup', () => {
    it('is recomputed idempotently, zero-fills days, and reflects a late cancellation on the next refresh', async () => {
      const { refreshReportRollups } = await import('../../src/services/reportRollup.service.js');
      const range = { from: '2026-05-31', to: '2026-06-30' };
      const rows = () => q(`SELECT day::text, orders_placed, orders_delivered, orders_cancelled, net_revenue::text, total_discount::text, total_shipping::text, coupon_orders FROM report_daily_sales ORDER BY day`);

      expect(await refreshReportRollups(range)).toMatchObject({ ran: true, days: 31 });
      const first = await rows();
      expect(first).toHaveLength(31); // zero-filled: no holes in the trend
      await refreshReportRollups(range);
      expect(await rows()).toEqual(first); // identical rows on re-run

      expect(first.find((r) => r.day === '2026-06-10')).toMatchObject({ orders_placed: 1, orders_delivered: 1, net_revenue: '1000.00', total_discount: '100.00', total_shipping: '60.00', coupon_orders: 1 });
      expect(first.find((r) => r.day === '2026-05-31')).toMatchObject({ net_revenue: '9999.00' }); // Dhaka day, O10
      expect(first.find((r) => r.day === '2026-06-01')).toMatchObject({ net_revenue: '50.00' }); // Dhaka day, O11

      const trend = await get(`/sales/trend?${RANGE}`);
      expect(trend.body.data.points).toHaveLength(29);
      expect(trend.body.data.meta.rollupRefreshedAt).toEqual(expect.any(String));
      const month = await get(`/sales/trend?${RANGE}&granularity=month`);
      expect(month.body.data.points).toHaveLength(1);
      expect(month.body.data.points[0]).toMatchObject({ day: '2026-06-01', netRevenue: 3600, ordersPlaced: 9 });
      // The rollup and the live summary agree on revenue for the same range.
      const live = (await get(`/sales/summary?${RANGE}`)).body.data.deliveredRevenue;
      expect(month.body.data.points[0].netRevenue).toBe(live);

      // A late cancellation upstream is reflected on the next refresh, not compounded.
      await q(`UPDATE orders SET order_status='CANCELLED' WHERE id=$1`, [orderIds.O8]);
      try {
        expect((await rows()).find((r) => r.day === '2026-06-17')).toMatchObject({ net_revenue: '600.00' }); // still stale
        await refreshReportRollups(range);
        expect((await rows()).find((r) => r.day === '2026-06-17')).toMatchObject({ net_revenue: '0.00', orders_cancelled: 1, orders_delivered: 0 });
      } finally {
        await q(`UPDATE orders SET order_status='DELIVERED' WHERE id=$1`, [orderIds.O8]);
        await refreshReportRollups(range);
      }
    });

    it('does not run a second overlapping refresh', async () => {
      const { withTransaction } = await import('../../src/lib/transaction.js');
      const { refreshReportRollups } = await import('../../src/services/reportRollup.service.js');
      await withTransaction(async (c) => {
        await c.query('SELECT pg_advisory_xact_lock(2020001)');
        // Another connection (the refresh opens its own) must skip rather than block or double-run.
        expect(await refreshReportRollups({ from: '2026-06-01', to: '2026-06-02' })).toEqual({ ran: false, days: 0 });
      });
    });
  });

  describe('asynchronous export (§11.4)', () => {
    it('returns 202 immediately, produces the file out of band, and releases a signed URL to the owner only', async () => {
      const { processNextExport } = await import('../../src/services/reportExport.service.js');
      const s = await admin();
      const post = await s.post('/api/admin/reports/exports').send({ report: 'sales-by-product', from: '2026-06-02', to: '2026-06-30' });
      expect(post.status).toBe(202);
      expect(post.body.data).toMatchObject({ status: 'PENDING' });
      const id = post.body.data.id as string;
      expect(fakeStorage.files.size).toBe(0); // nothing generated inside the request

      const pending = await s.agent.get(`/api/admin/reports/exports/${id}`);
      expect(pending.body.data).toEqual({ id, status: 'PENDING' });

      expect(await processNextExport()).toBe(true);
      expect(await processNextExport()).toBe(false); // queue drained

      const ready = await s.agent.get(`/api/admin/reports/exports/${id}`);
      expect(ready.body.data).toMatchObject({ id, status: 'READY' });
      expect(ready.body.data.downloadUrl).toContain('token=');
      expect(Date.parse(ready.body.data.expiresAt)).toBeGreaterThan(Date.now());

      // Another admin cannot fetch a colleague's export by id: 404, same as a missing one.
      const other = await loginAsAdmin(app, 'r-admin2', PW);
      expect((await other.agent.get(`/api/admin/reports/exports/${id}`)).status).toBe(404);
      expect((await other.agent.get(`/api/admin/reports/exports/00000000-0000-0000-0000-000000000000`)).status).toBe(404);
    });

    it('the CSV equals the report response for the same range', async () => {
      const { processNextExport, toCsv, buildReportSections } = await import('../../src/services/reportExport.service.js');
      const s = await admin();
      const post = await s.post('/api/admin/reports/exports').send({ report: 'sales-by-product', from: '2026-06-02', to: '2026-06-30' });
      await processNextExport();
      const path = [...fakeStorage.files.keys()].find((k) => k.endsWith(`${post.body.data.id}.csv`))!;
      const csv = fakeStorage.files.get(path)!;
      expect(csv).toBe(toCsv(await buildReportSections('sales-by-product', { from: '2026-06-02', to: '2026-06-30' })));

      const api = (await get(`/sales/by-product?${RANGE}`)).body.data as any[];
      const lines = csv.trim().split('\r\n');
      expect(lines[0]).toBe('productId,productName,unitsSold,revenue,orderCount');
      expect(lines.slice(1)).toEqual(api.map((r) => `${r.productId},${r.productName},${r.unitsSold},${r.revenue},${r.orderCount}`));
    });

    it('validates the export request and neutralises spreadsheet formulas', async () => {
      const s = await admin();
      expect((await s.post('/api/admin/reports/exports').send({ report: 'users', from: '2026-06-02', to: '2026-06-30' })).status).toBe(400);
      expect((await s.post('/api/admin/reports/exports').send({ report: 'sales-summary', from: '2020-01-01', to: '2026-06-30' })).body.error.code).toBe('RANGE_TOO_LARGE');
      const { csvCell } = await import('../../src/services/reportExport.service.js');
      expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
      expect(csvCell('+1')).toBe("'+1");
      expect(csvCell('a,b')).toBe('"a,b"');
      expect(csvCell(null)).toBe('');
    });

    it('records a FAILED export without throwing when generation fails', async () => {
      const { processNextExport } = await import('../../src/services/reportExport.service.js');
      const s = await admin();
      const post = await s.post('/api/admin/reports/exports').send({ report: 'sales-summary', from: '2026-06-02', to: '2026-06-30' });
      fakeStorage.failNext = true;
      expect(await processNextExport()).toBe(true);
      const res = await s.agent.get(`/api/admin/reports/exports/${post.body.data.id}`);
      expect(res.body.data).toMatchObject({ status: 'FAILED' });
      expect(res.body.data.errorMessage).not.toContain('bucket down');
    });

    it('rate-limits export creation per admin', async () => {
      process.env.RL_REPORT_EXPORT_MAX = '2';
      resetEnvCache();
      const { resetRateLimiterStore } = await import('../../src/lib/rateLimiterStore.js');
      resetRateLimiterStore?.();
      try {
        const s = await loginAsAdmin(app, 'r-admin2', PW);
        const statuses: number[] = [];
        for (let i = 0; i < 4; i++) {
          statuses.push((await s.post('/api/admin/reports/exports').send({ report: 'sales-summary', from: '2026-06-02', to: '2026-06-30' })).status);
        }
        expect(statuses.slice(0, 2)).toEqual([202, 202]);
        expect(statuses.slice(2)).toEqual([429, 429]);
      } finally {
        process.env.RL_REPORT_EXPORT_MAX = '1000';
        resetEnvCache();
        resetRateLimiterStore?.();
      }
    });
  });
});
