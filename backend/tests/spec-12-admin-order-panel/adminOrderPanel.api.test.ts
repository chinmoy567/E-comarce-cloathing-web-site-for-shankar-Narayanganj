import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.ts';
import { applyTestEnv } from '../helpers/testEnv.ts';
import { resetEnvCache } from '../../src/config/env.ts';
import { loginAsAdmin } from '../helpers/adminSession.ts';

/**
 * Admin order panel + customer management + dashboard (implementation spec 13,
 * 05-admin §5.2-§5.4, §5.7, 03-payment-order §3.4, 07-state-machine §5.21).
 * Real HTTP, real middleware, real database schema. Folder numbering follows the
 * repo's legacy test-folder scheme (see TEST_ORGANIZATION.md).
 */
const SCHEMA = 'spec12_admin_order_panel';
const NIL = '00000000-0000-0000-0000-000000000000';
const PW = 'PanelApiPass12';

describe.skipIf(!TEST_DATABASE_URL)('admin order panel (spec 13)', () => {
  let app: Express;
  let q: <T = any>(sql: string, params?: unknown[]) => Promise<T[]>;
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;
  let permissionsRepository: typeof import('../../src/repositories/permissions.repository.js');
  let adminId: string;
  let managerId: string;
  let customerId: string;
  let guestCustomerId: string;
  let variantId: string;
  let productId: string;

  async function newOrder(
    opts: {
      method?: 'BKASH' | 'COD';
      orderStatus?: string;
      paymentStatus?: string;
      qty?: number;
      customer?: string;
      createdAgoHours?: number;
    } = {},
  ): Promise<string> {
    const method = opts.method ?? 'COD';
    const orderStatus = opts.orderStatus ?? (method === 'COD' ? 'COD_VERIFICATION_PENDING' : 'PENDING_CONFIRMATION');
    const paymentStatus = opts.paymentStatus ?? (method === 'COD' ? 'PENDING_COLLECTION' : 'PENDING_VERIFICATION');
    const num = `P${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    const [o] = await q<{ id: string }>(
      `INSERT INTO orders (order_number, customer_id, payment_method, order_status, payment_status, subtotal, total_amount,
                          full_name, phone_number, detailed_address, created_at)
       VALUES ($1,$2,$3,$4,$5,500,500,'Order Tester','01711111111','House 1', now() - ($6::int * interval '1 hour')) RETURNING id`,
      [num, opts.customer ?? customerId, method, orderStatus, paymentStatus, opts.createdAgoHours ?? 0],
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
  const row = async (id: string) => (await q(`SELECT * FROM orders WHERE id=$1`, [id]))[0];

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    applyTestEnv();
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    process.env.RL_PUBLIC_CEILING_MAX = '100000';
    process.env.RL_AUTHENTICATED_CEILING_MAX = '100000';
    resetEnvCache();

    const tx = await import('../../src/lib/transaction.js');
    resetTransactionPool = tx.resetTransactionPool;
    await tx.resetTransactionPool();
    q = (sql, params) => tx.withTransaction(async (c) => (await c.query(sql, params as any[])).rows);

    const { hashPassword } = await import('../../src/lib/password.js');
    const users = await import('../../src/repositories/users.repository.js');
    permissionsRepository = await import('../../src/repositories/permissions.repository.js');
    const passwordHash = await hashPassword(PW);
    adminId = (await users.create({ role: 'ADMIN', userIdentifier: 'p-admin', passwordHash, mustChangePassword: false })).id;
    managerId = (await users.create({ role: 'MANAGER', userIdentifier: 'p-mgr', passwordHash, mustChangePassword: false })).id;

    const { createApp } = await import('../../src/app.js');
    app = createApp();

    [{ id: customerId }] = (await q(
      `INSERT INTO customers (account_type, full_name, phone_number, division, district, area_unit_type, area_unit_name, ward_unit_type, ward_unit_name, detailed_address)
       VALUES ('REGISTERED','Reg Customer','01711111111','Dhaka','Dhaka','THANA','Dhanmondi','WARD','Ward 1','House 1, Road 1') RETURNING id`,
    )) as any;
    [{ id: guestCustomerId }] = (await q(
      `INSERT INTO customers (account_type, full_name, phone_number, division, district, area_unit_type, area_unit_name, ward_unit_type, ward_unit_name, detailed_address)
       VALUES ('GUEST','Guest Customer','01822222222','Dhaka','Dhaka','THANA','Gulshan','WARD','Ward 2','House 2') RETURNING id`,
    )) as any;
    const [{ id: catId }] = (await q(`INSERT INTO categories (name, slug, status) VALUES ('C','c-p','ACTIVE') RETURNING id`)) as any;
    [{ id: productId }] = (await q(
      `INSERT INTO products (category_id, name, slug, base_price, status) VALUES ($1,'P','p-p',500,'ACTIVE') RETURNING id`,
      [catId],
    )) as any;
    [{ id: variantId }] = (await q(
      `INSERT INTO product_variants (product_id, sku, price, stock_quantity, is_active) VALUES ($1,'P-SKU',500,1000,true) RETURNING id`,
      [productId],
    )) as any;
  }, 90_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  /** Default-granted (Yes-tier) keys cannot be revoked per account, so flip the catalogue row in this throwaway schema. */
  async function withoutPaymentView(fn: () => Promise<void>): Promise<void> {
    await q(`UPDATE permissions SET manager_tier='NO' WHERE key='payment.view'`);
    try {
      await fn();
    } finally {
      await q(`UPDATE permissions SET manager_tier='YES' WHERE key='payment.view'`);
    }
  }

  const admin = () => loginAsAdmin(app, 'p-admin', PW);
  const manager = () => loginAsAdmin(app, 'p-mgr', PW);

  describe('order list (§5.2, §3.4)', () => {
    it('returns separate statuses, guest flag, and shipment status on every row', async () => {
      const s = await admin();
      await newOrder({ customer: guestCustomerId });
      const res = await s.agent.get('/api/admin/orders?pageSize=100');
      expect(res.status).toBe(200);
      const guest = res.body.data.find((o: any) => o.customer_id === guestCustomerId);
      const reg = res.body.data.find((o: any) => o.customer_id === customerId) ?? null;
      expect(guest).toMatchObject({ is_guest_order: true, customer_account_type: 'GUEST', shipment_status: 'NOT_CREATED' });
      expect(guest).toHaveProperty('order_status');
      expect(guest).toHaveProperty('payment_status');
      if (reg) expect(reg.is_guest_order).toBe(false);
    });

    it('bKash and COD filters are disjoint and cover every order', async () => {
      const s = await admin();
      await newOrder({ method: 'BKASH' });
      await newOrder({ method: 'COD' });
      const all = (await s.agent.get('/api/admin/orders?pageSize=100')).body;
      const bk = (await s.agent.get('/api/admin/orders?payment_method=BKASH&pageSize=100')).body;
      const cod = (await s.agent.get('/api/admin/orders?payment_method=COD&pageSize=100')).body;
      expect(bk.pagination.total + cod.pagination.total).toBe(all.pagination.total);
      const ids = new Set(bk.data.map((o: any) => o.id));
      expect(cod.data.some((o: any) => ids.has(o.id))).toBe(false);
    });

    it('supports multi-value status filters, guest filter, and free-text search', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'BKASH' });
      const num = (await row(id)).order_number;
      const multi = await s.agent.get('/api/admin/orders?order_status=PENDING_CONFIRMATION,CONFIRMED&pageSize=100');
      expect(multi.status).toBe(200);
      expect(multi.body.data.every((o: any) => ['PENDING_CONFIRMATION', 'CONFIRMED'].includes(o.order_status))).toBe(true);
      const guests = await s.agent.get('/api/admin/orders?is_guest_order=true&pageSize=100');
      expect(guests.body.data.every((o: any) => o.is_guest_order === true)).toBe(true);
      const search = await s.agent.get(`/api/admin/orders?q=${num}`);
      expect(search.body.data.map((o: any) => o.id)).toEqual([id]);
      // LIKE metacharacters are literal, so '%' does not match everything.
      const wild = await s.agent.get('/api/admin/orders?q=%25');
      expect(wild.body.data.length).toBe(0);
    });

    it('shows the COD discrepancy computed, and stores it nowhere (§5.21.3)', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD', orderStatus: 'DELIVERED', paymentStatus: 'PENDING_COLLECTION' });
      const list = await s.agent.get('/api/admin/orders?has_cod_discrepancy=true&pageSize=100');
      expect(list.body.data.some((o: any) => o.id === id && o.has_cod_collection_discrepancy === true)).toBe(true);
      const detail = await s.agent.get(`/api/admin/orders/${id}`);
      expect(detail.body.data.has_cod_collection_discrepancy).toBe(true);
      const cols = await q(`SELECT column_name FROM information_schema.columns WHERE table_name='orders' AND table_schema=current_schema()`);
      expect(cols.some((c: any) => /discrepan/i.test(c.column_name))).toBe(false);

      const res = await s.post(`/api/admin/orders/${id}/payment/collection`).send({ outcome: 'COLLECTED' });
      expect(res.status).toBe(200);
      expect(res.body.data.payment_status).toBe('PAID_COLLECTED');
      const after = await s.agent.get(`/api/admin/orders/${id}`);
      expect(after.body.data.has_cod_collection_discrepancy).toBe(false);
    });

    it('NOT_RECOVERABLE needs a reason and leaves the order DELIVERED', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD', orderStatus: 'DELIVERED', paymentStatus: 'PENDING_COLLECTION' });
      expect((await s.post(`/api/admin/orders/${id}/payment/collection`).send({ outcome: 'NOT_RECOVERABLE' })).status).toBe(400);
      const res = await s
        .post(`/api/admin/orders/${id}/payment/collection`)
        .send({ outcome: 'NOT_RECOVERABLE', reason: 'Customer refused and cannot be reached' });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ payment_status: 'REJECTED', order_status: 'DELIVERED' });
    });

    it('collection resolution is refused on a non-delivered or bKash order', async () => {
      const s = await admin();
      const cod = await newOrder({ method: 'COD' });
      expect((await s.post(`/api/admin/orders/${cod}/payment/collection`).send({ outcome: 'COLLECTED' })).status).toBe(409);
      const bk = await newOrder({ method: 'BKASH' });
      const res = await s.post(`/api/admin/orders/${bk}/payment/collection`).send({ outcome: 'COLLECTED' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PAYMENT_METHOD_MISMATCH');
    });

    it('stale view lists old unconfirmed orders and cancels nothing (§3.4)', async () => {
      const s = await admin();
      const stale = await newOrder({ method: 'BKASH', createdAgoHours: 100 });
      const fresh = await newOrder({ method: 'BKASH', createdAgoHours: 0 });
      const first = await s.agent.get('/api/admin/orders?stale=true&pageSize=100');
      const ids = first.body.data.map((o: any) => o.id);
      expect(ids).toContain(stale);
      expect(ids).not.toContain(fresh);
      const again = await s.agent.get('/api/admin/orders?stale=true&pageSize=100');
      expect(again.body.data.map((o: any) => o.id)).toContain(stale);
      expect((await row(stale)).order_status).toBe('PENDING_CONFIRMATION');
    });

    it('sorts by lastPaymentRejectedAt and rejects unknown sort keys', async () => {
      const s = await admin();
      expect((await s.agent.get('/api/admin/orders?sort=last_payment_rejected_at&direction=desc')).status).toBe(200);
      expect((await s.agent.get('/api/admin/orders?sort=password_hash')).status).toBe(400);
      expect((await s.agent.get('/api/admin/orders?sort=created_at;DROP TABLE orders')).status).toBe(400);
    });

    it('paginates (§11.4)', async () => {
      const s = await admin();
      const res = await s.agent.get('/api/admin/orders?pageSize=2&page=1');
      expect(res.body.data.length).toBeLessThanOrEqual(2);
      expect(res.body.pagination).toMatchObject({ page: 1, pageSize: 2 });
      expect((await s.agent.get('/api/admin/orders?pageSize=101')).status).toBe(400);
    });
  });

  describe('order detail', () => {
    it('includes customer, items, coupon snapshot, shipment slot, and allowed actions', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'BKASH' });
      await q(`UPDATE orders SET coupon_code='SAVE10', discount_type='PERCENTAGE', discount_amount=50, eligible_subtotal=500 WHERE id=$1`, [id]);
      const res = await s.agent.get(`/api/admin/orders/${id}`);
      expect(res.status).toBe(200);
      const d = res.body.data;
      expect(d.customer).toMatchObject({ id: customerId, accountType: 'REGISTERED' });
      expect(d.items).toHaveLength(1);
      expect(d.items[0]).toMatchObject({ productName: 'Item', quantity: 1, unitPrice: 500 });
      expect(d.applied_coupon).toMatchObject({ code: 'SAVE10', discountAmount: 50, eligibleSubtotal: 500 });
      expect(d.allowed_actions).toEqual(expect.arrayContaining(['verify_payment', 'reject_payment', 'cancel']));
      expect(d.allowed_actions).not.toContain('confirm'); // not verified yet
    });

    it('a guest order has the same shape as a registered one', async () => {
      const s = await admin();
      const g = (await s.agent.get(`/api/admin/orders/${await newOrder({ customer: guestCustomerId })}`)).body.data;
      const r = (await s.agent.get(`/api/admin/orders/${await newOrder()}`)).body.data;
      expect(g.is_guest_order).toBe(true);
      expect(r.is_guest_order).toBe(false);
      expect(Object.keys(g).sort()).toEqual(Object.keys(r).sort());
    });

    it('allowed_actions is permission-filtered for a Manager without order.cancel', async () => {
      const s = await manager();
      const id = await newOrder({ method: 'BKASH' });
      const actions = (await s.agent.get(`/api/admin/orders/${id}`)).body.data.allowed_actions;
      expect(actions).not.toContain('cancel');
      expect(actions).toContain('verify_payment');
    });
  });

  describe('payment verify / reject / confirm (§5.3, §3.4, §5.21.2)', () => {
    it('verify moves only payment_status and then allows confirm', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'BKASH' });
      const v = await s.post(`/api/admin/orders/${id}/payments/verify`).send({});
      expect(v.status).toBe(200);
      const o = await row(id);
      expect(o).toMatchObject({ payment_status: 'PAID_VERIFIED', order_status: 'PENDING_CONFIRMATION' });
      const detail = await s.agent.get(`/api/admin/orders/${id}`);
      expect(detail.body.data.allowed_actions).toContain('confirm');
    });

    it('bKash confirm before verification is a 409 TRANSITION_PRECONDITION_FAILED; after it succeeds', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'BKASH' });
      const before = await stock();
      const refused = await s.post(`/api/admin/orders/${id}/confirm`).send({});
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe('TRANSITION_PRECONDITION_FAILED');
      expect(await stock()).toBe(before);
      await s.post(`/api/admin/orders/${id}/payments/verify`).send({});
      const ok = await s.post(`/api/admin/orders/${id}/confirm`).send({});
      expect(ok.status).toBe(200);
      expect(await stock()).toBe(before - 1);
    });

    it('rejection requires a reason, stores metadata, does not cascade, and resubmission works', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'BKASH' });
      expect((await s.post(`/api/admin/orders/${id}/payments/reject`).send({})).status).toBe(400);
      expect((await s.post(`/api/admin/orders/${id}/payments/reject`).send({ reason: 'short' })).status).toBe(400);

      const rej = await s
        .post(`/api/admin/orders/${id}/payments/reject`)
        .send({ reason: 'Transaction id does not match', reasonCode: 'TRANSACTION_MISMATCH' });
      expect(rej.status).toBe(200);
      const o = await row(id);
      expect(o).toMatchObject({ payment_status: 'REJECTED', order_status: 'PENDING_CONFIRMATION' });
      expect(o.last_payment_rejected_at).not.toBeNull();

      const hist = await q(`SELECT * FROM order_status_history WHERE order_id=$1 AND new_status='REJECTED'`, [id]);
      expect(hist).toHaveLength(1);
      expect(hist[0].reason).toContain('TRANSACTION_MISMATCH');
      expect(hist[0].reason).toContain('Transaction id does not match');
      expect(hist[0].actor_user_id).toBe(adminId);

      expect((await s.post(`/api/admin/orders/${id}/payments/resubmit`).send({ newBkashTransactionId: 'TRX99999ZZ' })).status).toBe(200);
      const panel = (await s.agent.get(`/api/admin/orders/${id}/payment`)).body.data;
      expect(panel.method).toBe('BKASH');
      expect(panel.events.map((e: any) => e.newStatus)).toEqual(['REJECTED', 'PENDING_VERIFICATION']);
      expect(panel.events[0].reason).toContain('Transaction id does not match');
      expect(panel.lastRejectedAt).not.toBeNull();
    });

    it('rejects an unknown reasonCode', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'BKASH' });
      const res = await s.post(`/api/admin/orders/${id}/payments/reject`).send({ reason: 'long enough reason', reasonCode: 'WHATEVER' });
      expect(res.status).toBe(400);
    });

    it('double-verify and double-confirm each produce one effect and one 409', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'BKASH' });
      const [v1, v2] = await Promise.all([
        s.post(`/api/admin/orders/${id}/payments/verify`).send({}),
        s.post(`/api/admin/orders/${id}/payments/verify`).send({}),
      ]);
      expect([v1.status, v2.status].sort()).toEqual([200, 409]);
      const before = await stock();
      const [c1, c2] = await Promise.all([
        s.post(`/api/admin/orders/${id}/confirm`).send({}),
        s.post(`/api/admin/orders/${id}/confirm`).send({}),
      ]);
      expect([c1.status, c2.status].sort()).toEqual([200, 409]);
      expect(await stock()).toBe(before - 1);
    });
  });

  describe('COD confirmation & method mismatch (§5.4)', () => {
    it('COD confirm needs no payment verification and leaves payment PENDING_COLLECTION', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD' });
      const res = await s.post(`/api/admin/orders/${id}/cod-confirm`).send({});
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ order_status: 'CONFIRMED', payment_status: 'PENDING_COLLECTION' });
    });

    it('cod-confirm on a bKash order and confirm on a COD order are PAYMENT_METHOD_MISMATCH', async () => {
      const s = await admin();
      const bk = await newOrder({ method: 'BKASH' });
      const a = await s.post(`/api/admin/orders/${bk}/cod-confirm`).send({});
      expect(a.status).toBe(409);
      expect(a.body.error.code).toBe('PAYMENT_METHOD_MISMATCH');
      const cod = await newOrder({ method: 'COD' });
      const b = await s.post(`/api/admin/orders/${cod}/confirm`).send({});
      expect(b.status).toBe(409);
      expect(b.body.error.code).toBe('PAYMENT_METHOD_MISMATCH');
      expect((await row(cod)).order_status).toBe('COD_VERIFICATION_PENDING');
    });

    it('insufficient stock blocks confirmation with 409 INSUFFICIENT_STOCK naming the variant', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD', qty: 999999 });
      const before = await stock();
      const res = await s.post(`/api/admin/orders/${id}/cod-confirm`).send({});
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
      expect(res.body.error.details[0].field).toBe(variantId);
      expect(await stock()).toBe(before);
      expect((await row(id)).order_status).toBe('COD_VERIFICATION_PENDING');
    });

    it('cancel after confirm restores stock; cancel before confirm restores nothing', async () => {
      const s = await admin();
      const before = await stock();
      const confirmed = await newOrder({ method: 'COD', qty: 3 });
      await s.post(`/api/admin/orders/${confirmed}/cod-confirm`).send({});
      expect(await stock()).toBe(before - 3);
      expect((await s.post(`/api/admin/orders/${confirmed}/cancel`).send({ reason: 'customer changed mind' })).status).toBe(200);
      expect(await stock()).toBe(before);

      const unconfirmed = await newOrder({ method: 'COD', qty: 3 });
      expect((await s.post(`/api/admin/orders/${unconfirmed}/cancel`).send({ reason: 'customer changed mind' })).status).toBe(200);
      expect(await stock()).toBe(before);
    });

    it('processing moves CONFIRMED to PROCESSING and touches no other status', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD' });
      await s.post(`/api/admin/orders/${id}/cod-confirm`).send({});
      const res = await s.post(`/api/admin/orders/${id}/processing`).send({});
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ order_status: 'PROCESSING', payment_status: 'PENDING_COLLECTION' });
      const sh = await q(`SELECT shipment_status FROM shipments WHERE order_id=$1`, [id]);
      expect(sh.every((r: any) => r.shipment_status === 'NOT_CREATED')).toBe(true);
    });

    it('every action writes history and audit rows naming the actor and reason', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD' });
      await s.post(`/api/admin/orders/${id}/cancel`).send({ reason: 'duplicate order placed by mistake' });
      const hist = await q(`SELECT * FROM order_status_history WHERE order_id=$1`, [id]);
      expect(hist).toHaveLength(1);
      expect(hist[0]).toMatchObject({ actor_user_id: adminId, reason: 'duplicate order placed by mistake' });
      const audit = await q(`SELECT * FROM audit_logs WHERE entity_type='order' AND entity_id=$1`, [id]);
      expect(audit[0]).toMatchObject({ actor_user_id: adminId, reason: 'duplicate order placed by mistake' });
    });
  });

  describe('permission matrix and non-UI enforcement (§5.15, §5.17, §5.18)', () => {
    it('unauthenticated calls to every new endpoint are 401', async () => {
      const { default: request } = await import('supertest');
      const calls: Array<[string, string]> = [
        ['get', `/api/admin/orders/${NIL}/payment`],
        ['post', `/api/admin/orders/${NIL}/cod-confirm`],
        ['post', `/api/admin/orders/${NIL}/payment/collection`],
        ['patch', `/api/admin/orders/${NIL}`],
        ['get', '/api/admin/customers'],
        ['get', `/api/admin/customers/${NIL}`],
        ['get', `/api/admin/customers/${NIL}/orders`],
        ['patch', `/api/admin/customers/${NIL}`],
        ['get', '/api/admin/dashboard/summary'],
      ];
      for (const [verb, url] of calls) {
        expect((await (request(app) as any)[verb](url).send({})).status, url).toBe(401);
      }
    });

    it('a Manager without order.update / order.cancel / customer.update gets 403 until granted', async () => {
      const s = await manager();
      const id = await newOrder({ method: 'COD' });
      expect((await s.post(`/api/admin/orders/${id}/cancel`).send({ reason: 'a long enough reason' })).status).toBe(403);
      expect((await s.patch(`/api/admin/orders/${id}`).send({ internalNote: 'x' })).status).toBe(403);
      expect((await s.post(`/api/admin/orders/${id}/payment/collection`).send({ outcome: 'COLLECTED' })).status).toBe(403);
      expect((await s.patch(`/api/admin/customers/${customerId}`).send({ fullName: 'Changed' })).status).toBe(403);
      expect((await row(id)).order_status).toBe('COD_VERIFICATION_PENDING');

      await permissionsRepository.grant(managerId, 'order.cancel', adminId);
      try {
        const s2 = await manager();
        expect((await s2.post(`/api/admin/orders/${id}/cancel`).send({ reason: 'a long enough reason' })).status).toBe(200);
      } finally {
        await permissionsRepository.revoke(managerId, 'order.cancel');
      }
    });

    it('a Manager can verify and reject payments by default (Yes rows)', async () => {
      const s = await manager();
      const a = await newOrder({ method: 'BKASH' });
      const b = await newOrder({ method: 'BKASH' });
      expect((await s.post(`/api/admin/orders/${a}/payments/verify`).send({})).status).toBe(200);
      expect((await s.post(`/api/admin/orders/${b}/payments/reject`).send({ reason: 'amount does not match' })).status).toBe(200);
    });

    it('payment.view gates the payment panel separately from order.view (403 without it)', async () => {
      const id = await newOrder({ method: 'BKASH' });
      const s = await manager();
      expect((await s.agent.get(`/api/admin/orders/${id}/payment`)).status).toBe(200);
      await withoutPaymentView(async () => {
        const s2 = await manager();
        expect((await s2.agent.get(`/api/admin/orders/${id}/payment`)).status).toBe(403);
        expect((await s2.agent.get(`/api/admin/orders/${id}`)).status).toBe(200); // order.view is independent
      });
    });
  });

  describe('PATCH /orders/:id whitelist (§5.2, §8.23)', () => {
    it('rejects status, amount, coupon and line-item fields with 400', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD' });
      for (const body of [
        { totalAmount: 1 },
        { orderStatus: 'DELIVERED' },
        { order_status: 'DELIVERED' },
        { paymentStatus: 'PAID_COLLECTED' },
        { couponCode: 'FREE' },
        { items: [] },
        { subtotal: 1 },
      ]) {
        expect((await s.patch(`/api/admin/orders/${id}`).send(body)).status, JSON.stringify(body)).toBe(400);
      }
      expect((await s.patch(`/api/admin/orders/${id}`).send({})).status).toBe(400);
      const o = await row(id);
      expect(o).toMatchObject({ order_status: 'COD_VERIFICATION_PENDING', total_amount: '500.00' });
    });

    it('permitted fields succeed and are audited with previous and new values', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD' });
      const res = await s.patch(`/api/admin/orders/${id}`).send({ internalNote: 'Called customer', detailedAddress: 'House 7, Road 2' });
      expect(res.status).toBe(200);
      const o = await row(id);
      expect(o).toMatchObject({ internal_note: 'Called customer', detailed_address: 'House 7, Road 2' });
      const audit = await q(`SELECT * FROM audit_logs WHERE entity_type='order' AND entity_id=$1 AND action='order_info_updated'`, [id]);
      expect(audit).toHaveLength(1);
      expect(audit[0].previous_value).toMatchObject({ detailedAddress: 'House 1' });
      expect(audit[0].new_value).toMatchObject({ internalNote: 'Called customer', detailedAddress: 'House 7, Road 2' });
    });

    it('contact/address edits after a shipment exists are 409 ORDER_LOCKED_FOR_EDIT; the note still works', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD' });
      await q(`UPDATE shipments SET shipment_status='CREATED' WHERE order_id=$1`, [id]).catch(() => undefined);
      await q(
        `INSERT INTO shipments (order_id, shipment_status) VALUES ($1,'CREATED') ON CONFLICT (order_id) DO UPDATE SET shipment_status='CREATED'`,
        [id],
      );
      const locked = await s.patch(`/api/admin/orders/${id}`).send({ contactName: 'New Name' });
      expect(locked.status).toBe(409);
      expect(locked.body.error.code).toBe('ORDER_LOCKED_FOR_EDIT');
      expect((await row(id)).full_name).toBe('Order Tester');
      expect((await s.patch(`/api/admin/orders/${id}`).send({ internalNote: 'still allowed' })).status).toBe(200);
    });

    it('a malformed phone is a 400, not a 500', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD' });
      const res = await s.patch(`/api/admin/orders/${id}`).send({ contactPhone: '12345678' });
      expect(res.status).toBe(400);
    });
  });

  describe('customer management (§5.7)', () => {
    it('lists customers with a registered/guest indicator, search and filter', async () => {
      const s = await admin();
      const all = await s.agent.get('/api/admin/customers?pageSize=100');
      expect(all.status).toBe(200);
      const byId = Object.fromEntries(all.body.data.map((c: any) => [c.id, c]));
      expect(byId[customerId]).toMatchObject({ accountType: 'REGISTERED', isGuest: false });
      expect(byId[guestCustomerId]).toMatchObject({ accountType: 'GUEST', isGuest: true });
      const guests = await s.agent.get('/api/admin/customers?accountType=GUEST&pageSize=100');
      expect(guests.body.data.every((c: any) => c.accountType === 'GUEST')).toBe(true);
      const found = await s.agent.get('/api/admin/customers?q=01822222222');
      expect(found.body.data.map((c: any) => c.id)).toEqual([guestCustomerId]);
      expect((await s.agent.get('/api/admin/customers?pageSize=101')).status).toBe(400);
    });

    it('order history spans every order under the one customer record', async () => {
      const s = await admin();
      const a = await newOrder({ customer: guestCustomerId });
      const b = await newOrder({ customer: guestCustomerId, method: 'BKASH' });
      const res = await s.agent.get(`/api/admin/customers/${guestCustomerId}/orders?pageSize=100`);
      expect(res.status).toBe(200);
      const ids = res.body.data.map((o: any) => o.id);
      expect(ids).toEqual(expect.arrayContaining([a, b]));
      expect(res.body.data[0]).toHaveProperty('payment_status'); // admin holds payment.view
    });

    it('omits payment fields entirely for an actor without payment.view', async () => {
      await newOrder({ customer: customerId });
      const withIt = await manager();
      expect(await withIt.agent.get(`/api/admin/customers/${customerId}`).then((r) => r.body.data)).toHaveProperty('paymentSummary');

      await withoutPaymentView(async () => {
        const s = await manager();
        const detail = await s.agent.get(`/api/admin/customers/${customerId}`);
        expect(detail.status).toBe(200);
        expect('paymentSummary' in detail.body.data).toBe(false);
        const orders = await s.agent.get(`/api/admin/customers/${customerId}/orders`);
        expect(orders.body.data.length).toBeGreaterThan(0);
        for (const o of orders.body.data) {
          expect('payment_status' in o).toBe(false);
          expect('payment_method' in o).toBe(false);
          expect('bkash_transaction_id' in o).toBe(false);
        }
      });
    });

    it('PATCH is limited to contact/address and can never change account type, phone or credentials', async () => {
      const s = await admin();
      for (const body of [{ accountType: 'REGISTERED' }, { phoneNumber: '01999999999' }, { password: 'x' }, { passwordHash: 'x' }, { role: 'ADMIN' }]) {
        expect((await s.patch(`/api/admin/customers/${guestCustomerId}`).send(body)).status, JSON.stringify(body)).toBe(400);
      }
      const ok = await s.patch(`/api/admin/customers/${guestCustomerId}`).send({ fullName: 'Guest Renamed' });
      expect(ok.status).toBe(200);
      expect(ok.body.data).toMatchObject({ fullName: 'Guest Renamed', accountType: 'GUEST' });
      const audit = await q(`SELECT 1 FROM audit_logs WHERE entity_type='customer' AND entity_id=$1 AND action='customer_updated'`, [guestCustomerId]);
      expect(audit.length).toBe(1);
    });

    it('unknown customer is a 404 and a non-uuid id is a 400', async () => {
      const s = await admin();
      expect((await s.agent.get(`/api/admin/customers/${NIL}`)).status).toBe(404);
      expect((await s.agent.get('/api/admin/customers/not-a-uuid')).status).toBe(400);
    });
  });

  describe('dashboard summary (§5.2)', () => {
    it('counts match the underlying queries', async () => {
      const s = await admin();
      const res = await s.agent.get('/api/admin/dashboard/summary');
      expect(res.status).toBe(200);
      const d = res.body.data;
      const count = async (where: string) => Number((await q(`SELECT count(*)::int AS n FROM orders o LEFT JOIN shipments sh ON sh.order_id=o.id WHERE ${where}`))[0].n);
      expect(d.totalOrders).toBe(await count('true'));
      expect(d.awaitingBkashVerification).toBe(
        await count(`o.payment_method='BKASH' AND o.payment_status='PENDING_VERIFICATION' AND o.order_status='PENDING_CONFIRMATION'`),
      );
      expect(d.codAwaitingConfirmation).toBe(await count(`o.order_status='COD_VERIFICATION_PENDING'`));
      expect(d.codCollectionDiscrepancies).toBe(
        await count(`o.payment_method='COD' AND o.order_status='DELIVERED' AND o.payment_status='PENDING_COLLECTION'`),
      );
      expect(d.staleUnconfirmed).toBe(
        await count(`o.order_status IN ('PENDING_CONFIRMATION','COD_VERIFICATION_PENDING') AND o.created_at < now() - interval '24 hours'`),
      );
    });

    it('rejects a malformed since and ignores a future one', async () => {
      const s = await admin();
      expect((await s.agent.get('/api/admin/dashboard/summary?since=notadate')).status).toBe(400);
      expect((await s.agent.get('/api/admin/dashboard/summary?since=2999-01-01T00:00:00Z')).status).toBe(200);
    });
  });
});
