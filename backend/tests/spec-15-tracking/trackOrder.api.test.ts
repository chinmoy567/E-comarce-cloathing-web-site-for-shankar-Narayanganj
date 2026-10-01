import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.ts';
import { applyTestEnv } from '../helpers/testEnv.ts';
import { resetEnvCache } from '../../src/config/env.ts';
import { makeSyncFakeAdapter, tracking } from './helpers/syncFakeAdapter.ts';

/**
 * Public Track Order (implementation spec 15, tests 7-9, 18, 19; 04-courier §4.14, §4.15, §4.16).
 *
 * Real HTTP and middleware, real services, real Postgres schema. Only the outbound provider is
 * replaced by a scriptable fake adapter.
 */
const SCHEMA = 'spec15_track';
const ADMIN_NOTE = 'ADMIN-ONLY-NOTE-do-not-leak';
const GENERIC = 'Tracking information could not be found. Please check your Order ID / Tracking ID and try again.';

const FOUND_KEYS = [
  'courierName', 'courierTrackingUrl', 'deliveryAreaSummary', 'estimatedDeliveryAt', 'events', 'found', 'shipmentStatus', 'trackingId',
];

describe.skipIf(!TEST_DATABASE_URL)('public Track Order (spec 15)', () => {
  let app: Express;
  let q: <T = any>(sql: string, params?: unknown[]) => Promise<T[]>;
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;
  let customerId: string;
  const fake = makeSyncFakeAdapter('trackfake');
  let seq = 0;

  async function orderWithShipment(
    status: string | null,
    opts: { courier?: string; parcel?: string | null } = {},
  ): Promise<{ orderId: string; orderNumber: string; parcel: string | null }> {
    seq += 1;
    const orderNumber = `FBK-20261002-T${String(seq).padStart(5, '0')}`;
    const [o] = await q<{ id: string }>(
      `INSERT INTO orders (order_number, customer_id, payment_method, order_status, payment_status, subtotal, shipping_amount, total_amount,
                          full_name, phone_number, division, district, area_unit_type, area_unit_name, ward_unit_type, ward_unit_name, detailed_address,
                          internal_note, bkash_transaction_id)
       VALUES ($1,$2,'COD','PROCESSING','PENDING_COLLECTION',500,0,500,'Secret Name','01733333333','Dhaka','Dhaka','THANA','Dhanmondi','WARD','Ward 7','House 77 Secret Road',$3,$4)
       RETURNING id`,
      [orderNumber, customerId, ADMIN_NOTE, `TXN-SECRET-${seq}`],
    );
    let parcel: string | null = null;
    if (status) {
      parcel = opts.parcel === undefined ? `TEST-ONLY-TRK-${seq}` : opts.parcel;
      await q(`INSERT INTO shipments (order_id, shipment_status, courier, courier_order_id) VALUES ($1,$2,$3,$4)`, [o!.id, status, opts.courier ?? 'FAKETRACK', parcel]);
    }
    return { orderId: o!.id, orderNumber, parcel };
  }

  const track = (trackingId: unknown) => request(app).post('/api/track-order').send({ trackingId });

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    applyTestEnv();
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    process.env.RL_PUBLIC_CEILING_MAX = '100000';
    process.env.RL_TRACK_ORDER_MAX = '100000';
    process.env.RL_GUEST_LOOKUP_MAX = '100000';
    resetEnvCache();

    const tx = await import('../../src/lib/transaction.js');
    resetTransactionPool = tx.resetTransactionPool;
    await tx.resetTransactionPool();
    q = (sql, params) => tx.withTransaction(async (c) => (await c.query(sql, params as any[])).rows);

    const { registerAdapter } = await import('../../src/services/courier/registry.js');
    registerAdapter(fake);
    const { createApp } = await import('../../src/app.js');
    app = createApp();

    await q(
      `INSERT INTO couriers (code, name, adapter_key, display_order, tracking_url_template) VALUES
         ('FAKETRACK','Fake Track Courier','trackfake',100,'https://track.example.test/{trackingId}'),
         ('FAKEOTHER','Fake Other Courier','trackfake',110,NULL)`,
    );
    [{ id: customerId }] = (await q(
      `INSERT INTO customers (account_type, full_name, phone_number, division, district, area_unit_type, area_unit_name, ward_unit_type, ward_unit_name, detailed_address)
       VALUES ('REGISTERED','Reg','01733333333','Dhaka','Dhaka','THANA','Dhanmondi','WARD','Ward 7','House 77 Secret Road') RETURNING id`,
    )) as any;
  }, 90_000);

  afterAll(async () => {
    const { unregisterAdapter } = await import('../../src/services/courier/registry.js');
    unregisterAdapter();
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  beforeEach(() => fake.reset());

  describe('a valid courier id (§4.14.3, acceptance 8)', () => {
    it('returns the customer-safe model with an exact key set (test 8) — no order status, number, address, payment data or internal id', async () => {
      const { parcel } = await orderWithShipment('DELIVERED');
      const res = await track(parcel);
      expect(res.status).toBe(200);

      const data = res.body.data;
      expect(Object.keys(data).sort()).toEqual(FOUND_KEYS);
      expect(data).toMatchObject({
        found: true,
        trackingId: parcel,
        courierName: 'Fake Track Courier',
        shipmentStatus: 'DELIVERED',
        deliveryAreaSummary: 'Dhanmondi, Dhaka',
        courierTrackingUrl: `https://track.example.test/${parcel}`,
      });

      const serialized = JSON.stringify(res.body);
      for (const leaked of [ADMIN_NOTE, 'TXN-SECRET', 'Secret Name', 'House 77', '01733333333', 'FBK-2026', 'orderStatus', 'paymentStatus', 'PENDING_COLLECTION', 'PROCESSING', 'order_id', 'customer']) {
        expect(serialized).not.toContain(leaked);
      }
    });

    it('shows no order-status value anywhere in the payload (test 19, §4.14.6)', async () => {
      const { parcel } = await orderWithShipment('IN_TRANSIT');
      const body = JSON.stringify((await track(parcel)).body);
      for (const orderStatus of ['PENDING_CONFIRMATION', 'COD_VERIFICATION_PENDING', 'CONFIRMED', 'PROCESSING', 'CANCELLED']) {
        expect(body).not.toContain(orderStatus);
      }
    });

    it('serves recorded shipment transitions as events when the courier gave none — never an invented one', async () => {
      const { orderId, parcel } = await orderWithShipment('IN_TRANSIT');
      await q(
        `INSERT INTO order_status_history (order_id, status_field, previous_status, new_status, actor_type) VALUES
           ($1,'shipment_status','CREATED','SHIPPED','USER'), ($1,'shipment_status','SHIPPED','IN_TRANSIT','SYSTEM')`,
        [orderId],
      );
      fake.state.trackThrows = true; // the courier gave no events, so only our own recorded transitions exist
      const { events } = (await track(parcel)).body.data;
      expect(events.map((e: { status: string }) => e.status)).toEqual(['SHIPPED', 'IN_TRANSIT']);
      expect(events.every((e: { occurredAt: string | null }) => typeof e.occurredAt === 'string')).toBe(true);
    });

    it('only an https:// tracking link is ever returned', async () => {
      const { parcel } = await orderWithShipment('SHIPPED', { courier: 'FAKEOTHER' });
      expect((await track(parcel)).body.data.courierTrackingUrl).toBeNull();
    });
  });

  describe('non-enumeration (test 7, acceptance 9; §4.16)', () => {
    it('unknown, not-yet-created, creation-failed, colliding and malformed-but-valid-shaped ids are byte-identical', async () => {
      const notCreated = await orderWithShipment('NOT_CREATED', { parcel: null });
      const creating = await orderWithShipment('CREATING', { parcel: null });
      const failed = await orderWithShipment('CREATION_FAILED', { parcel: null });
      const collisionA = await orderWithShipment('IN_TRANSIT', { parcel: 'TEST-ONLY-COLLIDE' });
      const collisionB = await orderWithShipment('IN_TRANSIT', { parcel: 'TEST-ONLY-COLLIDE', courier: 'FAKEOTHER' });
      expect([notCreated, creating, failed, collisionA, collisionB].length).toBe(5);

      const probes = ['TEST-ONLY-NOSUCH-1', 'zzzz-9999', 'abcd', 'TEST-ONLY-COLLIDE', 'A_B-C_D-1234567890'];
      const responses = await Promise.all(probes.map((p) => track(p)));
      for (const r of responses) {
        expect(r.status).toBe(200);
        expect(r.body).toEqual({ data: { found: false, reason: 'GENERIC', message: GENERIC } });
      }
      const bytes = new Set(responses.map((r) => r.text));
      expect(bytes.size).toBe(1);
    });

    it("another order's parcel id looked up with a store order number is still the generic response (§4.15: not interchangeable)", async () => {
      const a = await orderWithShipment('IN_TRANSIT');
      const b = await orderWithShipment('IN_TRANSIT');
      const res = await track(a.orderNumber); // a store number whose order HAS a shipment
      expect(res.body.data).toEqual({ found: false, reason: 'GENERIC', message: GENERIC });
      expect(b.parcel).toBeTruthy();
    });
  });

  describe('no fabricated tracking (test 9, §4.14.4, acceptance 10)', () => {
    it('a real store Order Number with no shipment gets the honest "not available yet" message, not a tracking result', async () => {
      const { orderNumber } = await orderWithShipment(null);
      const res = await track(orderNumber);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ found: false, reason: 'NOT_AVAILABLE_YET' });
      expect(res.body.data.message).toMatch(/not available yet/i);
      expect(res.body.data).not.toHaveProperty('trackingId');
      expect(res.body.data).not.toHaveProperty('events');
      expect(res.body.data).not.toHaveProperty('courierName');
    });

    it('also for a shipment still in creation, and the lowercase form of the number', async () => {
      const { orderNumber } = await orderWithShipment('CREATING', { parcel: null });
      const res = await track(orderNumber.toLowerCase());
      expect(res.body.data.reason).toBe('NOT_AVAILABLE_YET');
    });

    it('an order-number-shaped value for an order that does not exist is the generic response', async () => {
      const res = await track('FBK-20261002-ZZZZZZ');
      expect(res.body.data).toEqual({ found: false, reason: 'GENERIC', message: GENERIC });
    });
  });

  describe('input validation before any lookup (§4.16)', () => {
    it.each([
      ['too short', 'abc'],
      ['too long', 'a'.repeat(65)],
      ['illegal characters', "TRK-12'; DROP TABLE shipments;--"],
      ['whitespace inside', 'TRK 12345'],
      ['empty', ''],
      ['not a string', 12345],
    ])('rejects %s with 400 VALIDATION_ERROR', async (_label, value) => {
      const res = await track(value);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects unknown fields (.strict()) and is POST-only', async () => {
      expect((await request(app).post('/api/track-order').send({ trackingId: 'TRK-1234', extra: 1 })).status).toBe(400);
      expect((await request(app).get('/api/track-order')).status).toBe(404);
    });
  });

  describe('courier refresh is cached (test 18, acceptance 24)', () => {
    it('two lookups inside the TTL produce at most one provider call, and a refresh applies the new status through the applier', async () => {
      const { orderId, parcel } = await orderWithShipment('SHIPPED');
      fake.state.trackResult = tracking('IN_TRANSIT', { estimatedDeliveryAt: '2026-10-05T00:00:00.000Z' });

      const first = await track(parcel);
      const second = await track(parcel);

      expect(fake.state.tracks.filter((p) => p === parcel)).toHaveLength(1);
      expect(first.body.data.shipmentStatus).toBe('IN_TRANSIT');
      expect(second.body.data.shipmentStatus).toBe('IN_TRANSIT');
      expect(first.body.data.estimatedDeliveryAt).toBe('2026-10-05T00:00:00.000Z');
      expect(first.body.data.events).toEqual([
        { status: 'IN_TRANSIT', occurredAt: '2026-10-01T10:00:00.000Z', description: 'Parcel status: IN_TRANSIT' },
      ]);

      const history = await q(`SELECT new_status, actor_type FROM order_status_history WHERE order_id=$1 AND status_field='shipment_status'`, [orderId]);
      expect(history).toEqual([{ new_status: 'IN_TRANSIT', actor_type: 'SYSTEM' }]);
    });

    it('concurrent lookups still produce a single provider call', async () => {
      const { parcel } = await orderWithShipment('SHIPPED');
      fake.state.trackResult = tracking('SHIPPED');
      await Promise.all([track(parcel), track(parcel), track(parcel), track(parcel)]);
      expect(fake.state.tracks.filter((p) => p === parcel)).toHaveLength(1);
    });

    it('a provider failure still returns the stored model and changes nothing internal', async () => {
      const { orderId, parcel } = await orderWithShipment('SHIPPED');
      fake.state.trackThrows = true;
      const res = await track(parcel);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ found: true, shipmentStatus: 'SHIPPED' });
      expect((await q(`SELECT shipment_status FROM shipments WHERE order_id=$1`, [orderId]))[0].shipment_status).toBe('SHIPPED');
    });

    it('does not call the courier for a shipment that is already terminal', async () => {
      const { parcel } = await orderWithShipment('DELIVERED');
      await track(parcel);
      expect(fake.state.tracks).toHaveLength(0);
    });
  });
});
