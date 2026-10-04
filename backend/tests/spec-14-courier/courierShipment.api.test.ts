import type { Express } from 'express';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.ts';
import { applyTestEnv } from '../helpers/testEnv.ts';
import { resetEnvCache } from '../../src/config/env.ts';
import { loginAsAdmin } from '../helpers/adminSession.ts';
import { SECRET_IN_RAW_ERROR, makeFakeCourierAdapter } from './helpers/fakeCourierAdapter.ts';

/**
 * Courier abstraction and shipment creation (implementation spec 14, tests 1-9,
 * 13-17 and acceptance 1-21; 04-courier §4.2-§4.5, §4.9, §4.11, §4.15;
 * 05-admin §5.6; 06-rbac §5.16/§5.18; 07 §5.21.4-§5.21.7, §5.21.11).
 *
 * Real HTTP, real middleware, real permission layer, real shipment/order services
 * and real Postgres schema. Only the outbound provider is replaced, by a scriptable
 * fake CourierAdapter registered through registerAdapter() with `couriers` rows
 * inserted by SQL. Real Pathao/Steadfast adapters do not exist yet, so tests 11
 * (status normalization), 18 (provider address mapping) and the SSRF half of 16
 * are deferred; tests 10 and 12 live in courierAdapter.contract.test.ts.
 *
 * Adaptation: spec 12's transitionShipmentStatus()/status_sequence do not exist;
 * the legacy shipment service + order_status_history/audit_logs rows are asserted.
 */
const SCHEMA = 'spec14_courier';
const PW = 'CourierApiPass12';
const NIL = '00000000-0000-0000-0000-000000000000';
const SECRET_ENV = {
  PATHAO_CLIENT_SECRET: 'TEST-ONLY-PATHAO-SECRET-7c1d',
  STEADFAST_API_KEY: 'TEST-ONLY-STEADFAST-KEY-52be',
};

type PayMethod = 'BKASH' | 'COD';

describe.skipIf(!TEST_DATABASE_URL)('courier abstraction and shipment creation (spec 14)', () => {
  let app: Express;
  let q: <T = any>(sql: string, params?: unknown[]) => Promise<T[]>;
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;
  let permissionsRepository: typeof import('../../src/repositories/permissions.repository.js');
  let adminId: string;
  let managerId: string;
  let customerId: string;
  let productId: string;
  let weightedProductId: string;
  let variantId: string;
  const fake = makeFakeCourierAdapter('fake');
  const fake2 = makeFakeCourierAdapter('fake2', { withReferenceLookup: true });

  async function newOrder(
    opts: {
      method?: PayMethod;
      orderStatus?: string;
      paymentStatus?: string;
      subtotal?: number;
      shipping?: number;
      discount?: number;
      total?: number;
      product?: string;
      qty?: number;
    } = {},
  ): Promise<string> {
    const method = opts.method ?? 'COD';
    const orderStatus = opts.orderStatus ?? 'CONFIRMED';
    const paymentStatus = opts.paymentStatus ?? (method === 'COD' ? 'PENDING_COLLECTION' : 'PAID_VERIFIED');
    const subtotal = opts.subtotal ?? 500;
    const shipping = opts.shipping ?? 0;
    const discount = opts.discount ?? 0;
    const total = opts.total ?? subtotal + shipping - discount;
    const num = `S${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    const [o] = await q<{ id: string }>(
      // discount_amount goes in the same INSERT: the 0018 total CHECK (total = subtotal - discount + shipping) applies per statement.
      `INSERT INTO orders (order_number, customer_id, payment_method, order_status, payment_status, subtotal, shipping_amount, total_amount,
                          discount_amount, full_name, phone_number, division, district, area_unit_type, area_unit_name, ward_unit_type, ward_unit_name,
                          detailed_address, postal_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Order Tester','01711111111','Dhaka','Dhaka','THANA','Dhanmondi','WARD','Ward 1','House 1, Road 1','1209')
       RETURNING id`,
      [num, customerId, method, orderStatus, paymentStatus, subtotal, shipping, total, discount > 0 ? discount : null],
    );
    if (discount > 0) {
      await q(`UPDATE orders SET coupon_code='SAVE10', discount_type='PERCENTAGE', discount_amount=$2, eligible_subtotal=$3 WHERE id=$1`, [
        o!.id,
        discount,
        subtotal,
      ]);
    }
    await q(
      `INSERT INTO order_items (order_id, product_id, product_variant_id, product_name, unit_price, quantity, line_total)
       VALUES ($1,$2,$3,'Cotton Panjabi',500,$4,500)`,
      [o!.id, opts.product ?? productId, variantId, opts.qty ?? 1],
    );
    return o!.id;
  }

  /** An order that already has a shipment row in `status` (as legacy/raw writers produce). */
  async function orderWithShipment(
    status: string,
    opts: Parameters<typeof newOrder>[0] & { courier?: string; courierOrderId?: string } = {},
  ): Promise<string> {
    const id = await newOrder({ orderStatus: 'PROCESSING', ...opts });
    const courier = opts.courier ?? (status === 'NOT_CREATED' ? null : 'FAKECOURIER');
    const courierOrderId = ['CREATED', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED', 'RETURNED'].includes(status)
      ? (opts.courierOrderId ?? `TEST-ONLY-RAW-${Math.random().toString(36).slice(2, 8)}`)
      : null;
    await q(
      `INSERT INTO shipments (order_id, shipment_status, courier, courier_order_id, courier_error, courier_error_at, last_error_courier)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, status, courier, courierOrderId, status === 'CREATION_FAILED' ? 'Earlier failure' : null, status === 'CREATION_FAILED' ? new Date() : null, status === 'CREATION_FAILED' ? courier : null],
    );
    return id;
  }

  const order = async (id: string) => (await q(`SELECT * FROM orders WHERE id=$1`, [id]))[0];
  const ship = async (id: string) => (await q(`SELECT * FROM shipments WHERE order_id=$1`, [id]))[0] ?? null;
  const shipStatus = async (id: string) => (await ship(id))?.shipment_status ?? 'NOT_CREATED';
  const shipHistory = (id: string) =>
    q(`SELECT previous_status, new_status, actor_user_id, actor_type FROM order_status_history WHERE order_id=$1 AND status_field='shipment_status' ORDER BY created_at, id`, [id]);
  const statusHistory = (id: string, field: 'order_status' | 'payment_status') =>
    q(`SELECT previous_status, new_status FROM order_status_history WHERE order_id=$1 AND status_field=$2 ORDER BY created_at, id`, [id, field]);
  const allCreates = () => fake.state.creates.length + fake2.state.creates.length;

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    applyTestEnv();
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    process.env.RL_PUBLIC_CEILING_MAX = '100000';
    process.env.RL_AUTHENTICATED_CEILING_MAX = '100000';
    Object.assign(process.env, SECRET_ENV);
    resetEnvCache();

    const tx = await import('../../src/lib/transaction.js');
    resetTransactionPool = tx.resetTransactionPool;
    await tx.resetTransactionPool();
    q = (sql, params) => tx.withTransaction(async (c) => (await c.query(sql, params as any[])).rows);

    const { registerAdapter } = await import('../../src/services/courier/registry.js');
    registerAdapter(fake);
    registerAdapter(fake2);

    const { hashPassword } = await import('../../src/lib/password.js');
    const users = await import('../../src/repositories/users.repository.js');
    permissionsRepository = await import('../../src/repositories/permissions.repository.js');
    const passwordHash = await hashPassword(PW);
    adminId = (await users.create({ role: 'ADMIN', userIdentifier: 'c-admin', passwordHash, mustChangePassword: false })).id;
    managerId = (await users.create({ role: 'MANAGER', userIdentifier: 'c-mgr', passwordHash, mustChangePassword: false })).id;

    const { createApp } = await import('../../src/app.js');
    app = createApp();

    await q(
      `INSERT INTO couriers (code, name, adapter_key, display_order, supports_cancel, supports_reference_lookup) VALUES
         ('FAKECOURIER',  'Fake Courier One', 'fake',  100, true,  false),
         ('FAKECOURIER2', 'Fake Courier Two', 'fake2', 110, true,  true),
         ('FAKENOCANCEL', 'Fake No-Cancel',   'fake',  120, false, false)`,
    );
    await q(`INSERT INTO couriers (code, name, adapter_key, display_order, is_enabled) VALUES ('FAKEDISABLED','Fake Disabled','fake',130,false)`);

    [{ id: customerId }] = (await q(
      `INSERT INTO customers (account_type, full_name, phone_number, division, district, area_unit_type, area_unit_name, ward_unit_type, ward_unit_name, detailed_address)
       VALUES ('REGISTERED','Reg Customer','01711111111','Dhaka','Dhaka','THANA','Dhanmondi','WARD','Ward 1','House 1, Road 1') RETURNING id`,
    )) as any;
    const [{ id: catId }] = (await q(`INSERT INTO categories (name, slug, status) VALUES ('C','c-c','ACTIVE') RETURNING id`)) as any;
    [{ id: productId }] = (await q(`INSERT INTO products (category_id, name, slug, base_price, status) VALUES ($1,'P','p-c',500,'ACTIVE') RETURNING id`, [catId])) as any;
    [{ id: weightedProductId }] = (await q(
      `INSERT INTO products (category_id, name, slug, base_price, status, weight_grams) VALUES ($1,'PW','pw-c',500,'ACTIVE',300) RETURNING id`,
      [catId],
    )) as any;
    [{ id: variantId }] = (await q(
      `INSERT INTO product_variants (product_id, sku, price, stock_quantity, is_active) VALUES ($1,'C-SKU',500,1000,true) RETURNING id`,
      [productId],
    )) as any;
  }, 90_000);

  afterAll(async () => {
    for (const k of Object.keys(SECRET_ENV)) delete process.env[k];
    const { unregisterAdapter } = await import('../../src/services/courier/registry.js');
    unregisterAdapter();
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  beforeEach(async () => {
    fake.reset();
    fake2.reset();
    await q(`UPDATE couriers SET is_enabled = (code <> 'FAKEDISABLED') WHERE code LIKE 'FAKE%'`);
    await q(`UPDATE couriers SET supports_cancel = (code <> 'FAKENOCANCEL') WHERE code LIKE 'FAKE%'`);
  });

  const admin = () => loginAsAdmin(app, 'c-admin', PW);
  const manager = () => loginAsAdmin(app, 'c-mgr', PW);
  const url = (id: string, tail = '') => `/api/admin/orders/${id}/shipment${tail}`;

  /** Default-granted (Yes-tier) keys cannot be revoked per account, so flip the catalogue row in this throwaway schema. */
  async function withManagerTier(key: string, tier: 'NO' | 'YES', fn: () => Promise<void>): Promise<void> {
    // A catalogue flip must never land in `public` should a pooled connection ever lose its scoped search_path.
    const scoped = async (sql: string, params: unknown[]) => {
      const tx = await import('../../src/lib/transaction.js');
      return tx.withTransaction(async (c) => {
        const cs = (await c.query(`SELECT current_schema() AS s`)).rows[0].s;
        if (cs !== SCHEMA) throw new Error(`refusing to write: connection is on schema ${cs}, expected ${SCHEMA}`);
        return (await c.query(sql, params)).rows;
      });
    };
    const before = (await scoped(`SELECT manager_tier FROM permissions WHERE key=$1`, [key]))[0].manager_tier;
    await scoped(`UPDATE permissions SET manager_tier=$2 WHERE key=$1`, [key, tier]);
    try {
      await fn();
    } finally {
      await scoped(`UPDATE permissions SET manager_tier=$2 WHERE key=$1`, [key, before]);
    }
  }

  // ---------------------------------------------------------------------------
  describe('concurrent creation guard (§4.11; spec 14 tests 1, acceptance 5-6)', () => {
    it('a second create while the first is CREATING is 409 SHIPMENT_CREATION_IN_PROGRESS and the adapter is called once', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD' });
      const gate = fake.arm();
      const first = s.post(url(id)).send({ courierCode: 'FAKECOURIER' }).then((r) => r);
      await gate.entered;

      expect(await shipStatus(id)).toBe('CREATING'); // the lock is a committed row value, visible mid-call
      const second = await s.post(url(id)).send({ courierCode: 'FAKECOURIER' });
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('SHIPMENT_CREATION_IN_PROGRESS');

      gate.release();
      const res = await first;
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('CREATED');
      expect(fake.state.creates).toHaveLength(1);
      expect((await q(`SELECT 1 FROM shipments WHERE order_id=$1`, [id])).length).toBe(1);
    });

    it('sends the order\'s delivery instructions to the courier, and null when there are none', async () => {
      const s = await admin();
      const withNote = await newOrder({ method: 'COD' });
      await q(`UPDATE orders SET delivery_instructions='Call before delivery' WHERE id=$1`, [withNote]);
      expect((await s.post(url(withNote)).send({ courierCode: 'FAKECOURIER' })).status).toBe(200);
      expect(fake.state.creates.at(-1)?.deliveryInstructions).toBe('Call before delivery');

      const without = await newOrder({ method: 'COD' });
      expect((await s.post(url(without)).send({ courierCode: 'FAKECOURIER' })).status).toBe(200);
      expect(fake.state.creates.at(-1)?.deliveryInstructions).toBeNull();
    });

    it('two truly simultaneous creates: exactly one adapter call, one shipment row, one 200 and one 409', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD' });
      const [a, b] = await Promise.all([
        s.post(url(id)).send({ courierCode: 'FAKECOURIER' }),
        s.post(url(id)).send({ courierCode: 'FAKECOURIER' }),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const loser = a.status === 409 ? a : b;
      expect(['SHIPMENT_CREATION_IN_PROGRESS', 'SHIPMENT_ALREADY_EXISTS']).toContain(loser.body.error.code);
      expect(fake.state.creates).toHaveLength(1);
      expect(await q(`SELECT 1 FROM shipments WHERE order_id=$1`, [id])).toHaveLength(1);
      expect(await q(`SELECT 1 FROM courier_requests cr JOIN shipments s ON s.id=cr.shipment_id WHERE s.order_id=$1 AND cr.operation='CREATE'`, [id])).toHaveLength(1);
      expect(await shipStatus(id)).toBe('CREATED');
    });

    it('a shipment already CREATING (another process) rejects create, retry and change-courier without any adapter call', async () => {
      const s = await admin();
      const id = await orderWithShipment('CREATING');
      for (const [tail, body] of [
        ['', { courierCode: 'FAKECOURIER' }],
        ['/retry', {}],
        ['/change-courier', { courierCode: 'FAKECOURIER2' }],
      ] as const) {
        const res = await s.post(url(id, tail)).send(body);
        expect(res.status, tail).toBe(409);
        expect(res.body.error.code, tail).toBe('SHIPMENT_CREATION_IN_PROGRESS');
      }
      expect(allCreates()).toBe(0);
      expect(await shipStatus(id)).toBe('CREATING');
    });
  });

  describe('create from an existing parcel (spec 14 test 2, acceptance 7)', () => {
    it.each(['CREATED', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED', 'RETURNED'])(
      'create from %s is 409 SHIPMENT_ALREADY_EXISTS, no adapter call, shipment untouched',
      async (status) => {
        const s = await admin();
        const id = await orderWithShipment(status);
        const before = await ship(id);
        const res = await s.post(url(id)).send({ courierCode: 'FAKECOURIER' });
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('SHIPMENT_ALREADY_EXISTS');
        expect(allCreates()).toBe(0);
        const after = await ship(id);
        expect(after.shipment_status).toBe(status);
        expect(after.courier_order_id).toBe(before.courier_order_id);
        expect(await shipHistory(id)).toHaveLength(0);
      },
    );
  });

  describe('failure handling (§3.5, §4.11, §5.6, §5.21.5; spec 14 tests 3-4, 7, acceptance 8-9)', () => {
    it('adapter failure: 502 COURIER_REQUEST_FAILED, shipment CREATION_FAILED with error+timestamp+courier, order and payment unchanged', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'BKASH', orderStatus: 'CONFIRMED', paymentStatus: 'PAID_VERIFIED' });
      fake.state.createMode = 'fail';
      const res = await s.post(url(id)).send({ courierCode: 'FAKECOURIER' });

      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe('COURIER_REQUEST_FAILED');
      expect(res.body.error.message).toBe('Delivery zone is not serviceable.');

      const sh = await ship(id);
      expect(sh).toMatchObject({
        shipment_status: 'CREATION_FAILED',
        courier: 'FAKECOURIER',
        courier_error: 'Delivery zone is not serviceable.',
        last_error_courier: 'FAKECOURIER',
        courier_order_id: null,
        shipped_at: null,
      });
      expect(sh.courier_error_at).not.toBeNull();

      // Status independence (§5.21.11): no cascade into payment or order status, no history rows for them.
      expect(await order(id)).toMatchObject({ order_status: 'CONFIRMED', payment_status: 'PAID_VERIFIED' });
      expect(await statusHistory(id, 'order_status')).toHaveLength(0);
      expect(await statusHistory(id, 'payment_status')).toHaveLength(0);
      expect((await shipHistory(id)).map((h: any) => `${h.previous_status}>${h.new_status}`)).toEqual([
        'NOT_CREATED>CREATING',
        'CREATING>CREATION_FAILED',
      ]);

      const view = await s.agent.get(url(id));
      expect(view.body.data).toMatchObject({
        status: 'CREATION_FAILED',
        lastError: 'Delivery zone is not serviceable.',
        lastErrorCourier: 'FAKECOURIER',
        retryMayDuplicate: true,
      });
      expect(view.body.data.lastErrorAt).not.toBeNull();
    });

    it('a COD order that fails creation stays CONFIRMED with payment PENDING_COLLECTION', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD', orderStatus: 'CONFIRMED' });
      fake.state.createMode = 'fail';
      expect((await s.post(url(id)).send({ courierCode: 'FAKECOURIER' })).status).toBe(502);
      expect(await order(id)).toMatchObject({ order_status: 'CONFIRMED', payment_status: 'PENDING_COLLECTION' });
    });

    it('a simulated timeout makes exactly one adapter call and one CREATE audit row: no automatic retry (§4.11)', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD' });
      fake.state.createMode = 'timeout';
      const res = await s.post(url(id)).send({ courierCode: 'FAKECOURIER' });
      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe('COURIER_REQUEST_FAILED');
      expect(fake.state.creates).toHaveLength(1);
      expect(fake.state.finds).toHaveLength(0);
      const rows = await q(`SELECT cr.operation, cr.succeeded FROM courier_requests cr JOIN shipments s ON s.id=cr.shipment_id WHERE s.order_id=$1`, [id]);
      expect(rows).toEqual([{ operation: 'CREATE', succeeded: false }]);
      expect(await shipStatus(id)).toBe('CREATION_FAILED');
    });

    it('SHIPPED is unreachable after a failed creation: mark-shipped is 409 INVALID_TRANSITION (§4.11, §5.6)', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD' });
      fake.state.createMode = 'fail';
      await s.post(url(id)).send({ courierCode: 'FAKECOURIER' });
      const res = await s.post(url(id, '/mark-shipped')).send({});
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_TRANSITION');
      const sh = await ship(id);
      expect(sh.shipment_status).toBe('CREATION_FAILED');
      expect(sh.shipped_at).toBeNull();
    });
  });

  describe('retry (§4.11, §5.21.5; spec 14 test 5, acceptance 10)', () => {
    it('retry from CREATION_FAILED reuses the failed courier and succeeds', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD' });
      fake.state.createMode = 'fail';
      await s.post(url(id)).send({ courierCode: 'FAKECOURIER' });
      fake.state.createMode = 'ok';
      const res = await s.post(url(id, '/retry')).send({});
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ status: 'CREATED', courierCode: 'FAKECOURIER', lastError: null });
      expect(fake.state.creates).toHaveLength(2);
      expect((await shipHistory(id)).map((h: any) => `${h.previous_status}>${h.new_status}`)).toEqual([
        'NOT_CREATED>CREATING',
        'CREATING>CREATION_FAILED',
        'CREATION_FAILED>CREATING',
        'CREATING>CREATED',
      ]);
    });

    it('retry with no shipment row yet is 409 INVALID_TRANSITION', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD' });
      const res = await s.post(url(id, '/retry')).send({});
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_TRANSITION');
      expect(allCreates()).toBe(0);
    });

    it.each(['NOT_CREATED', 'CREATED', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED', 'RETURNED'])(
      'retry from %s is 409 INVALID_TRANSITION, no adapter call, state unchanged',
      async (status) => {
        const s = await admin();
        const id = await orderWithShipment(status);
        const res = await s.post(url(id, '/retry')).send({});
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('INVALID_TRANSITION');
        expect(allCreates()).toBe(0);
        expect(await shipStatus(id)).toBe(status);
      },
    );
  });

  describe('change courier (§4.11; spec 14 test 6, acceptance 11)', () => {
    it('from CREATION_FAILED, creates through the new courier and records the new courier_code', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD' });
      fake.state.createMode = 'fail';
      await s.post(url(id)).send({ courierCode: 'FAKECOURIER' });

      const res = await s.post(url(id, '/change-courier')).send({ courierCode: 'FAKECOURIER2' });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ status: 'CREATED', courierCode: 'FAKECOURIER2', courierName: 'Fake Courier Two', lastError: null });
      expect(fake.state.creates).toHaveLength(1); // the failed attempt only
      expect(fake2.state.creates).toHaveLength(1);
      expect((await ship(id)).courier).toBe('FAKECOURIER2');
    });

    it.each(['NOT_CREATED', 'CREATED', 'SHIPPED', 'DELIVERED'])('change-courier from %s is 409 INVALID_TRANSITION with no adapter call', async (status) => {
      const s = await admin();
      const id = await orderWithShipment(status);
      const res = await s.post(url(id, '/change-courier')).send({ courierCode: 'FAKECOURIER2' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_TRANSITION');
      expect(allCreates()).toBe(0);
      expect(await shipStatus(id)).toBe(status);
    });

    it('to an unknown or disabled courier is 400 COURIER_UNAVAILABLE and the shipment stays CREATION_FAILED', async () => {
      const s = await admin();
      const id = await orderWithShipment('CREATION_FAILED');
      for (const code of ['FAKEDISABLED', 'NOSUCHCOURIER']) {
        const res = await s.post(url(id, '/change-courier')).send({ courierCode: code });
        expect(res.status, code).toBe(400);
        expect(res.body.error.code, code).toBe('COURIER_UNAVAILABLE');
      }
      expect(allCreates()).toBe(0);
      expect(await shipStatus(id)).toBe('CREATION_FAILED');
    });
  });

  describe('mark as shipped (§5.21.9; spec 14 test 7, acceptance 12)', () => {
    it('CREATED -> SHIPPED stamps shipped_at, writes history/audit by the actor, and touches no other status', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD' });
      await s.post(url(id)).send({ courierCode: 'FAKECOURIER' });
      const orderBefore = await order(id);

      const res = await s.post(url(id, '/mark-shipped')).send({});
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('SHIPPED');
      expect(res.body.data.shippedAt).not.toBeNull();

      const orderAfter = await order(id);
      expect([orderAfter.order_status, orderAfter.payment_status]).toEqual([orderBefore.order_status, orderBefore.payment_status]);
      const last = (await shipHistory(id)).pop();
      expect(last).toMatchObject({ previous_status: 'CREATED', new_status: 'SHIPPED', actor_user_id: adminId, actor_type: 'USER' });
      const audit = await q(`SELECT * FROM audit_logs WHERE entity_type='order' AND entity_id=$1 AND action='shipment_status_change' AND new_value::text LIKE '%SHIPPED%'`, [id]);
      expect(audit).toHaveLength(1);
      expect(audit[0].actor_user_id).toBe(adminId);
    });

    it.each(['NOT_CREATED', 'CREATING', 'CREATION_FAILED', 'SHIPPED', 'DELIVERED'])('mark-shipped from %s is 409 INVALID_TRANSITION and writes nothing', async (status) => {
      const s = await admin();
      const id = await orderWithShipment(status);
      const res = await s.post(url(id, '/mark-shipped')).send({});
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_TRANSITION');
      const sh = await ship(id);
      expect(sh.shipment_status).toBe(status);
      expect(sh.shipped_at).toBeNull();
      expect(await shipHistory(id)).toHaveLength(0);
    });
  });

  describe('bKash gating vs COD (§4.3, §4.4; spec 14 test 8, acceptance 3)', () => {
    it.each([
      ['BKASH', 'CONFIRMED', 'PENDING_VERIFICATION', 'PAYMENT_NOT_VERIFIED'],
      ['BKASH', 'CONFIRMED', 'REJECTED', 'PAYMENT_NOT_VERIFIED'],
      ['BKASH', 'PROCESSING', 'PENDING_VERIFICATION', 'PAYMENT_NOT_VERIFIED'],
      ['BKASH', 'PENDING_CONFIRMATION', 'PENDING_VERIFICATION', 'ORDER_NOT_READY_FOR_SHIPMENT'],
      ['BKASH', 'PENDING_CONFIRMATION', 'PAID_VERIFIED', 'ORDER_NOT_READY_FOR_SHIPMENT'],
      ['BKASH', 'CANCELLED', 'PAID_VERIFIED', 'ORDER_NOT_READY_FOR_SHIPMENT'],
      ['COD', 'COD_VERIFICATION_PENDING', 'PENDING_COLLECTION', 'ORDER_NOT_READY_FOR_SHIPMENT'],
      ['COD', 'CANCELLED', 'PENDING_COLLECTION', 'ORDER_NOT_READY_FOR_SHIPMENT'],
      ['COD', 'DELIVERED', 'PAID_COLLECTED', 'ORDER_NOT_READY_FOR_SHIPMENT'],
    ] as const)('%s order %s / payment %s is 409 %s with no adapter call and no shipment', async (method, orderStatus, paymentStatus, code) => {
      const s = await admin();
      const id = await newOrder({ method, orderStatus, paymentStatus });
      const res = await s.post(url(id)).send({ courierCode: 'FAKECOURIER' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe(code);
      expect(allCreates()).toBe(0);
      expect(await shipStatus(id)).toBe('NOT_CREATED');
      expect(await shipHistory(id)).toHaveLength(0);
    });

    it.each([
      ['BKASH', 'CONFIRMED', 'PAID_VERIFIED'],
      ['BKASH', 'PROCESSING', 'PAID_VERIFIED'],
      ['COD', 'CONFIRMED', 'PENDING_COLLECTION'],
      ['COD', 'PROCESSING', 'PENDING_COLLECTION'],
    ] as const)('%s order %s / payment %s may create a shipment (COD needs no payment verification)', async (method, orderStatus, paymentStatus) => {
      const s = await admin();
      const id = await newOrder({ method, orderStatus, paymentStatus });
      const res = await s.post(url(id)).send({ courierCode: 'FAKECOURIER' });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('CREATED');
      expect(fake.state.creates).toHaveLength(1);
    });
  });

  describe('amounts and request mapping reach the courier (§4.2, §8.16b, §8.21; spec 14 test 9, acceptance 2, 4, 18)', () => {
    it('COD with a coupon: orderAmount and codAmount are the discounted total_amount, not the subtotal', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD', subtotal: 1000, shipping: 60, discount: 100 });
      expect(Number((await order(id)).total_amount)).toBe(960);
      expect((await s.post(url(id)).send({ courierCode: 'FAKECOURIER' })).status).toBe(200);
      const sent = fake.state.creates[0]!;
      expect(sent.orderAmount).toBe(960);
      expect(sent.codAmount).toBe(960);
      expect(Number((await ship(id)).cod_amount)).toBe(960);
    });

    it('prepaid bKash with a coupon: orderAmount is the discounted total and codAmount is 0', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'BKASH', subtotal: 1000, shipping: 60, discount: 100 });
      expect((await s.post(url(id)).send({ courierCode: 'FAKECOURIER' })).status).toBe(200);
      const sent = fake.state.creates[0]!;
      expect(sent.orderAmount).toBe(960);
      expect(sent.codAmount).toBe(0);
      expect(Number((await ship(id)).cod_amount)).toBe(0);
    });

    it('sends the order number as reference, both address discriminators, items, and the stored cod_amount/weight', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD', product: weightedProductId, qty: 2 });
      await s.post(url(id)).send({ courierCode: 'FAKECOURIER' });
      const sent = fake.state.creates[0]!;
      expect(sent.orderReference).toBe((await order(id)).order_number);
      expect(sent.recipient).toEqual({
        name: 'Order Tester',
        phone: '01711111111',
        division: 'Dhaka',
        district: 'Dhaka',
        areaUnitType: 'THANA',
        areaUnitName: 'Dhanmondi',
        wardUnitType: 'WARD',
        wardUnitName: 'Ward 1',
        detailedAddress: 'House 1, Road 1',
        postalCode: '1209',
      });
      expect(sent.items).toEqual([{ name: 'Cotton Panjabi', quantity: 2 }]);
      expect(sent.weightGrams).toBe(600); // 300 g x 2
      expect((await ship(id)).declared_weight_grams).toBe(600);
    });

    it('falls back to the default parcel weight (500 g) when a product has no weight', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD' });
      await s.post(url(id)).send({ courierCode: 'FAKECOURIER' });
      expect(fake.state.creates[0]!.weightGrams).toBe(500);
    });

    it('the stored courier id is never the store order number (§4.15, acceptance 21)', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD' });
      const res = await s.post(url(id)).send({ courierCode: 'FAKECOURIER' });
      expect(res.body.data.courierOrderId).toMatch(/^TEST-ONLY-FAKE-/);
      expect(res.body.data.courierOrderId).not.toBe((await order(id)).order_number);
    });

    it('an order missing its delivery address is 409 ORDER_NOT_READY_FOR_SHIPMENT and never reaches the courier', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD' });
      await q(`UPDATE orders SET division=NULL WHERE id=$1`, [id]);
      const res = await s.post(url(id)).send({ courierCode: 'FAKECOURIER' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ORDER_NOT_READY_FOR_SHIPMENT');
      expect(allCreates()).toBe(0);
    });
  });

  describe('order status on success (§5.21.4, §4.10; spec 14 acceptance 2, 13)', () => {
    it('a CONFIRMED order advances to PROCESSING in the same step, with history, and stays PROCESSING through SHIPPED', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD', orderStatus: 'CONFIRMED' });
      const res = await s.post(url(id)).send({ courierCode: 'FAKECOURIER' });
      expect(res.status).toBe(200);
      expect(await order(id)).toMatchObject({ order_status: 'PROCESSING', payment_status: 'PENDING_COLLECTION' });
      expect((await statusHistory(id, 'order_status')).map((h: any) => `${h.previous_status}>${h.new_status}`)).toEqual(['CONFIRMED>PROCESSING']);
      expect(await statusHistory(id, 'payment_status')).toHaveLength(0);
      expect((await shipHistory(id)).map((h: any) => `${h.previous_status}>${h.new_status}`)).toEqual(['NOT_CREATED>CREATING', 'CREATING>CREATED']);

      await s.post(url(id, '/mark-shipped')).send({});
      expect((await order(id)).order_status).toBe('PROCESSING');
    });

    it('an already PROCESSING order stays PROCESSING with no extra order-status history', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD', orderStatus: 'PROCESSING' });
      expect((await s.post(url(id)).send({ courierCode: 'FAKECOURIER' })).status).toBe(200);
      expect((await order(id)).order_status).toBe('PROCESSING');
      expect(await statusHistory(id, 'order_status')).toHaveLength(0);
    });

    it('stores courier_order_id, created_with_courier_at and writes the courier name on the view', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD' });
      const res = await s.post(url(id)).send({ courierCode: 'FAKECOURIER' });
      const sh = await ship(id);
      expect(sh.courier_order_id).toBe(res.body.data.courierOrderId);
      expect(sh.created_with_courier_at).not.toBeNull();
      expect(res.body.data).toMatchObject({ status: 'CREATED', courierCode: 'FAKECOURIER', courierName: 'Fake Courier One', codAmount: 500 });
    });
  });

  describe('registry is data-driven (§4.9; spec 14 test 13, acceptance 1)', () => {
    it('lists Pathao and Steadfast from the migration seed, enabled only, in display order, as exactly {code, name}', async () => {
      const s = await admin();
      const res = await s.agent.get('/api/admin/couriers');
      expect(res.status).toBe(200);
      const codes = res.body.data.map((c: any) => c.code);
      expect(codes.slice(0, 2)).toEqual(['PATHAO', 'STEADFAST']);
      expect(codes).toEqual(expect.arrayContaining(['FAKECOURIER', 'FAKECOURIER2', 'FAKENOCANCEL']));
      expect(codes).not.toContain('FAKEDISABLED');
      for (const c of res.body.data) expect(Object.keys(c).sort()).toEqual(['code', 'name']);
      const orders = (await q(`SELECT code FROM couriers WHERE is_enabled ORDER BY display_order, code`)).map((r: any) => r.code);
      expect(codes).toEqual(orders);
    });

    it('inserting a courier row makes it selectable with no code change; disabling it removes it and blocks creation', async () => {
      const s = await admin();
      await q(`INSERT INTO couriers (code, name, adapter_key, display_order) VALUES ('FAKETHIRD','Fake Third','fake',140)`);
      try {
        expect((await s.agent.get('/api/admin/couriers')).body.data.map((c: any) => c.code)).toContain('FAKETHIRD');
        const id = await newOrder({ method: 'COD' });
        const created = await s.post(url(id)).send({ courierCode: 'FAKETHIRD' });
        expect(created.status).toBe(200);
        expect(created.body.data.courierCode).toBe('FAKETHIRD');

        await q(`UPDATE couriers SET is_enabled=false WHERE code='FAKETHIRD'`);
        expect((await s.agent.get('/api/admin/couriers')).body.data.map((c: any) => c.code)).not.toContain('FAKETHIRD');
        fake.reset();
        const id2 = await newOrder({ method: 'COD' });
        const blocked = await s.post(url(id2)).send({ courierCode: 'FAKETHIRD' });
        expect(blocked.status).toBe(400);
        expect(blocked.body.error.code).toBe('COURIER_UNAVAILABLE');
        expect(fake.state.creates).toHaveLength(0);
        expect(await shipStatus(id2)).toBe('NOT_CREATED');
      } finally {
        await q(`DELETE FROM couriers WHERE code='FAKETHIRD' AND NOT EXISTS (SELECT 1 FROM shipments WHERE courier='FAKETHIRD')`);
      }
    });

    it('an unknown but well-formed courier code is 400 COURIER_UNAVAILABLE; a malformed or missing one is 400', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD' });
      const unknown = await s.post(url(id)).send({ courierCode: 'NOSUCHCOURIER' });
      expect(unknown.status).toBe(400);
      expect(unknown.body.error.code).toBe('COURIER_UNAVAILABLE');
      expect((await s.post(url(id)).send({ courierCode: 'pathao; drop' })).status).toBe(400);
      expect((await s.post(url(id)).send({})).status).toBe(400);
      expect(allCreates()).toBe(0);
    });
  });

  describe('cancellation port (§5.21.7; spec 14 test 14, acceptance 14-15)', () => {
    const cancel = async (id: string) => (await admin()).post(`/api/admin/orders/${id}/cancel`).send({ reason: 'customer asked to cancel' });

    it('courier refuses: 409 COURIER_CANCELLATION_FAILED with the reason, order and shipment unchanged, no history row', async () => {
      const id = await orderWithShipment('CREATED', { method: 'COD' });
      fake.state.cancelMode = 'refuse';
      const res = await cancel(id);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('COURIER_CANCELLATION_FAILED');
      expect(res.body.error.message).toBe('Parcel already picked up by the rider.');
      expect(fake.state.cancels).toHaveLength(1);
      expect((await order(id)).order_status).toBe('PROCESSING');
      expect((await ship(id)).cancelled_with_courier_at).toBeNull();
      expect(await statusHistory(id, 'order_status')).toHaveLength(0);
    });

    it('courier API error: 409 COURIER_CANCELLATION_FAILED and the order is unchanged', async () => {
      const id = await orderWithShipment('CREATED', { method: 'COD' });
      fake.state.cancelMode = 'throw';
      const res = await cancel(id);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('COURIER_CANCELLATION_FAILED');
      expect((await order(id)).order_status).toBe('PROCESSING');
    });

    it('courier cancels: the order becomes CANCELLED, the parcel is cancelled with that courier id, and it is audited', async () => {
      const id = await orderWithShipment('CREATED', { method: 'COD', courierOrderId: 'TEST-ONLY-TOCANCEL-1' });
      const res = await cancel(id);
      expect(res.status).toBe(200);
      expect(fake.state.cancels).toEqual(['TEST-ONLY-TOCANCEL-1']);
      expect((await order(id)).order_status).toBe('CANCELLED');
      expect((await ship(id)).cancelled_with_courier_at).not.toBeNull();
      const audit = await q(`SELECT actor_user_id FROM audit_logs WHERE entity_type='shipment' AND action='shipment_cancelled_with_courier'`);
      expect(audit.some((a: any) => a.actor_user_id === adminId)).toBe(true);
      expect((await q(`SELECT 1 FROM courier_requests WHERE operation='CANCEL' AND succeeded`)).length).toBeGreaterThan(0);
    });

    it('supports_cancel = false blocks the cancellation with a clear reason and never calls the adapter', async () => {
      const id = await orderWithShipment('CREATED', { method: 'COD', courier: 'FAKENOCANCEL' });
      const res = await cancel(id);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('COURIER_CANCELLATION_FAILED');
      expect(res.body.error.message).toContain('Fake No-Cancel');
      expect(res.body.error.message).toMatch(/does not support cancelling/);
      expect(fake.state.cancels).toHaveLength(0);
      expect((await order(id)).order_status).toBe('PROCESSING');
    });

    it.each(['SHIPPED', 'IN_TRANSIT'])('a %s shipment also goes through the courier cancel (parcel exists)', async (status) => {
      const id = await orderWithShipment(status, { method: 'COD' });
      fake.state.cancelMode = 'refuse';
      const res = await cancel(id);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('COURIER_CANCELLATION_FAILED');
      expect(fake.state.cancels).toHaveLength(1);
    });

    it.each(['NOT_CREATED', 'CREATION_FAILED'])('a %s shipment has no parcel: cancel succeeds without calling the courier', async (status) => {
      const id = await orderWithShipment(status, { method: 'COD' });
      expect((await cancel(id)).status).toBe(200);
      expect(fake.state.cancels).toHaveLength(0);
      expect((await order(id)).order_status).toBe('CANCELLED');
    });

    it('a shipment mid-creation blocks cancellation rather than racing the provider call', async () => {
      const id = await orderWithShipment('CREATING', { method: 'COD' });
      const res = await cancel(id);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('COURIER_CANCELLATION_FAILED');
      expect((await order(id)).order_status).toBe('PROCESSING');
    });

    it('an order whose cancellation the state machine rejects never reaches the courier', async () => {
      const id = await orderWithShipment('CREATED', { method: 'COD' });
      await q(`UPDATE orders SET order_status='DELIVERED' WHERE id=$1`, [id]);
      const res = await cancel(id);
      expect(res.status).toBe(409);
      expect(res.body.error.code).not.toBe('COURIER_CANCELLATION_FAILED');
      expect(fake.state.cancels).toHaveLength(0);
    });
  });

  describe('permissions (§5.16, §5.18; spec 14 test 15, acceptance 20)', () => {
    it('every new endpoint is 401 without a session', async () => {
      const { default: request } = await import('supertest');
      const calls: Array<[string, string]> = [
        ['get', '/api/admin/couriers'],
        ['get', `/api/admin/orders/${NIL}/shipment`],
        ['get', `/api/admin/orders/${NIL}/shipment/requests`],
        ['post', `/api/admin/orders/${NIL}/shipment`],
        ['post', `/api/admin/orders/${NIL}/shipment/retry`],
        ['post', `/api/admin/orders/${NIL}/shipment/change-courier`],
        ['post', `/api/admin/orders/${NIL}/shipment/mark-shipped`],
        ['get', '/api/admin/courier-config'],
        ['patch', '/api/admin/courier-config/FAKECOURIER'],
      ];
      for (const [verb, u] of calls) {
        expect((await (request(app) as any)[verb](u).send({})).status, u).toBe(401);
      }
    });

    it('a default Manager can list couriers and create a shipment, but courier.manage routes are 403 FORBIDDEN until granted', async () => {
      const s = await manager();
      expect((await s.agent.get('/api/admin/couriers')).status).toBe(200);
      const id = await newOrder({ method: 'COD' });
      expect((await s.post(url(id)).send({ courierCode: 'FAKECOURIER' })).status).toBe(200);

      const before = (await q(`SELECT is_enabled, display_order FROM couriers WHERE code='FAKECOURIER'`))[0];
      const list = await s.agent.get('/api/admin/courier-config');
      expect(list.status).toBe(403);
      expect(list.body.error.code).toBe('FORBIDDEN');
      const patch = await s.patch('/api/admin/courier-config/FAKECOURIER').send({ isEnabled: false });
      expect(patch.status).toBe(403);
      expect(patch.body.error.code).toBe('FORBIDDEN');
      expect((await q(`SELECT is_enabled, display_order FROM couriers WHERE code='FAKECOURIER'`))[0]).toEqual(before);

      await permissionsRepository.grant(managerId, 'courier.manage', adminId);
      try {
        const s2 = await manager();
        expect((await s2.agent.get('/api/admin/courier-config')).status).toBe(200);
        expect((await s2.patch('/api/admin/courier-config/FAKECOURIER').send({ displayOrder: 100 })).status).toBe(200);
      } finally {
        await permissionsRepository.revoke(managerId, 'courier.manage');
      }
    });

    type Case = { key: string; setup: () => Promise<string>; call: (s: Awaited<ReturnType<typeof manager>>, id: string) => Promise<any> };
    const cases: Array<[string, Case]> = [
      ['shipment.view blocks GET shipment', { key: 'shipment.view', setup: () => newOrder(), call: (s, id) => s.agent.get(url(id)) }],
      ['shipment.view blocks GET shipment/requests', { key: 'shipment.view', setup: () => newOrder(), call: (s, id) => s.agent.get(url(id, '/requests')) }],
      ['shipment.create blocks POST shipment', { key: 'shipment.create', setup: () => newOrder(), call: (s, id) => s.post(url(id)).send({ courierCode: 'FAKECOURIER' }) }],
      ['courier.select blocks POST shipment', { key: 'courier.select', setup: () => newOrder(), call: (s, id) => s.post(url(id)).send({ courierCode: 'FAKECOURIER' }) }],
      ['shipment.create blocks POST mark-shipped', { key: 'shipment.create', setup: () => orderWithShipment('CREATED'), call: (s, id) => s.post(url(id, '/mark-shipped')).send({}) }],
      ['shipment.retry blocks POST retry', { key: 'shipment.retry', setup: () => orderWithShipment('CREATION_FAILED'), call: (s, id) => s.post(url(id, '/retry')).send({}) }],
      ['shipment.courier.change blocks POST change-courier', { key: 'shipment.courier.change', setup: () => orderWithShipment('CREATION_FAILED'), call: (s, id) => s.post(url(id, '/change-courier')).send({ courierCode: 'FAKECOURIER2' }) }],
      ['courier.select blocks POST change-courier', { key: 'courier.select', setup: () => orderWithShipment('CREATION_FAILED'), call: (s, id) => s.post(url(id, '/change-courier')).send({ courierCode: 'FAKECOURIER2' }) }],
      ['courier.select blocks GET couriers', { key: 'courier.select', setup: () => newOrder(), call: (s) => s.agent.get('/api/admin/couriers') }],
    ];
    it.each(cases)('%s (403 FORBIDDEN, nothing changes) and the same call succeeds once the permission is back', async (_name, c) => {
      const id = await c.setup();
      const beforeStatus = await shipStatus(id);
      await withManagerTier(c.key, 'NO', async () => {
        const s = await manager();
        const res = await c.call(s, id);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
        expect(allCreates()).toBe(0);
        expect(await shipStatus(id)).toBe(beforeStatus);
      });
      const s2 = await manager();
      const ok = await c.call(s2, id);
      expect(ok.status).toBe(200);
    });

    it('revoking shipment.retry does not block create or change-courier (each permission is checked on its own route)', async () => {
      await withManagerTier('shipment.retry', 'NO', async () => {
        const s = await manager();
        const failed = await orderWithShipment('CREATION_FAILED');
        expect((await s.post(url(failed, '/change-courier')).send({ courierCode: 'FAKECOURIER2' })).status).toBe(200);
        const fresh = await newOrder();
        expect((await s.post(url(fresh)).send({ courierCode: 'FAKECOURIER' })).status).toBe(200);
        const failed2 = await orderWithShipment('CREATION_FAILED');
        expect((await s.post(url(failed2, '/retry')).send({})).status).toBe(403);
      });
    });
  });

  describe('input validation and tampered clients (§11.6, §4.2; acceptance 4)', () => {
    it.each([
      ['codAmount', { courierCode: 'FAKECOURIER', codAmount: 1 }],
      ['orderAmount', { courierCode: 'FAKECOURIER', orderAmount: 1 }],
      ['totalAmount', { courierCode: 'FAKECOURIER', totalAmount: 1 }],
      ['weightGrams', { courierCode: 'FAKECOURIER', weightGrams: 1 }],
      ['status', { courierCode: 'FAKECOURIER', status: 'SHIPPED' }],
      ['shipmentStatus', { courierCode: 'FAKECOURIER', shipment_status: 'SHIPPED' }],
      ['courierOrderId', { courierCode: 'FAKECOURIER', courierOrderId: 'X' }],
      ['now', { courierCode: 'FAKECOURIER', now: '2030-01-01T00:00:00Z' }],
    ])('create and change-courier reject a client-supplied %s with 400 and make no adapter call', async (_f, body) => {
      const s = await admin();
      const id = await newOrder({ method: 'COD' });
      const failed = await orderWithShipment('CREATION_FAILED');
      expect((await s.post(url(id)).send(body)).status).toBe(400);
      expect((await s.post(url(failed, '/change-courier')).send(body)).status).toBe(400);
      expect(allCreates()).toBe(0);
      expect(await shipStatus(id)).toBe('NOT_CREATED');
      expect(await shipStatus(failed)).toBe('CREATION_FAILED');
    });

    it('a malformed order id is 400 and an unknown order is 404', async () => {
      const s = await admin();
      expect((await s.agent.get('/api/admin/orders/not-a-uuid/shipment')).status).toBe(400);
      const res = await s.post(url(NIL)).send({ courierCode: 'FAKECOURIER' });
      expect(res.status).toBe(404);
    });

    it.each([
      ['unknown top-level field', { adapterKey: 'evil' }],
      ['secret-looking config key', { config: { apiKey: 'TEST-ONLY-SHOULD-NOT-STORE' } }],
      ['unknown config key', { config: { notDeclared: 'x' } }],
      ['config value of the wrong type', { config: { storeId: 123 } }],
      ['http:// tracking template', { trackingUrlTemplate: 'http://track.example.com/{trackingId}' }],
      ['tracking template with no placeholder', { trackingUrlTemplate: 'https://track.example.com/' }],
      ['tracking template with two placeholders', { trackingUrlTemplate: 'https://track.example.com/{trackingId}/{trackingId}' }],
      ['negative display order', { displayOrder: -1 }],
      ['non-boolean isEnabled', { isEnabled: 'yes' }],
      ['empty body', {}],
    ])('PATCH courier-config rejects %s with 400 and persists nothing', async (_n, body) => {
      const s = await admin();
      const before = (await q(`SELECT * FROM couriers WHERE code='FAKECOURIER'`))[0];
      const res = await s.patch('/api/admin/courier-config/FAKECOURIER').send(body);
      expect(res.status).toBe(400);
      expect((await q(`SELECT * FROM couriers WHERE code='FAKECOURIER'`))[0]).toEqual(before);
    });

    it('PATCH courier-config on an unknown courier is 404', async () => {
      const s = await admin();
      expect((await s.patch('/api/admin/courier-config/NOSUCHCOURIER').send({ isEnabled: true })).status).toBe(404);
    });

    it('PATCH courier-config applies allowed fields, merges non-secret config, and audits keys only', async () => {
      const s = await admin();
      const res = await s.patch('/api/admin/courier-config/FAKECOURIER2').send({
        displayOrder: 111,
        trackingUrlTemplate: 'https://track.example.com/{trackingId}',
        config: { storeId: 'STORE-77' },
      });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ code: 'FAKECOURIER2', displayOrder: 111, config: { storeId: 'STORE-77' } });
      const row = (await q(`SELECT display_order, tracking_url_template, config FROM couriers WHERE code='FAKECOURIER2'`))[0];
      expect(row).toMatchObject({ display_order: 111, tracking_url_template: 'https://track.example.com/{trackingId}', config: { storeId: 'STORE-77' } });
      const audit = await q(`SELECT * FROM audit_logs WHERE entity_type='courier' AND action='courier_config_update' ORDER BY created_at DESC LIMIT 1`);
      expect(audit[0].actor_user_id).toBe(adminId);
      expect(JSON.stringify(audit[0])).not.toContain('STORE-77');
      expect(audit[0].new_value.configKeys).toEqual(['storeId']);
    });

    it('the resolved tracking link is built server-side from the registry template', async () => {
      const s = await admin();
      await q(`UPDATE couriers SET tracking_url_template='https://track.example.com/t/{trackingId}' WHERE code='FAKECOURIER'`);
      try {
        const id = await newOrder({ method: 'COD' });
        const res = await s.post(url(id)).send({ courierCode: 'FAKECOURIER' });
        expect(res.body.data.trackingUrl).toBe(`https://track.example.com/t/${encodeURIComponent(res.body.data.courierOrderId)}`);
      } finally {
        await q(`UPDATE couriers SET tracking_url_template=NULL WHERE code='FAKECOURIER'`);
      }
    });
  });

  describe('responses and credentials (§4.8, §5.5, §11.9; spec 14 tests 12, 16, acceptance 16-17)', () => {
    const VIEW_KEYS = [
      'allowedActions', 'cancelledWithCourierAt', 'codAmount', 'courierCode', 'courierName', 'courierOrderId', 'createdWithCourierAt',
      'declaredWeightGrams', 'lastError', 'lastErrorAt', 'lastErrorCourier', 'retryMayDuplicate', 'shippedAt', 'status', 'trackingUrl',
    ];

    it('every shipment endpoint returns exactly the ShipmentView key set, with no raw provider data', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD' });
      const empty = await s.agent.get(url(id));
      expect(empty.body.data.status).toBe('NOT_CREATED');
      const created = await s.post(url(id)).send({ courierCode: 'FAKECOURIER' });
      const shipped = await s.post(url(id, '/mark-shipped')).send({});
      for (const res of [empty, created, shipped, await s.agent.get(url(id))]) {
        expect(res.status).toBe(200);
        expect(Object.keys(res.body.data).sort()).toEqual(VIEW_KEYS);
        expect(JSON.stringify(res.body)).not.toContain('TEST-ONLY-RAW-PROVIDER-REF');
        expect(JSON.stringify(res.body)).not.toContain('rawProviderReference');
      }
    });

    it('the NOT_CREATED view is permission-aware: a Manager and an Admin get CREATE_SHIPMENT; not-ready orders get none', async () => {
      const s = await admin();
      const ready = await newOrder({ method: 'COD' });
      expect((await s.agent.get(url(ready))).body.data.allowedActions).toEqual(['CREATE_SHIPMENT']);
      const notReady = await newOrder({ method: 'BKASH', orderStatus: 'CONFIRMED', paymentStatus: 'PENDING_VERIFICATION' });
      expect((await s.agent.get(url(notReady))).body.data.allowedActions).toEqual([]);
      const failed = await orderWithShipment('CREATION_FAILED');
      expect((await s.agent.get(url(failed))).body.data.allowedActions).toEqual(['RETRY_SHIPMENT', 'CHANGE_COURIER']);
      const created = await orderWithShipment('CREATED');
      expect((await s.agent.get(url(created))).body.data.allowedActions).toEqual(['MARK_SHIPPED']);
      const shipped = await orderWithShipment('SHIPPED');
      expect((await s.agent.get(url(shipped))).body.data.allowedActions).toEqual([]);
    });

    it('GET courier-config returns the exact CourierConfigView key set with a presence flag, never a credential value', async () => {
      const s = await admin();
      const res = await s.agent.get('/api/admin/courier-config');
      expect(res.status).toBe(200);
      for (const row of res.body.data) {
        expect(Object.keys(row).sort()).toEqual([
          'code', 'config', 'configSchema', 'credentialsConfigured', 'displayOrder', 'isEnabled', 'name', 'supportsCancel', 'supportsTracking', 'trackingUrlTemplate',
        ]);
      }
      const by = Object.fromEntries(res.body.data.map((r: any) => [r.code, r]));
      expect(by.FAKECOURIER.credentialsConfigured).toBe(true);
      expect(by.PATHAO.credentialsConfigured).toBe(false); // no adapter registered yet
      expect(by.FAKECOURIER.configSchema).toEqual([{ key: 'storeId', label: 'Store ID', type: 'string' }]);
    });

    it('no response, stored error or call-audit row contains a credential, even when the adapter leaks one in a raw error', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD' });
      fake.state.createMode = 'rawError';
      const failed = await s.post(url(id)).send({ courierCode: 'FAKECOURIER' });
      expect(failed.status).toBe(502);
      expect(failed.body.error.code).toBe('COURIER_REQUEST_FAILED');

      const bodies = [
        failed.body,
        (await s.agent.get(url(id))).body,
        (await s.agent.get(url(id, '/requests'))).body,
        (await s.agent.get('/api/admin/couriers')).body,
        (await s.agent.get('/api/admin/courier-config')).body,
      ];
      const dbText = JSON.stringify([
        await ship(id),
        await q(`SELECT * FROM courier_requests`),
        await q(`SELECT * FROM couriers`),
        await q(`SELECT * FROM audit_logs WHERE entity_id=$1`, [id]),
      ]);
      for (const secret of [SECRET_IN_RAW_ERROR, ...Object.values(SECRET_ENV)]) {
        for (const b of bodies) expect(JSON.stringify(b)).not.toContain(secret);
        expect(dbText).not.toContain(secret);
      }
      expect(failed.body.error.message).toBe('The courier could not complete the request. Please try again or choose another courier.');
    });

    it('no frontend source references a courier credential variable (acceptance 16)', () => {
      const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'frontend', 'src');
      const hits: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          if (statSync(full).isDirectory()) walk(full);
          else if (/\.(ts|tsx|js|jsx|json)$/.test(name) && /PATHAO_CLIENT_SECRET|STEADFAST_API_KEY|STEADFAST_SECRET_KEY|PATHAO_CLIENT_ID/.test(readFileSync(full, 'utf8'))) hits.push(full);
        }
      };
      walk(root);
      expect(hits).toEqual([]);
    });
  });

  describe('audit rows and call history without PII (§5.15 rule 10; spec 14 tests 17, acceptance 19)', () => {
    it('create writes shipment history + audit rows naming the actor, and a CREATE call row with a digest only', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD' });
      await s.post(url(id)).send({ courierCode: 'FAKECOURIER' });

      expect(await shipHistory(id)).toEqual([
        { previous_status: 'NOT_CREATED', new_status: 'CREATING', actor_user_id: adminId, actor_type: 'USER' },
        { previous_status: 'CREATING', new_status: 'CREATED', actor_user_id: adminId, actor_type: 'USER' },
      ]);
      const audit = await q(`SELECT previous_value, new_value, actor_user_id, actor_type FROM audit_logs WHERE entity_type='order' AND entity_id=$1 AND action='shipment_status_change' ORDER BY created_at, id`, [id]);
      expect(audit).toHaveLength(2);
      expect(audit.every((a: any) => a.actor_user_id === adminId && a.actor_type === 'USER')).toBe(true);

      const calls = await q(`SELECT cr.* FROM courier_requests cr JOIN shipments s ON s.id=cr.shipment_id WHERE s.order_id=$1`, [id]);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ operation: 'CREATE', courier_code: 'FAKECOURIER', succeeded: true, error_message: null });
      expect(calls[0].request_digest).toMatch(/^[0-9a-f]{64}$/);
      expect(calls[0].duration_ms).toBeGreaterThanOrEqual(0);
      const blob = JSON.stringify(calls);
      for (const pii of ['Order Tester', '01711111111', 'House 1', 'Dhanmondi', '1209', 'Cotton Panjabi']) expect(blob).not.toContain(pii);
    });

    it('a failed call is recorded with its outcome and sanitized message', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD' });
      fake.state.createMode = 'fail';
      await s.post(url(id)).send({ courierCode: 'FAKECOURIER' });
      const calls = await q(`SELECT cr.* FROM courier_requests cr JOIN shipments s ON s.id=cr.shipment_id WHERE s.order_id=$1`, [id]);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ operation: 'CREATE', succeeded: false, http_status: 422, error_message: 'Delivery zone is not serviceable.' });
    });

    it('GET shipment/requests is paginated and exposes only operation, outcome, status, duration, message, time', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD' });
      fake.state.createMode = 'fail';
      await s.post(url(id)).send({ courierCode: 'FAKECOURIER' });
      fake.state.createMode = 'ok';
      await s.post(url(id, '/retry')).send({});
      const res = await s.agent.get(url(id, '/requests?pageSize=1'));
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.pagination).toMatchObject({ page: 1, pageSize: 1, total: 2 });
      expect(Object.keys(res.body.data[0]).sort()).toEqual(['createdAt', 'durationMs', 'errorMessage', 'httpStatus', 'operation', 'succeeded']);
      expect((await s.agent.get(url(id, '/requests?pageSize=101'))).status).toBe(400);
      const none = await s.agent.get(url(await newOrder(), '/requests'));
      expect(none.body.data).toEqual([]);
    });
  });

  describe('reference lookup before retry (§4.11 ambiguous failure; spec 14 acceptance, open question 6)', () => {
    it('when the courier supports lookup and the parcel already exists, retry adopts it and makes NO second create call', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD' });
      fake2.state.createMode = 'timeout';
      expect((await s.post(url(id)).send({ courierCode: 'FAKECOURIER2' })).status).toBe(502);
      expect(fake2.state.finds).toHaveLength(0); // the first attempt never looks up
      expect((await s.agent.get(url(id))).body.data.retryMayDuplicate).toBe(false);

      fake2.state.createMode = 'ok';
      fake2.state.findResult = { courierOrderId: 'TEST-ONLY-EXISTING-PARCEL', trackingUrl: null, rawProviderReference: null };
      const res = await s.post(url(id, '/retry')).send({});
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ status: 'CREATED', courierOrderId: 'TEST-ONLY-EXISTING-PARCEL' });
      expect(fake2.state.creates).toHaveLength(1);
      expect(fake2.state.finds).toEqual([(await order(id)).order_number]);
      expect((await q(`SELECT 1 FROM courier_requests cr JOIN shipments s ON s.id=cr.shipment_id WHERE s.order_id=$1 AND cr.operation='DETAILS'`, [id])).length).toBe(1);
    });

    it('when the lookup finds nothing, retry creates the parcel', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD' });
      fake2.state.createMode = 'timeout';
      await s.post(url(id)).send({ courierCode: 'FAKECOURIER2' });
      fake2.state.createMode = 'ok';
      fake2.state.findResult = null;
      const res = await s.post(url(id, '/retry')).send({});
      expect(res.status).toBe(200);
      expect(fake2.state.finds).toHaveLength(1);
      expect(fake2.state.creates).toHaveLength(2);
    });

    it('a courier without lookup support is never looked up, and the view warns a retry may duplicate', async () => {
      const s = await admin();
      const id = await newOrder({ method: 'COD' });
      fake.state.createMode = 'timeout';
      await s.post(url(id)).send({ courierCode: 'FAKECOURIER' });
      expect((await s.agent.get(url(id))).body.data.retryMayDuplicate).toBe(true);
      fake.state.createMode = 'ok';
      expect((await s.post(url(id, '/retry')).send({})).status).toBe(200);
      expect(fake.state.creates).toHaveLength(2);
    });
  });

  describe('schema constraints (S3 raw SQL, migration 0014, §4.9, §4.15)', () => {
    it('couriers.code format CHECK rejects lowercase and over-long codes', async () => {
      await expect(q(`INSERT INTO couriers (code,name,adapter_key) VALUES ('lower','x','fake')`)).rejects.toMatchObject({ constraint: 'couriers_code_format' });
      await expect(q(`INSERT INTO couriers (code,name,adapter_key) VALUES ('A','x','fake')`)).rejects.toMatchObject({ constraint: 'couriers_code_format' });
    });

    it('courier_requests.operation CHECK rejects anything but CREATE/DETAILS/TRACK/CANCEL', async () => {
      await expect(
        q(`INSERT INTO courier_requests (courier_code, operation, request_digest, succeeded) VALUES ('FAKECOURIER','PUSH','d',true)`),
      ).rejects.toMatchObject({ constraint: 'courier_requests_operation_check' });
    });

    it('a new shipment cannot reference an unregistered courier (FK), and an order has one shipment (UNIQUE)', async () => {
      const id = await newOrder();
      await expect(q(`INSERT INTO shipments (order_id, shipment_status, courier) VALUES ($1,'NOT_CREATED','NOPE')`, [id])).rejects.toMatchObject({
        constraint: 'shipments_courier_fkey',
      });
      await q(`INSERT INTO shipments (order_id) VALUES ($1)`, [id]);
      await expect(q(`INSERT INTO shipments (order_id) VALUES ($1)`, [id])).rejects.toMatchObject({ code: '23505' });
    });
  });
});
