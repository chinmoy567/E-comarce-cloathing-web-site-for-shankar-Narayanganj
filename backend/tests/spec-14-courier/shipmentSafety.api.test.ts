import type { Express } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.ts';
import { applyTestEnv } from '../helpers/testEnv.ts';
import { resetEnvCache } from '../../src/config/env.ts';
import { loginAsAdmin } from '../helpers/adminSession.ts';
import { makeFakeCourierAdapter } from './helpers/fakeCourierAdapter.ts';

/**
 * Courier go-live safety (migration 0026; 04-courier §4.6, §4.11; 07 §5.21.5, §5.21.9):
 *  - a failure with no definite courier answer marks the outcome UNKNOWN and blocks a plain
 *    retry / change-courier until a person confirms no parcel exists (no silent duplicate);
 *  - an admin can link the parcel found in the courier panel instead, verified first;
 *  - an interrupted CREATING row is recovered to CREATION_FAILED (outcome unknown), and a
 *    late courier answer after that recovery is still recorded correctly;
 *  - courier-sync failures that will not fix themselves are flagged, transient ones are not;
 *  - dashboard counters and the order-list filters behind them agree.
 * Real HTTP, middleware, permission layer, services and Postgres; only the courier is faked.
 */
const SCHEMA = 'spec14_safety';
const PW = 'CourierSafetyPass12';

describe.skipIf(!TEST_DATABASE_URL)('courier go-live safety (spec 14, 0026)', () => {
  let app: Express;
  let q: <T = any>(sql: string, params?: unknown[]) => Promise<T[]>;
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;
  let shipmentService: typeof import('../../src/services/shipment.service.js');
  let courierSync: typeof import('../../src/services/courierSync.service.js');
  let shipmentsRepository: typeof import('../../src/repositories/shipments.repository.js');
  let customerId: string;
  let productId: string;
  let variantId: string;
  const fake = makeFakeCourierAdapter('safefake');
  const lookup = makeFakeCourierAdapter('safelookup', { withReferenceLookup: true });

  async function newOrder(method: 'COD' | 'BKASH' = 'COD', orderStatus = 'CONFIRMED'): Promise<string> {
    const num = `F${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    const [o] = await q<{ id: string }>(
      `INSERT INTO orders (order_number, customer_id, payment_method, order_status, payment_status, subtotal, shipping_amount, total_amount,
                          full_name, phone_number, division, district, area_unit_type, area_unit_name, ward_unit_type, ward_unit_name,
                          detailed_address, postal_code)
       VALUES ($1,$2,$3,$4,$5,500,0,500,'Order Tester','01711111111','Dhaka','Dhaka','THANA','Dhanmondi','WARD','Ward 1','House 1, Road 1','1209')
       RETURNING id`,
      [num, customerId, method, orderStatus, method === 'COD' ? 'PENDING_COLLECTION' : 'PAID_VERIFIED'],
    );
    await q(
      `INSERT INTO order_items (order_id, product_id, product_variant_id, product_name, unit_price, quantity, line_total)
       VALUES ($1,$2,$3,'Cotton Panjabi',500,1,500)`,
      [o!.id, productId, variantId],
    );
    return o!.id;
  }

  const ship = async (id: string) => (await q(`SELECT * FROM shipments WHERE order_id=$1`, [id]))[0] ?? null;
  const orderRow = async (id: string) => (await q(`SELECT * FROM orders WHERE id=$1`, [id]))[0];
  const history = async (id: string) =>
    (await q<{ previous_status: string; new_status: string; actor_type: string }>(
      `SELECT previous_status, new_status, actor_type FROM order_status_history
        WHERE order_id=$1 AND status_field='shipment_status' ORDER BY created_at, id`,
      [id],
    )).map((h) => `${h.previous_status}>${h.new_status}:${h.actor_type}`);

  /** A shipment that failed with no definite courier answer. */
  async function unknownFailure(s: Awaited<ReturnType<typeof admin>>, courierCode = 'SAFEFAKE'): Promise<string> {
    const id = await newOrder();
    (courierCode === 'SAFEFAKE' ? fake : lookup).state.createMode = 'timeout';
    expect((await s.post(url(id)).send({ courierCode })).status).toBe(502);
    fake.state.createMode = 'ok';
    lookup.state.createMode = 'ok';
    // Forget the setup attempt, so each test counts only the courier calls it causes.
    fake.state.creates = [];
    lookup.state.creates = [];
    return id;
  }

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    applyTestEnv();
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    process.env.RL_PUBLIC_CEILING_MAX = '100000';
    process.env.RL_AUTHENTICATED_CEILING_MAX = '100000';
    process.env.SHIPMENT_CREATING_TIMEOUT_MINUTES = '10';
    process.env.STUCK_PARCEL_DAYS = '4';
    resetEnvCache();

    const tx = await import('../../src/lib/transaction.js');
    resetTransactionPool = tx.resetTransactionPool;
    await tx.resetTransactionPool();
    q = (sql, params) => tx.withTransaction(async (c) => (await c.query(sql, params as any[])).rows);

    const { registerAdapter } = await import('../../src/services/courier/registry.js');
    registerAdapter(fake);
    registerAdapter(lookup);
    shipmentService = await import('../../src/services/shipment.service.js');
    courierSync = await import('../../src/services/courierSync.service.js');
    shipmentsRepository = await import('../../src/repositories/shipments.repository.js');

    const { hashPassword } = await import('../../src/lib/password.js');
    const users = await import('../../src/repositories/users.repository.js');
    await users.create({ role: 'ADMIN', userIdentifier: 's-admin', passwordHash: await hashPassword(PW), mustChangePassword: false });

    const { createApp } = await import('../../src/app.js');
    app = createApp();

    await q(
      `INSERT INTO couriers (code, name, adapter_key, display_order, supports_cancel, supports_reference_lookup) VALUES
         ('SAFEFAKE',   'Safe Fake',   'safefake',   100, false, false),
         ('SAFELOOKUP', 'Safe Lookup', 'safelookup', 110, false, true)`,
    );
    [{ id: customerId }] = (await q(
      `INSERT INTO customers (account_type, full_name, phone_number, division, district, area_unit_type, area_unit_name, ward_unit_type, ward_unit_name, detailed_address)
       VALUES ('REGISTERED','Reg Customer','01711111111','Dhaka','Dhaka','THANA','Dhanmondi','WARD','Ward 1','House 1, Road 1') RETURNING id`,
    )) as any;
    const [{ id: catId }] = (await q(`INSERT INTO categories (name, slug, status) VALUES ('C','c-safe','ACTIVE') RETURNING id`)) as any;
    [{ id: productId }] = (await q(`INSERT INTO products (category_id, name, slug, base_price, status) VALUES ($1,'P','p-safe',500,'ACTIVE') RETURNING id`, [catId])) as any;
    [{ id: variantId }] = (await q(
      `INSERT INTO product_variants (product_id, sku, price, stock_quantity, is_active) VALUES ($1,'SAFE-SKU',500,1000,true) RETURNING id`,
      [productId],
    )) as any;
  }, 90_000);

  afterAll(async () => {
    const { unregisterAdapter } = await import('../../src/services/courier/registry.js');
    unregisterAdapter();
    delete process.env.SHIPMENT_CREATING_TIMEOUT_MINUTES;
    delete process.env.STUCK_PARCEL_DAYS;
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  beforeEach(() => {
    fake.reset();
    lookup.reset();
  });

  const admin = () => loginAsAdmin(app, 's-admin', PW);
  const url = (id: string, tail = '') => `/api/admin/orders/${id}/shipment${tail}`;

  // ---------------------------------------------------------------------------
  describe('outcome classification', () => {
    it('no answer (timeout): outcome UNKNOWN, retryMayDuplicate, and Link parcel is offered', async () => {
      const s = await admin();
      const id = await unknownFailure(s);
      expect((await ship(id)).creation_outcome_unknown).toBe(true);
      const view = (await s.agent.get(url(id))).body.data;
      expect(view).toMatchObject({ status: 'CREATION_FAILED', outcomeUnknown: true, retryMayDuplicate: true });
      expect(view.allowedActions).toContain('LINK_EXISTING_PARCEL');
    });

    it('a definite rejection (4xx): outcome known, retry needs no confirmation', async () => {
      const s = await admin();
      const id = await newOrder();
      fake.state.createMode = 'fail';
      await s.post(url(id)).send({ courierCode: 'SAFEFAKE' });
      expect((await ship(id)).creation_outcome_unknown).toBe(false);
      expect((await s.agent.get(url(id))).body.data).toMatchObject({ outcomeUnknown: false, retryMayDuplicate: false });
      fake.state.createMode = 'ok';
      expect((await s.post(url(id, '/retry')).send({})).status).toBe(200);
    });

    it('an unexpected exception inside the adapter counts as UNKNOWN', async () => {
      const s = await admin();
      const id = await newOrder();
      fake.state.createMode = 'rawError';
      await s.post(url(id)).send({ courierCode: 'SAFEFAKE' });
      expect((await ship(id)).creation_outcome_unknown).toBe(true);
    });
  });

  describe('no silent duplicate parcel (§4.11)', () => {
    it('retry after an unknown outcome is 409 PARCEL_MAY_EXIST with NO courier call; confirmed, it creates once', async () => {
      const s = await admin();
      const id = await unknownFailure(s);
      for (const body of [{}, { confirmNoExistingParcel: false }]) {
        const res = await s.post(url(id, '/retry')).send(body);
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('PARCEL_MAY_EXIST');
      }
      expect(fake.state.creates).toHaveLength(0);
      expect((await ship(id)).shipment_status).toBe('CREATION_FAILED');

      const ok = await s.post(url(id, '/retry')).send({ confirmNoExistingParcel: true });
      expect(ok.status).toBe(200);
      expect(ok.body.data).toMatchObject({ status: 'CREATED', outcomeUnknown: false, retryMayDuplicate: false });
      expect(fake.state.creates).toHaveLength(1);
    });

    it('change-courier after an unknown outcome is guarded the same way', async () => {
      const s = await admin();
      const id = await unknownFailure(s);
      const blocked = await s.post(url(id, '/change-courier')).send({ courierCode: 'SAFELOOKUP' });
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.code).toBe('PARCEL_MAY_EXIST');
      expect(lookup.state.creates).toHaveLength(0);
      const ok = await s.post(url(id, '/change-courier')).send({ courierCode: 'SAFELOOKUP', confirmNoExistingParcel: true });
      expect(ok.status).toBe(200);
      expect(ok.body.data.courierCode).toBe('SAFELOOKUP');
    });

    it('a courier that supports lookup by order number needs no confirmation (it checks itself)', async () => {
      const s = await admin();
      const id = await unknownFailure(s, 'SAFELOOKUP');
      expect((await s.agent.get(url(id))).body.data.retryMayDuplicate).toBe(false);
      const res = await s.post(url(id, '/retry')).send({});
      expect(res.status).toBe(200);
      expect(lookup.state.finds).toHaveLength(1);
    });

    it('the confirmation flag is strictly a boolean', async () => {
      const s = await admin();
      const id = await unknownFailure(s);
      expect((await s.post(url(id, '/retry')).send({ confirmNoExistingParcel: 'yes' })).status).toBe(400);
      expect((await s.post(url(id, '/retry')).send({ somethingElse: true })).status).toBe(400);
      expect(fake.state.creates).toHaveLength(0);
    });
  });

  describe('link an existing parcel', () => {
    it('verifies with the courier, then CREATION_FAILED → CREATING → CREATED, order CONFIRMED → PROCESSING, no create call', async () => {
      const s = await admin();
      const id = await unknownFailure(s);
      fake.state.merchantReference = (await orderRow(id)).order_number;
      const res = await s.post(url(id, '/link')).send({ courierOrderId: '  DL1212TESTONLY  ' });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ status: 'CREATED', courierOrderId: 'DL1212TESTONLY', outcomeUnknown: false, lastError: null });
      expect(fake.state.tracks).toEqual(['DL1212TESTONLY']);
      expect(fake.state.creates).toHaveLength(0);
      expect((await orderRow(id)).order_status).toBe('PROCESSING');
      expect((await history(id)).slice(-2)).toEqual(['CREATION_FAILED>CREATING:USER', 'CREATING>CREATED:USER']);
    });

    it('a parcel the courier reports for a DIFFERENT order is refused, and the failure state is restored exactly', async () => {
      const s = await admin();
      const id = await unknownFailure(s);
      const before = await ship(id);
      fake.state.merchantReference = 'FSOMEONEELSE';
      const res = await s.post(url(id, '/link')).send({ courierOrderId: 'DL1212WRONGONE' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PARCEL_ORDER_MISMATCH');
      const after = await ship(id);
      expect(after).toMatchObject({
        shipment_status: 'CREATION_FAILED',
        courier_order_id: null,
        creation_outcome_unknown: true,
        courier_error: before.courier_error,
      });
      expect((await orderRow(id)).order_status).toBe('CONFIRMED');
    });

    it('an id the courier cannot find is refused (PARCEL_NOT_VERIFIED) and nothing is linked', async () => {
      const s = await admin();
      const id = await unknownFailure(s);
      fake.state.trackMode = 'notFound';
      const res = await s.post(url(id, '/link')).send({ courierOrderId: 'DL1212NOTREAL' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PARCEL_NOT_VERIFIED');
      expect((await ship(id))).toMatchObject({ shipment_status: 'CREATION_FAILED', courier_order_id: null });
    });

    it('a parcel whose status is merely unmapped still links (the parcel exists)', async () => {
      const s = await admin();
      const id = await unknownFailure(s);
      fake.state.trackMode = 'unrecognized';
      expect((await s.post(url(id, '/link')).send({ courierOrderId: 'DL1212ODDSTATE' })).status).toBe(200);
      expect((await ship(id)).shipment_status).toBe('CREATED');
    });

    it('one consignment id can never be linked to two orders', async () => {
      const s = await admin();
      const a = await unknownFailure(s);
      const b = await unknownFailure(s);
      expect((await s.post(url(a, '/link')).send({ courierOrderId: 'DL1212SHARED' })).status).toBe(200);
      const res = await s.post(url(b, '/link')).send({ courierOrderId: 'DL1212SHARED' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PARCEL_ALREADY_LINKED');
      expect((await ship(b)).shipment_status).toBe('CREATION_FAILED');
    });

    it('rejects a malformed id, a missing session, and any state other than CREATION_FAILED', async () => {
      const s = await admin();
      const id = await unknownFailure(s);
      for (const bad of ['', 'ab', 'DL 12 12', 'DL<script>', 'x'.repeat(65)]) {
        expect((await s.post(url(id, '/link')).send({ courierOrderId: bad })).status, bad).toBe(400);
      }
      const { default: request } = await import('supertest');
      expect((await request(app).post(url(id, '/link')).send({ courierOrderId: 'DL1212NOSESSION' })).status).toBe(401);

      const fresh = await newOrder();
      const res = await s.post(url(fresh, '/link')).send({ courierOrderId: 'DL1212FRESH' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_TRANSITION');
      expect(fake.state.tracks).toHaveLength(0);
    });
  });

  describe('interrupted creation recovery', () => {
    async function stuckCreating(minutesAgo: number): Promise<string> {
      const id = await newOrder();
      await q(
        `INSERT INTO shipments (order_id, shipment_status, courier, creating_started_at)
         VALUES ($1,'CREATING','SAFEFAKE', now() - make_interval(mins => $2))`,
        [id, minutesAgo],
      );
      return id;
    }

    it('a CREATING row past the limit becomes CREATION_FAILED, outcome unknown, by SYSTEM; a fresh one is untouched', async () => {
      const old = await stuckCreating(30);
      const fresh = await stuckCreating(1);
      expect(await shipmentService.recoverStuckCreations()).toBeGreaterThanOrEqual(1);
      expect(await ship(old)).toMatchObject({ shipment_status: 'CREATION_FAILED', creation_outcome_unknown: true, last_error_courier: 'SAFEFAKE' });
      expect((await ship(old)).courier_error).toMatch(/interrupted/i);
      expect(await history(old)).toEqual(['CREATING>CREATION_FAILED:SYSTEM']);
      expect((await ship(fresh)).shipment_status).toBe('CREATING');
      expect((await orderRow(old)).order_status).toBe('CONFIRMED'); // no order/payment cascade
    });

    it('opening the order recovers it immediately, without waiting for the poll job', async () => {
      const s = await admin();
      const id = await stuckCreating(45);
      const view = (await s.agent.get(url(id))).body.data;
      expect(view).toMatchObject({ status: 'CREATION_FAILED', outcomeUnknown: true, retryMayDuplicate: true });
      expect(fake.state.creates).toHaveLength(0);
    });

    it('while CREATING (not stale) a second create is still 409 and the view reports when it began', async () => {
      const s = await admin();
      const id = await stuckCreating(1);
      const view = (await s.agent.get(url(id))).body.data;
      expect(view.status).toBe('CREATING');
      expect(view.creatingSince).not.toBeNull();
      expect((await s.post(url(id, '/retry')).send({ confirmNoExistingParcel: true })).body.error.code).toBe('SHIPMENT_CREATION_IN_PROGRESS');
    });

    it('a courier SUCCESS that arrives after the row was recovered is still recorded (parcel is real)', async () => {
      const s = await admin();
      const id = await newOrder();
      const gate = fake.arm();
      const pending = s.post(url(id)).send({ courierCode: 'SAFEFAKE' }).then((r) => r);
      await gate.entered;
      // Simulate the sweep firing while this call is still in flight (limit 0 minutes = any CREATING row).
      await shipmentService.recoverStuckCreations(50, 0);
      expect((await ship(id)).shipment_status).toBe('CREATION_FAILED');
      gate.release();
      const res = await pending;
      expect(res.status).toBe(200);
      const row = await ship(id);
      expect(row).toMatchObject({ shipment_status: 'CREATED', creation_outcome_unknown: false });
      expect(row.courier_order_id).toMatch(/^TEST-ONLY-SAFEFAKE-/);
      expect(fake.state.creates).toHaveLength(1);
    });

    it('a courier REJECTION after recovery replaces the guess: outcome becomes known', async () => {
      const s = await admin();
      const id = await newOrder();
      fake.state.createMode = 'fail';
      const gate = fake.arm();
      const pending = s.post(url(id)).send({ courierCode: 'SAFEFAKE' }).then((r) => r);
      await gate.entered;
      // Simulate the sweep firing while this call is still in flight (limit 0 minutes = any CREATING row).
      await shipmentService.recoverStuckCreations(50, 0);
      gate.release();
      expect((await pending).status).toBe(502);
      expect(await ship(id)).toMatchObject({
        shipment_status: 'CREATION_FAILED',
        creation_outcome_unknown: false,
        courier_error: 'Delivery zone is not serviceable.',
      });
    });
  });

  describe('courier sync problems', () => {
    async function activeParcel(): Promise<{ id: string; shipmentId: string }> {
      const id = await newOrder('COD', 'PROCESSING');
      const [row] = await q<{ id: string }>(
        `INSERT INTO shipments (order_id, shipment_status, courier, courier_order_id)
         VALUES ($1,'SHIPPED','SAFEFAKE',$2) RETURNING id`,
        [id, `DLSYNC${Math.random().toString(36).slice(2, 8).toUpperCase()}`],
      );
      return { id, shipmentId: row!.id };
    }
    const refresh = async (shipmentId: string) => {
      await q(`UPDATE shipments SET last_synced_at = NULL WHERE id=$1`, [shipmentId]);
      const row = await shipmentsRepository.getShipmentById(shipmentId);
      return courierSync.refreshShipmentFromCourier(row!);
    };

    it('an unrecognized status is flagged, the status is NOT guessed, and a later good sync clears the flag', async () => {
      const s = await admin();
      const { id, shipmentId } = await activeParcel();
      fake.state.trackMode = 'unrecognized';
      await refresh(shipmentId);
      const flagged = await ship(id);
      expect(flagged.shipment_status).toBe('SHIPPED');
      expect(flagged.sync_problem).toMatch(/weird_status/);
      expect(flagged.sync_problem_at).not.toBeNull();
      expect((await s.agent.get(url(id))).body.data.syncProblem).toMatch(/does not recognise/);

      fake.state.trackMode = 'ok';
      await refresh(shipmentId);
      const cleared = await ship(id);
      expect(cleared.sync_problem).toBeNull();
      expect(cleared.shipment_status).toBe('IN_TRANSIT');
    });

    it('a parcel the courier cannot find (4xx) is flagged; a transient failure is NOT', async () => {
      const a = await activeParcel();
      fake.state.trackMode = 'notFound';
      await refresh(a.shipmentId);
      expect((await ship(a.id)).sync_problem).not.toBeNull();

      const b = await activeParcel();
      fake.state.trackMode = 'transient';
      await refresh(b.shipmentId);
      expect((await ship(b.id)).sync_problem).toBeNull();
    });
  });

  describe('dashboard counters agree with the list filters', () => {
    it('courier attention, parcels not moving, returned recently', async () => {
      const s = await admin();
      // Isolate this test's counts from earlier ones.
      await q(`UPDATE shipments SET sync_problem = NULL, sync_problem_at = NULL, status_changed_at = now()`);

      const attention = await newOrder('COD', 'PROCESSING');
      await q(`INSERT INTO shipments (order_id, shipment_status, courier, courier_order_id, sync_problem, sync_problem_at)
               VALUES ($1,'IN_TRANSIT','SAFEFAKE','DLATTN0001','Courier returned a status this platform does not recognise (x).', now())`, [attention]);
      const stuck = await newOrder('COD', 'PROCESSING');
      await q(`INSERT INTO shipments (order_id, shipment_status, courier, courier_order_id, status_changed_at)
               VALUES ($1,'SHIPPED','SAFEFAKE','DLSTUCK0001', now() - interval '6 days')`, [stuck]);
      const moving = await newOrder('COD', 'PROCESSING');
      await q(`INSERT INTO shipments (order_id, shipment_status, courier, courier_order_id, status_changed_at)
               VALUES ($1,'SHIPPED','SAFEFAKE','DLMOVE0001', now() - interval '1 day')`, [moving]);
      const returned = await newOrder('COD', 'RETURNED');
      await q(`INSERT INTO shipments (order_id, shipment_status, courier, courier_order_id, status_changed_at)
               VALUES ($1,'RETURNED','SAFEFAKE','DLRET0001', now() - interval '2 days')`, [returned]);

      const dash = (await s.agent.get('/api/admin/dashboard/summary')).body.data;
      const list = async (qs: string) =>
        ((await s.agent.get(`/api/admin/orders?${qs}&pageSize=100`)).body.data as Array<{ id: string }>).map((o) => o.id);

      const attentionIds = await list('courier_attention=true');
      expect(attentionIds).toEqual([attention]);
      expect(dash.courierSyncProblems).toBe(attentionIds.length);

      const stuckIds = await list('parcel_stuck=true');
      expect(stuckIds).toContain(stuck);
      expect(stuckIds).not.toContain(moving);
      expect(dash.stuckParcels).toBe(stuckIds.length);
      expect(dash.stuckParcelDays).toBe(4);

      const returnedIds = await list('returned_recently=true');
      expect(returnedIds).toContain(returned);
      expect(dash.returnedRecently).toBe(returnedIds.length);
    });
  });

  describe('schema (0026)', () => {
    it('the same consignment id cannot be stored twice for one courier', async () => {
      const a = await newOrder();
      const b = await newOrder();
      await q(`INSERT INTO shipments (order_id, shipment_status, courier, courier_order_id) VALUES ($1,'CREATED','SAFEFAKE','DLUNIQ0001')`, [a]);
      await expect(
        q(`INSERT INTO shipments (order_id, shipment_status, courier, courier_order_id) VALUES ($1,'CREATED','SAFEFAKE','DLUNIQ0001')`, [b]),
      ).rejects.toMatchObject({ code: '23505' });
    });

    it('every shipment transition stamps status_changed_at', async () => {
      const s = await admin();
      const id = await newOrder();
      await q(`INSERT INTO shipments (order_id, shipment_status, status_changed_at) VALUES ($1,'NOT_CREATED', now() - interval '9 days')`, [id]);
      await s.post(url(id)).send({ courierCode: 'SAFEFAKE' });
      const row = await ship(id);
      expect(Date.now() - new Date(row.status_changed_at).getTime()).toBeLessThan(60_000);
    });
  });
});
