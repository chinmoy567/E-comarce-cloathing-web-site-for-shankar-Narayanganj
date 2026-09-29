import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.ts';
import { applyTestEnv } from '../helpers/testEnv.ts';
import { resetEnvCache } from '../../src/config/env.ts';
import { loginAsAdmin } from '../helpers/adminSession.ts';

/**
 * Spec 07 — `/api/admin/orders/*` over real HTTP (SPEC07_SECURITY_TESTING.md
 * §2–§5, §9): authn/authz, CSRF, input validation, injection safety, the
 * transition table through the HTTP layer, audit trail, and concurrency.
 */
const SCHEMA = 'spec07_orders_api';
const NIL = '00000000-0000-0000-0000-000000000000';
const PW = 'OrdersApiPass12';

describe.skipIf(!TEST_DATABASE_URL)('admin orders API (spec 07)', () => {
  let app: Express;
  let q: <T = any>(sql: string, params?: unknown[]) => Promise<T[]>;
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;
  let customerId: string;
  let variantId: string;
  let productId: string;

  async function newOrder(opts: {
    method?: 'BKASH' | 'COD';
    orderStatus?: string;
    paymentStatus?: string;
    qty?: number;
  } = {}): Promise<string> {
    const method = opts.method ?? 'COD';
    const orderStatus = opts.orderStatus ?? (method === 'COD' ? 'COD_VERIFICATION_PENDING' : 'PENDING_CONFIRMATION');
    const paymentStatus = opts.paymentStatus ?? (method === 'COD' ? 'PENDING_COLLECTION' : 'PENDING_VERIFICATION');
    const num = `T${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    const [o] = await q<{ id: string }>(
      `INSERT INTO orders (order_number, customer_id, payment_method, order_status, payment_status, subtotal, total_amount)
       VALUES ($1,$2,$3,$4,$5,500,500) RETURNING id`,
      [num, customerId, method, orderStatus, paymentStatus],
    );
    await q(
      `INSERT INTO order_items (order_id, product_id, product_variant_id, product_name, unit_price, quantity, line_total)
       VALUES ($1,$2,$3,'Item',500,$4,500)`,
      [o!.id, productId, variantId, opts.qty ?? 1],
    );
    return o!.id;
  }

  const stock = async () =>
    Number((await q(`SELECT stock_quantity FROM product_variants WHERE id=$1`, [variantId]))[0].stock_quantity);

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    applyTestEnv();
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    process.env.RL_PUBLIC_CEILING_MAX = '100000';
    resetEnvCache();

    const tx = await import('../../src/lib/transaction.js');
    resetTransactionPool = tx.resetTransactionPool;
    await tx.resetTransactionPool();
    q = (sql, params) => tx.withTransaction(async (c) => (await c.query(sql, params as any[])).rows);

    const { hashPassword } = await import('../../src/lib/password.js');
    const users = await import('../../src/repositories/users.repository.js');
    const passwordHash = await hashPassword(PW);
    await users.create({ role: 'ADMIN', userIdentifier: 'o-admin', passwordHash, mustChangePassword: false });
    await users.create({ role: 'MANAGER', userIdentifier: 'o-mgr', passwordHash, mustChangePassword: false });

    const { createApp } = await import('../../src/app.js');
    app = createApp();

    [{ id: customerId }] = (await q(
      `INSERT INTO customers (full_name, phone_number, division, district, area_unit_type, area_unit_name, ward_unit_type, ward_unit_name, detailed_address)
       VALUES ('Order Tester','01711111111','Dhaka','Dhaka','THANA','Dhanmondi','WARD','Ward 1','House 1, Road 1') RETURNING id`,
    )) as any;
    const [{ id: catId }] = (await q(
      `INSERT INTO categories (name, slug, status) VALUES ('C','c-o','ACTIVE') RETURNING id`,
    )) as any;
    [{ id: productId }] = (await q(
      `INSERT INTO products (category_id, name, slug, base_price, status) VALUES ($1,'P','p-o',500,'ACTIVE') RETURNING id`,
      [catId],
    )) as any;
    [{ id: variantId }] = (await q(
      `INSERT INTO product_variants (product_id, sku, price, stock_quantity, is_active) VALUES ($1,'O-SKU',500,10,true) RETURNING id`,
      [productId],
    )) as any;
  }, 90_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  const admin = () => loginAsAdmin(app, 'o-admin', PW);

  describe('authentication & CSRF (§9.4)', () => {
    const endpoints: Array<[string, string]> = [
      ['get', '/api/admin/orders'],
      ['get', `/api/admin/orders/${NIL}`],
      ['get', `/api/admin/orders/${NIL}/history`],
      ['post', `/api/admin/orders/${NIL}/confirm`],
      ['post', `/api/admin/orders/${NIL}/processing`],
      ['post', `/api/admin/orders/${NIL}/cancel`],
      ['post', `/api/admin/orders/${NIL}/payments/verify`],
      ['post', `/api/admin/orders/${NIL}/payments/reject`],
      ['post', `/api/admin/orders/${NIL}/payments/resubmit`],
      ['post', `/api/admin/orders/${NIL}/risk-check`],
    ];
    it.each(endpoints)('%s %s → 401 without a session', async (verb, url) => {
      const res = await (request(app) as any)[verb](url).send({});
      expect(res.status).toBe(401);
    });

    it('rejects a state-changing call without the CSRF header (403)', async () => {
      const s = await admin();
      const id = await newOrder();
      const res = await s.agent.post(`/api/admin/orders/${id}/confirm`).send({});
      expect(res.status).toBe(403);
      expect((await q(`SELECT order_status FROM orders WHERE id=$1`, [id]))[0].order_status).toBe(
        'COD_VERIFICATION_PENDING',
      );
    });

    it('rejects a wrong CSRF token (403)', async () => {
      const s = await admin();
      const id = await newOrder();
      const res = await s.agent.post(`/api/admin/orders/${id}/confirm`).set('X-CSRF-Token', 'bogus').send({});
      expect(res.status).toBe(403);
    });

    it('rejects a forged/garbage admin_at cookie (401)', async () => {
      const res = await request(app).get('/api/admin/orders').set('Cookie', 'admin_at=not.a.jwt');
      expect(res.status).toBe(401);
    });
  });

  describe('input validation & injection (§3.2, §3.3, §11.4)', () => {
    it('caps pageSize at 100', async () => {
      const s = await admin();
      expect((await s.agent.get('/api/admin/orders?pageSize=1000')).status).toBe(400);
      expect((await s.agent.get('/api/admin/orders?pageSize=100')).status).toBe(200);
    });

    it('applies a default page size when omitted', async () => {
      const s = await admin();
      const res = await s.agent.get('/api/admin/orders');
      expect(res.status).toBe(200);
      expect(res.body.pagination.pageSize).toBeGreaterThan(0);
    });

    it.each([
      ["order_status=x' OR 1=1--"],
      ['order_status=DELIVERED;DROP TABLE orders'],
      ['payment_status=%27'],
      ['payment_method=cash'],
      ['created_after=notadate'],
    ])('rejects malformed filter %s with 400, never 500', async (qs) => {
      const s = await admin();
      const res = await s.agent.get(`/api/admin/orders?${qs}`);
      expect(res.status).toBe(400);
      expect((await q(`SELECT to_regclass('orders') AS t`))[0].t).not.toBeNull();
    });

    it('filters by order_status', async () => {
      const s = await admin();
      await newOrder({ orderStatus: 'CANCELLED', method: 'COD', paymentStatus: 'PENDING_COLLECTION' });
      const res = await s.agent.get('/api/admin/orders?order_status=CANCELLED&pageSize=100');
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data.every((o: any) => o.order_status === 'CANCELLED')).toBe(true);
    });

    it('non-UUID order id returns 4xx, not 500 (§3.2 UUID validation)', async () => {
      const s = await admin();
      for (const url of ['/api/admin/orders/not-a-uuid', "/api/admin/orders/1'%20OR%20'1'='1", '/api/admin/orders/not-a-uuid/history']) {
        const res = await s.agent.get(url);
        expect(res.status, url).toBeGreaterThanOrEqual(400);
        expect(res.status, url).toBeLessThan(500);
      }
      const post = await s.post('/api/admin/orders/not-a-uuid/confirm').send({});
      expect(post.status).toBeGreaterThanOrEqual(400);
      expect(post.status).toBeLessThan(500);
    });

    it('unknown order id → 404 on GET and POST', async () => {
      const s = await admin();
      expect((await s.agent.get(`/api/admin/orders/${NIL}`)).status).toBe(404);
      expect((await s.post(`/api/admin/orders/${NIL}/confirm`).send({})).status).toBe(404);
      expect((await s.post(`/api/admin/orders/${NIL}/cancel`).send({ reason: 'long enough reason' })).status).toBe(404);
    });

    it('cancel requires a reason of ≥10 chars', async () => {
      const s = await admin();
      const id = await newOrder();
      expect((await s.post(`/api/admin/orders/${id}/cancel`).send({})).status).toBe(400);
      expect((await s.post(`/api/admin/orders/${id}/cancel`).send({ reason: 'short' })).status).toBe(400);
    });

    it('rejects unknown body fields (mass assignment of statuses)', async () => {
      const s = await admin();
      const id = await newOrder();
      const res = await s
        .post(`/api/admin/orders/${id}/cancel`)
        .send({ reason: 'valid long reason', order_status: 'DELIVERED', payment_status: 'PAID_COLLECTED' });
      expect(res.status).toBe(400);
      const [o] = await q(`SELECT order_status, payment_status FROM orders WHERE id=$1`, [id]);
      expect(o.order_status).toBe('COD_VERIFICATION_PENDING');
    });

    it('rejects non-JSON content type', async () => {
      const s = await admin();
      const id = await newOrder();
      const res = await s.agent
        .post(`/api/admin/orders/${id}/cancel`)
        .set('X-CSRF-Token', s.csrfToken)
        .set('Content-Type', 'text/plain')
        .send('reason=some long reason text');
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });

    it('stores a script-tag reason inertly and returns it as JSON', async () => {
      const s = await admin();
      const id = await newOrder();
      const res = await s.post(`/api/admin/orders/${id}/cancel`).send({ reason: '<script>alert(1)</script> customer asked' });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });
  });

  describe('transitions through HTTP (§5.21, §9.1)', () => {
    it('COD confirm → CONFIRMED, decrements stock, writes history + audit', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD' });
      const before = await stock();
      const res = await s.post(`/api/admin/orders/${id}/confirm`).send({});
      expect(res.status).toBe(200);
      expect(res.body.data.order_status).toBe('CONFIRMED');
      expect(await stock()).toBe(before - 1);

      const hist = await q(`SELECT * FROM order_status_history WHERE order_id=$1`, [id]);
      expect(hist).toHaveLength(1);
      expect(hist[0]).toMatchObject({ status_field: 'order_status', previous_status: 'COD_VERIFICATION_PENDING', new_status: 'CONFIRMED', actor_type: 'USER' });
      expect(hist[0].actor_user_id).toBeTruthy();
      const audit = await q(`SELECT 1 FROM audit_logs WHERE entity_type='order' AND entity_id=$1`, [id]);
      expect(audit.length).toBeGreaterThan(0);
    });

    it('bKash confirm is refused while payment is still PENDING_VERIFICATION', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'BKASH' });
      const res = await s.post(`/api/admin/orders/${id}/confirm`).send({});
      expect([409, 422]).toContain(res.status);
      expect((await q(`SELECT order_status FROM orders WHERE id=$1`, [id]))[0].order_status).toBe('PENDING_CONFIRMATION');
    });

    it('bKash: verify payment then confirm succeeds', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'BKASH' });
      const v = await s.post(`/api/admin/orders/${id}/payments/verify`).send({ bkashTransactionId: 'TRX12345AB' });
      expect(v.status).toBe(200);
      const c = await s.post(`/api/admin/orders/${id}/confirm`).send({});
      expect(c.status).toBe(200);
      expect(c.body.data.order_status).toBe('CONFIRMED');
    });

    it('bKash payment reject does NOT auto-cancel the order (§5.21.2)', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'BKASH' });
      const res = await s.post(`/api/admin/orders/${id}/payments/reject`).send({ reason: 'transaction id not found' });
      expect(res.status).toBe(200);
      const [o] = await q(`SELECT order_status, payment_status FROM orders WHERE id=$1`, [id]);
      expect(o).toMatchObject({ order_status: 'PENDING_CONFIRMATION', payment_status: 'REJECTED' });
    });

    it('bKash resubmit: REJECTED → PENDING_VERIFICATION; 409 otherwise', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'BKASH', paymentStatus: 'REJECTED' });
      expect((await s.post(`/api/admin/orders/${id}/payments/resubmit`).send({ newBkashTransactionId: 'NEWTRX999' })).status).toBe(200);
      expect((await q(`SELECT payment_status FROM orders WHERE id=$1`, [id]))[0].payment_status).toBe('PENDING_VERIFICATION');
      const again = await s.post(`/api/admin/orders/${id}/payments/resubmit`).send({ newBkashTransactionId: 'NEWTRX998' });
      expect(again.status).toBe(409);
    });

    it('COD cannot use payment resubmit', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD' });
      const res = await s.post(`/api/admin/orders/${id}/payments/resubmit`).send({ newBkashTransactionId: 'NEWTRX999' });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });

    it('DELIVERED cannot be cancelled (409) and stays DELIVERED', async () => {
      const s = await admin();
      const id = await newOrder({ orderStatus: 'DELIVERED', paymentStatus: 'PENDING_COLLECTION' });
      const res = await s.post(`/api/admin/orders/${id}/cancel`).send({ reason: 'trying to cancel delivered' });
      expect(res.status).toBe(409);
      expect((await q(`SELECT order_status FROM orders WHERE id=$1`, [id]))[0].order_status).toBe('DELIVERED');
    });

    it('cannot skip states: PENDING → PROCESSING is 409', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD' });
      expect((await s.post(`/api/admin/orders/${id}/processing`).send({})).status).toBe(409);
    });

    it('cancel records reason/cancelled_at/cancelled_by and history', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD' });
      const res = await s.post(`/api/admin/orders/${id}/cancel`).send({ reason: 'customer changed mind' });
      expect(res.status).toBe(200);
      const [o] = await q(`SELECT * FROM orders WHERE id=$1`, [id]);
      expect(o.order_status).toBe('CANCELLED');
      expect(o.cancellation_reason).toBe('customer changed mind');
      expect(o.cancelled_at).toBeTruthy();
      expect(o.cancelled_by).toBeTruthy();
    });

    it('cancelling a CONFIRMED order restores stock (§5.1 uniform restoration)', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD', qty: 2 });
      const before = await stock();
      expect((await s.post(`/api/admin/orders/${id}/confirm`).send({})).status).toBe(200);
      expect(await stock()).toBe(before - 2);
      expect((await s.post(`/api/admin/orders/${id}/cancel`).send({ reason: 'stock restore check' })).status).toBe(200);
      expect(await stock()).toBe(before);
    });

    it('confirm on insufficient stock → 4xx, order and stock unchanged (atomic rollback)', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD', qty: 9999 });
      const before = await stock();
      const res = await s.post(`/api/admin/orders/${id}/confirm`).send({});
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(await stock()).toBe(before);
      expect((await q(`SELECT order_status FROM orders WHERE id=$1`, [id]))[0].order_status).toBe('COD_VERIFICATION_PENDING');
    });
  });

  describe('concurrency (§4.3)', () => {
    it('two simultaneous confirms: exactly one wins, stock decremented once', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD' });
      const before = await stock();
      const [a, b] = await Promise.all([
        s.post(`/api/admin/orders/${id}/confirm`).send({}),
        s.post(`/api/admin/orders/${id}/confirm`).send({}),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect(await stock()).toBe(before - 1);
      expect((await q(`SELECT 1 FROM order_status_history WHERE order_id=$1`, [id])).length).toBe(1);
    });
  });

  describe('RBAC & information disclosure', () => {
    it('manager (default tier) can list orders', async () => {
      const m = await loginAsAdmin(app, 'o-mgr', PW);
      expect((await m.agent.get('/api/admin/orders')).status).toBe(200);
    });

    it('404 body does not differentiate or leak internals', async () => {
      const s = await admin();
      const res = await s.agent.get(`/api/admin/orders/${NIL}`);
      const text = JSON.stringify(res.body);
      expect(text).not.toMatch(/select |pg_|stack|at .*\.ts/i);
    });

    it('list response never exposes password hashes or internal fields', async () => {
      const s = await admin();
      await newOrder();
      const res = await s.agent.get('/api/admin/orders');
      expect(JSON.stringify(res.body)).not.toMatch(/password|token_hash|secret/i);
    });
  });
});
