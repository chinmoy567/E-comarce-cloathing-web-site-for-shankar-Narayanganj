import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.ts';
import { applyTestEnv } from '../helpers/testEnv.ts';
import { resetEnvCache } from '../../src/config/env.ts';

/**
 * Guest order lookup and customer order history (implementation spec 15, tests 10-12, 14-17;
 * 02-customer §2.6, §2.9.5-§2.9.8; 04-courier §4.14.5; 07 §5.21.11).
 *
 * Real HTTP, real middleware, real services, real Postgres schema.
 */
const SCHEMA = 'spec15_lookup';
const PASSWORD = 'LookupPass12';
const ADMIN_NOTE = 'ADMIN-ONLY-NOTE-do-not-leak';
const GENERIC = 'We could not find an order matching those details.';

const GUEST_KEYS = [
  'amounts', 'appliedCouponCode', 'deliveryAddressSummary', 'found', 'items', 'orderNumber', 'orderStatus', 'paymentMethod',
  'paymentResubmissionAllowed', 'paymentStatus', 'placedAt', 'shipment', 'shipmentStatus', 'statusHistory',
];

describe.skipIf(!TEST_DATABASE_URL)('guest lookup and order history (spec 15)', () => {
  let app: Express;
  let q: <T = any>(sql: string, params?: unknown[]) => Promise<T[]>;
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;
  let productId: string;
  let variantId: string;
  let seq = 0;

  async function newOrder(
    customerId: string,
    opts: { phone?: string; method?: 'COD' | 'BKASH'; orderStatus?: string; paymentStatus?: string } = {},
  ): Promise<{ id: string; orderNumber: string; phone: string }> {
    seq += 1;
    const method = opts.method ?? 'COD';
    const phone = opts.phone ?? `0177000${String(seq).padStart(4, '0')}`;
    const orderNumber = `FBK-20261002-L${String(seq).padStart(5, '0')}`;
    const [o] = await q<{ id: string }>(
      `INSERT INTO orders (order_number, customer_id, payment_method, order_status, payment_status, subtotal, shipping_amount, discount_amount, coupon_code, discount_type, eligible_subtotal, total_amount,
                          full_name, phone_number, division, district, area_unit_type, area_unit_name, ward_unit_type, ward_unit_name, detailed_address,
                          internal_note, bkash_transaction_id)
       VALUES ($1,$2,$3,$4,$5,600,60,100,'SAVE100','PERCENTAGE',600,560,'Secret Name',$6,'Dhaka','Dhaka','THANA','Gulshan','WARD','Ward 5','House 99 Secret Lane',$7,$8)
       RETURNING id`,
      [
        orderNumber,
        customerId,
        method,
        opts.orderStatus ?? 'PENDING_CONFIRMATION',
        opts.paymentStatus ?? (method === 'COD' ? 'PENDING_COLLECTION' : 'PENDING_VERIFICATION'),
        phone,
        ADMIN_NOTE,
        `TXN-FULL-SECRET-ID-${seq}`,
      ],
    );
    await q(
      `INSERT INTO order_items (order_id, product_id, product_variant_id, product_name, variant_description, unit_price, quantity, line_total)
       VALUES ($1,$2,$3,'Cotton Panjabi','Size M / Blue',300,2,600)`,
      [o!.id, productId, variantId],
    );
    return { id: o!.id, orderNumber, phone };
  }

  async function guestCustomer(phone: string): Promise<string> {
    const [c] = await q<{ id: string }>(
      `INSERT INTO customers (account_type, full_name, phone_number, division, district, area_unit_type, area_unit_name, ward_unit_type, ward_unit_name, detailed_address)
       VALUES ('GUEST','Guest',$1,'Dhaka','Dhaka','THANA','Gulshan','WARD','Ward 5','House 99') RETURNING id`,
      [phone],
    );
    return c!.id;
  }

  async function registeredAgent(phone: string) {
    expect((await request(app).post('/api/customer/auth/register').send({ phone_number: phone, password: PASSWORD })).status).toBe(201);
    const agent = request.agent(app);
    expect((await agent.post('/api/customer/auth/login').send({ phone_number: phone, password: PASSWORD })).status).toBe(200);
    const [c] = await q<{ id: string }>(`SELECT id FROM customers WHERE phone_number=$1 AND account_type='REGISTERED'`, [phone]);
    return { agent, customerId: c!.id };
  }

  const lookup = (orderNumber: unknown, phoneNumber: unknown) => request(app).post('/api/orders/lookup').send({ orderNumber, phoneNumber });

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    applyTestEnv();
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    for (const k of ['RL_PUBLIC_CEILING_MAX', 'RL_GUEST_LOOKUP_MAX', 'RL_TRACK_ORDER_MAX', 'RL_CUSTOMER_LOGIN_MAX', 'RL_REGISTRATION_MAX']) {
      process.env[k] = '100000';
    }
    resetEnvCache();

    const tx = await import('../../src/lib/transaction.js');
    resetTransactionPool = tx.resetTransactionPool;
    await tx.resetTransactionPool();
    q = (sql, params) => tx.withTransaction(async (c) => (await c.query(sql, params as any[])).rows);
    const { createApp } = await import('../../src/app.js');
    app = createApp();

    const [{ id: catId }] = (await q(`INSERT INTO categories (name, slug, status) VALUES ('C','c-l','ACTIVE') RETURNING id`)) as any;
    [{ id: productId }] = (await q(`INSERT INTO products (category_id, name, slug, base_price, status) VALUES ($1,'P','p-l',300,'ACTIVE') RETURNING id`, [catId])) as any;
    [{ id: variantId }] = (await q(`INSERT INTO product_variants (product_id, sku, price, stock_quantity, is_active) VALUES ($1,'L-SKU',300,100,true) RETURNING id`, [productId])) as any;
  }, 90_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  describe('guest lookup requires the pair (test 10, §2.9.5)', () => {
    it('returns the §2.9.6 field set for a matching pair', async () => {
      const o = await newOrder(await guestCustomer('01770000001'), { phone: '01770000001' });
      const res = await lookup(o.orderNumber, '01770000001');
      expect(res.status).toBe(200);
      expect(Object.keys(res.body.data).sort()).toEqual(GUEST_KEYS);
      expect(res.body.data).toMatchObject({
        found: true,
        orderNumber: o.orderNumber,
        orderStatus: 'PENDING_CONFIRMATION',
        paymentStatus: 'PENDING_COLLECTION',
        shipmentStatus: 'NOT_CREATED',
        paymentMethod: 'COD',
        amounts: { subtotal: 600, discountAmount: 100, shippingAmount: 60, totalAmount: 560 },
        appliedCouponCode: 'SAVE100',
        deliveryAddressSummary: 'Gulshan, Dhaka, Dhaka',
        shipment: null,
        paymentResubmissionAllowed: false,
        items: [{ productName: 'Cotton Panjabi', variantLabel: 'Size M / Blue', quantity: 2, unitPrice: 300, lineTotal: 600 }],
      });
    });

    it('fails with an Order Number alone, a phone alone, or a mismatched pair', async () => {
      const o = await newOrder(await guestCustomer('01770000002'), { phone: '01770000002' });
      expect((await request(app).post('/api/orders/lookup').send({ orderNumber: o.orderNumber })).status).toBe(400);
      expect((await request(app).post('/api/orders/lookup').send({ phoneNumber: '01770000002' })).status).toBe(400);
      expect((await request(app).post('/api/orders/lookup').send({ orderNumber: o.orderNumber, phoneNumber: '' })).status).toBe(400);
      expect((await lookup(o.orderNumber, '01799999999')).body.data.found).toBe(false);
    });

    it('is POST-only and accepts no internal id or extra field (acceptance 17)', async () => {
      const o = await newOrder(await guestCustomer('01770000003'), { phone: '01770000003' });
      expect((await request(app).get('/api/orders/lookup').query({ orderNumber: o.orderNumber, phoneNumber: o.phone })).status).toBe(404);
      expect((await request(app).post('/api/orders/lookup').send({ orderNumber: o.orderNumber, phoneNumber: o.phone, orderId: o.id })).status).toBe(400);
      expect((await lookup(o.id, o.phone)).body.data).toEqual({ found: false, message: GENERIC });
    });
  });

  describe('non-enumeration (test 11, acceptance 12; §2.9.7)', () => {
    it('correct number + wrong phone, unknown number, and an unparseable phone are byte-identical', async () => {
      const o = await newOrder(await guestCustomer('01770000004'), { phone: '01770000004' });
      const responses = await Promise.all([
        lookup(o.orderNumber, '01799999999'),
        lookup('FBK-00000000-ZZZZZZ', '01770000004'),
        lookup('FBK-00000000-ZZZZZZ', '01799999999'),
        lookup(o.orderNumber, 'not-a-phone'),
      ]);
      for (const r of responses) {
        expect(r.status).toBe(200);
        expect(r.body).toEqual({ data: { found: false, message: GENERIC } });
      }
      expect(new Set(responses.map((r) => r.text)).size).toBe(1);
    });
  });

  describe('payload hygiene (test 12, acceptance 13; §2.9.6)', () => {
    it('never contains admin notes, risk data, payment proof, the Transaction ID, the full address or internal ids', async () => {
      const o = await newOrder(await guestCustomer('01770000005'), { phone: '01770000005', method: 'BKASH' });
      const body = JSON.stringify((await lookup(o.orderNumber, '01770000005')).body);
      for (const leaked of [ADMIN_NOTE, 'TXN-FULL-SECRET-ID', 'House 99', 'Secret Name', 'internal_note', 'bkash_transaction_id', 'risk', 'proof', 'screenshot', o.id, 'customer_id', 'idempotency']) {
        expect(body.toLowerCase()).not.toContain(leaked.toLowerCase());
      }
    });
  });

  describe('phone normalization (test 14, acceptance 14)', () => {
    it('+880…, 880… and 01… formatting variants all match the same order', async () => {
      const o = await newOrder(await guestCustomer('01770000006'), { phone: '01770000006' });
      for (const variant of ['01770000006', '+8801770000006', '8801770000006', ' 01770000006 ']) {
        const res = await lookup(o.orderNumber, variant);
        expect(res.body.data, `variant ${JSON.stringify(variant)}`).toMatchObject({ found: true, orderNumber: o.orderNumber });
      }
    });

    it('matches a lowercase order number', async () => {
      const o = await newOrder(await guestCustomer('01770000007'), { phone: '01770000007' });
      expect((await lookup(o.orderNumber.toLowerCase(), '01770000007')).body.data.found).toBe(true);
    });
  });

  describe('three independent statuses (test 17, acceptance 23; §5.21.11)', () => {
    it('presents order, payment and shipment status separately and never derives one from another', async () => {
      const o = await newOrder(await guestCustomer('01770000008'), { phone: '01770000008', orderStatus: 'DELIVERED', paymentStatus: 'PENDING_COLLECTION' });
      await q(`INSERT INTO shipments (order_id, shipment_status, courier, courier_order_id) VALUES ($1,'DELIVERED','PATHAO','TEST-ONLY-DEL-1')`, [o.id]);
      const d = (await lookup(o.orderNumber, '01770000008')).body.data;
      expect(d).toMatchObject({ orderStatus: 'DELIVERED', paymentStatus: 'PENDING_COLLECTION', shipmentStatus: 'DELIVERED' });
      expect(d.shipment).toMatchObject({ shipmentStatus: 'DELIVERED', trackingId: 'TEST-ONLY-DEL-1', courierName: 'Pathao' });
    });

    it('hides internal creation states: CREATING and CREATION_FAILED read as NOT_CREATED, with no shipment block or error text', async () => {
      const o = await newOrder(await guestCustomer('01770000009'), { phone: '01770000009' });
      await q(`INSERT INTO shipments (order_id, shipment_status, courier, courier_error, last_error_courier) VALUES ($1,'CREATION_FAILED','PATHAO','Zone not serviceable','PATHAO')`, [o.id]);
      await q(`INSERT INTO order_status_history (order_id, status_field, previous_status, new_status, actor_type) VALUES ($1,'shipment_status','CREATING','CREATION_FAILED','SYSTEM')`, [o.id]);
      const res = await lookup(o.orderNumber, '01770000009');
      expect(res.body.data).toMatchObject({ shipmentStatus: 'NOT_CREATED', shipment: null });
      expect(JSON.stringify(res.body)).not.toContain('Zone not serviceable');
      expect(res.body.data.statusHistory.some((e: { status: string }) => e.status === 'CREATION_FAILED')).toBe(false);
    });

    it('statusHistory carries only kind, status and time — no actor, reason, note or id', async () => {
      const o = await newOrder(await guestCustomer('01770000010'), { phone: '01770000010' });
      await q(
        `INSERT INTO order_status_history (order_id, status_field, previous_status, new_status, reason, actor_type) VALUES
           ($1,'order_status',NULL,'PENDING_CONFIRMATION','secret reason','SYSTEM'), ($1,'payment_status',NULL,'PENDING_COLLECTION',NULL,'SYSTEM')`,
        [o.id],
      );
      const { statusHistory } = (await lookup(o.orderNumber, '01770000010')).body.data;
      expect(statusHistory.length).toBeGreaterThanOrEqual(2);
      for (const e of statusHistory) expect(Object.keys(e).sort()).toEqual(['kind', 'occurredAt', 'status']);
      expect(JSON.stringify(statusHistory)).not.toContain('secret reason');
    });

    it('paymentResubmissionAllowed is derived: true only for a bKash order awaiting verification or rejected', async () => {
      const g = await guestCustomer('01770000011');
      const waiting = await newOrder(g, { phone: '01770000011', method: 'BKASH', paymentStatus: 'PENDING_VERIFICATION' });
      const rejected = await newOrder(g, { phone: '01770000011', method: 'BKASH', paymentStatus: 'REJECTED' });
      const paid = await newOrder(g, { phone: '01770000011', method: 'BKASH', paymentStatus: 'PAID_VERIFIED' });
      const cod = await newOrder(g, { phone: '01770000011', method: 'COD' });
      const allowed = async (o: { orderNumber: string }) => (await lookup(o.orderNumber, '01770000011')).body.data.paymentResubmissionAllowed;
      expect([await allowed(waiting), await allowed(rejected), await allowed(paid), await allowed(cod)]).toEqual([true, true, false, false]);
    });
  });

  describe('account order history (§2.6, §4.14.5)', () => {
    it('lists only the session customer\'s orders, by order number, with no internal ids (test 15)', async () => {
      const a = await registeredAgent('01780000001');
      const b = await registeredAgent('01780000002');
      const mine = await newOrder(a.customerId);
      const theirs = await newOrder(b.customerId);

      const res = await a.agent.get('/api/customer/orders');
      expect(res.status).toBe(200);
      const numbers = res.body.data.map((r: { orderNumber: string }) => r.orderNumber);
      expect(numbers).toContain(mine.orderNumber);
      expect(numbers).not.toContain(theirs.orderNumber);
      expect(Object.keys(res.body.data[0]).sort()).toEqual([
        'itemCount', 'orderNumber', 'orderStatus', 'paymentMethod', 'paymentStatus', 'placedAt', 'shipmentStatus', 'totalAmount',
      ]);
      expect(res.body.data[0].itemCount).toBe(2);
      expect(res.body.pagination).toMatchObject({ page: 1, total: 1 });
      expect(JSON.stringify(res.body)).not.toContain(mine.id);
    });

    it('detail is keyed by order number; another customer\'s order and a missing one are the same 404; an internal id is not accepted (acceptance 17, 18)', async () => {
      const a = await registeredAgent('01780000003');
      const b = await registeredAgent('01780000004');
      const theirs = await newOrder(b.customerId);

      const foreign = await a.agent.get(`/api/customer/orders/${theirs.orderNumber}`);
      const missing = await a.agent.get('/api/customer/orders/FBK-00000000-ZZZZZZ');
      const byUuid = await b.agent.get(`/api/customer/orders/${theirs.id}`);
      expect(foreign.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(foreign.body.error).toEqual(missing.body.error);
      expect(byUuid.status).toBe(404);
      expect((await request(app).get(`/api/customer/orders/${theirs.orderNumber}`)).status).toBe(401);
    });

    it('detail returns the owner\'s full delivery address and the same field set as the guest view (§4.7: one record)', async () => {
      const a = await registeredAgent('01780000005');
      const o = await newOrder(a.customerId, { phone: '01780000005' });
      const detail = (await a.agent.get(`/api/customer/orders/${o.orderNumber}`)).body.data;
      const guest = (await lookup(o.orderNumber, '01780000005')).body.data;

      expect(detail.deliveryAddress).toMatchObject({ fullName: 'Secret Name', detailedAddress: 'House 99 Secret Lane', areaUnitName: 'Gulshan' });
      const { deliveryAddress, trackOrder, ...shared } = detail;
      const { found, ...guestShared } = guest;
      expect(deliveryAddress).toBeDefined();
      expect(trackOrder).toBeDefined();
      expect(found).toBe(true);
      expect(shared).toEqual(guestShared);
      expect(JSON.stringify(detail)).not.toContain(ADMIN_NOTE);
      expect(JSON.stringify(detail)).not.toContain('TXN-FULL-SECRET-ID');
    });

    it('reports trackOrder.available false before a shipment exists and true with the tracking id after (acceptance 20)', async () => {
      const a = await registeredAgent('01780000006');
      const o = await newOrder(a.customerId, { phone: '01780000006' });
      expect((await a.agent.get(`/api/customer/orders/${o.orderNumber}`)).body.data.trackOrder).toEqual({ available: false, trackingId: null });

      await q(`INSERT INTO shipments (order_id, shipment_status, courier, courier_order_id) VALUES ($1,'IN_TRANSIT','PATHAO','TEST-ONLY-ACC-1')`, [o.id]);
      expect((await a.agent.get(`/api/customer/orders/${o.orderNumber}`)).body.data.trackOrder).toEqual({ available: true, trackingId: 'TEST-ONLY-ACC-1' });
    });

    it('history is scoped by customer_id, so a guest order attached to the customer record appears with no migration (test 16, acceptance 19)', async () => {
      const a = await registeredAgent('01780000007');
      const guestOrder = await newOrder(await guestCustomer('01790000007'), { phone: '01780000008' });
      expect((await a.agent.get('/api/customer/orders')).body.data).toHaveLength(0);

      // §2.9.8: the guest order and the registered account end up sharing one customer record.
      await q(`UPDATE orders SET customer_id=$2 WHERE id=$1`, [guestOrder.id, a.customerId]);
      const after = await a.agent.get('/api/customer/orders');
      expect(after.body.data.map((r: { orderNumber: string }) => r.orderNumber)).toEqual([guestOrder.orderNumber]);
    });

    it('paginates (mandatory pagination, §11.4)', async () => {
      const a = await registeredAgent('01780000009');
      for (let i = 0; i < 3; i += 1) await newOrder(a.customerId);
      const res = await a.agent.get('/api/customer/orders').query({ page: 2, pageSize: 2 });
      expect(res.body.data).toHaveLength(1);
      expect(res.body.pagination).toMatchObject({ page: 2, pageSize: 2, total: 3, totalPages: 2 });
    });
  });
});
