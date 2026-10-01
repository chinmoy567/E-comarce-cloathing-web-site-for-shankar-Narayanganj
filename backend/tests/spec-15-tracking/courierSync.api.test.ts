import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.ts';
import { applyTestEnv } from '../helpers/testEnv.ts';
import { resetEnvCache } from '../../src/config/env.ts';
import { SIGNATURE_HEADER, makeSyncFakeAdapter, sign, tracking } from './helpers/syncFakeAdapter.ts';

/**
 * Courier status synchronization (implementation spec 15, tests 1-6; 04-courier §4.6;
 * 07 §5.21.4/§5.21.6/§5.21.9; 11-security §11.8).
 *
 * Real HTTP (the signed webhook route), the real idempotent applier, the real poller, the real
 * order/shipment services and a real Postgres schema. Only the outbound provider is replaced by a
 * scriptable fake CourierAdapter with its own TEST-ONLY signature scheme — real provider schemes
 * are deferred until their official documentation is consulted (CLAUDE.md §6).
 */
const SCHEMA = 'spec15_sync';
const COURIER = 'FAKESYNC';

describe.skipIf(!TEST_DATABASE_URL)('courier status sync (spec 15)', () => {
  let app: Express;
  let q: <T = any>(sql: string, params?: unknown[]) => Promise<T[]>;
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;
  let pollCourierStatuses: typeof import('../../src/services/courierSync.service.js').pollCourierStatuses;
  let customerId: string;
  let variantId: string;
  let productId: string;
  const fake = makeSyncFakeAdapter('syncfake');
  let seq = 0;

  /** An order (default PROCESSING / COD) with a shipment already in `status` at the fake courier. */
  async function shipmentOrder(
    status: string,
    opts: { orderStatus?: string; method?: 'COD' | 'BKASH'; qty?: number } = {},
  ): Promise<{ orderId: string; parcel: string }> {
    seq += 1;
    const method = opts.method ?? 'COD';
    const [o] = await q<{ id: string }>(
      `INSERT INTO orders (order_number, customer_id, payment_method, order_status, payment_status, subtotal, shipping_amount, total_amount,
                          full_name, phone_number, division, district, area_unit_type, area_unit_name, ward_unit_type, ward_unit_name, detailed_address)
       VALUES ($1,$2,$3,$4,$5,500,0,500,'Sync Tester','01711111111','Dhaka','Dhaka','THANA','Dhanmondi','WARD','Ward 1','House 1')
       RETURNING id`,
      [
        `FBK-20261001-S${String(seq).padStart(5, '0')}`,
        customerId,
        method,
        opts.orderStatus ?? 'PROCESSING',
        method === 'COD' ? 'PENDING_COLLECTION' : 'PAID_VERIFIED',
      ],
    );
    await q(
      `INSERT INTO order_items (order_id, product_id, product_variant_id, product_name, unit_price, quantity, line_total)
       VALUES ($1,$2,$3,'Cotton Panjabi',500,$4,500)`,
      [o!.id, productId, variantId, opts.qty ?? 1],
    );
    const parcel = `TEST-ONLY-PARCEL-${seq}`;
    await q(`INSERT INTO shipments (order_id, shipment_status, courier, courier_order_id) VALUES ($1,$2,$3,$4)`, [o!.id, status, COURIER, parcel]);
    return { orderId: o!.id, parcel };
  }

  const ship = async (orderId: string) => (await q(`SELECT * FROM shipments WHERE order_id=$1`, [orderId]))[0];
  const order = async (orderId: string) => (await q(`SELECT * FROM orders WHERE id=$1`, [orderId]))[0];
  const shipHistory = (orderId: string) =>
    q(`SELECT previous_status, new_status, actor_type FROM order_status_history WHERE order_id=$1 AND status_field='shipment_status' ORDER BY created_at, id`, [orderId]);
  const orderHistory = (orderId: string) =>
    q(`SELECT previous_status, new_status FROM order_status_history WHERE order_id=$1 AND status_field='order_status' ORDER BY created_at, id`, [orderId]);
  const syncEvents = (parcel: string) =>
    q(`SELECT applied, skip_reason, source, reported_status FROM shipment_sync_events WHERE courier_order_id=$1 ORDER BY created_at, id`, [parcel]);
  const stock = async () => (await q<{ stock_quantity: number }>(`SELECT stock_quantity FROM product_variants WHERE id=$1`, [variantId]))[0]!.stock_quantity;

  type Ev = { id?: string; parcel: string; status: string; at?: string };
  function webhook(events: Ev[], opts: { signature?: string | null; courier?: string } = {}) {
    const body = JSON.stringify({ events });
    const req = request(app).post(`/api/webhooks/courier/${opts.courier ?? COURIER}`).set('Content-Type', 'application/json');
    if (opts.signature !== null) req.set(SIGNATURE_HEADER, opts.signature ?? sign(body));
    return req.send(body);
  }

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

    const { registerAdapter } = await import('../../src/services/courier/registry.js');
    registerAdapter(fake);
    ({ pollCourierStatuses } = await import('../../src/services/courierSync.service.js'));
    const { createApp } = await import('../../src/app.js');
    app = createApp();

    await q(`INSERT INTO couriers (code, name, adapter_key, display_order) VALUES ($1,'Fake Sync Courier','syncfake',100)`, [COURIER]);
    [{ id: customerId }] = (await q(
      `INSERT INTO customers (account_type, full_name, phone_number, division, district, area_unit_type, area_unit_name, ward_unit_type, ward_unit_name, detailed_address)
       VALUES ('REGISTERED','Reg Customer','01711111111','Dhaka','Dhaka','THANA','Dhanmondi','WARD','Ward 1','House 1') RETURNING id`,
    )) as any;
    const [{ id: catId }] = (await q(`INSERT INTO categories (name, slug, status) VALUES ('C','c-s','ACTIVE') RETURNING id`)) as any;
    [{ id: productId }] = (await q(`INSERT INTO products (category_id, name, slug, base_price, status) VALUES ($1,'P','p-s',500,'ACTIVE') RETURNING id`, [catId])) as any;
    [{ id: variantId }] = (await q(
      `INSERT INTO product_variants (product_id, sku, price, stock_quantity, is_active) VALUES ($1,'S-SKU',500,1000,true) RETURNING id`,
      [productId],
    )) as any;
  }, 90_000);

  afterAll(async () => {
    const { unregisterAdapter } = await import('../../src/services/courier/registry.js');
    unregisterAdapter();
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  beforeEach(() => fake.reset());

  describe('idempotent applier (§4.6)', () => {
    it('applies a valid SHIPPED → IN_TRANSIT update once, with one history row (acceptance 2)', async () => {
      const { orderId, parcel } = await shipmentOrder('SHIPPED');
      const res = await webhook([{ id: 'evt-1', parcel, status: 'IN_TRANSIT', at: '2026-10-01T09:00:00Z' }]);
      expect(res.status).toBe(200);

      expect((await ship(orderId)).shipment_status).toBe('IN_TRANSIT');
      expect((await ship(orderId)).status_sequence).toBe(4);
      expect(await shipHistory(orderId)).toEqual([{ previous_status: 'SHIPPED', new_status: 'IN_TRANSIT', actor_type: 'SYSTEM' }]);
      expect(await syncEvents(parcel)).toMatchObject([{ applied: true, skip_reason: null, source: 'WEBHOOK' }]);
    });

    it('replaying the identical webhook returns 200, applies nothing and keeps one history row (test 1, acceptance 3)', async () => {
      const { orderId, parcel } = await shipmentOrder('SHIPPED');
      const event = { id: 'evt-dup', parcel, status: 'IN_TRANSIT' };
      expect((await webhook([event])).status).toBe(200);
      expect((await webhook([event])).status).toBe(200);

      expect(await shipHistory(orderId)).toHaveLength(1);
      expect(await syncEvents(parcel)).toMatchObject([
        { applied: true, skip_reason: null },
        { applied: false, skip_reason: 'DUPLICATE' },
      ]);
    });

    it('records an older status after a newer one as STALE and does not regress it (test 2, acceptance 4)', async () => {
      const { orderId, parcel } = await shipmentOrder('OUT_FOR_DELIVERY');
      const res = await webhook([{ id: 'evt-old', parcel, status: 'IN_TRANSIT' }]);
      expect(res.status).toBe(200);

      expect((await ship(orderId)).shipment_status).toBe('OUT_FOR_DELIVERY');
      expect(await shipHistory(orderId)).toHaveLength(0);
      expect(await syncEvents(parcel)).toMatchObject([{ applied: false, skip_reason: 'STALE' }]);
    });

    it('applies skipped intermediate steps, each recorded in history (SHIPPED → OUT_FOR_DELIVERY)', async () => {
      const { orderId, parcel } = await shipmentOrder('SHIPPED');
      await webhook([{ id: 'evt-skip', parcel, status: 'OUT_FOR_DELIVERY' }]);

      expect((await ship(orderId)).shipment_status).toBe('OUT_FOR_DELIVERY');
      expect((await shipHistory(orderId)).map((h) => h.new_status)).toEqual(['IN_TRANSIT', 'OUT_FOR_DELIVERY']);
    });

    it('never takes over the manual CREATED → SHIPPED handover (§5.21.9): recorded INVALID_TRANSITION, applies later', async () => {
      const { orderId, parcel } = await shipmentOrder('CREATED');
      await webhook([{ id: 'evt-early', parcel, status: 'IN_TRANSIT' }]);
      expect((await ship(orderId)).shipment_status).toBe('CREATED');
      expect(await syncEvents(parcel)).toMatchObject([{ applied: false, skip_reason: 'INVALID_TRANSITION' }]);

      // The admin marks the parcel shipped; the same update now applies (skipped events are not dedupe-locked).
      await q(`UPDATE shipments SET shipment_status='SHIPPED' WHERE order_id=$1`, [orderId]);
      await webhook([{ id: 'evt-early', parcel, status: 'IN_TRANSIT' }]);
      expect((await ship(orderId)).shipment_status).toBe('IN_TRANSIT');
    });

    it('ignores an unrecognized provider status instead of guessing, and an unknown shipment', async () => {
      const { orderId, parcel } = await shipmentOrder('SHIPPED');
      expect((await webhook([{ id: 'evt-x', parcel, status: 'SOME_NEW_PROVIDER_STATUS' }])).status).toBe(200);
      expect((await ship(orderId)).shipment_status).toBe('SHIPPED');
      expect(await syncEvents(parcel)).toMatchObject([{ applied: false, skip_reason: 'UNRECOGNIZED_STATUS' }]);

      const unknown = await webhook([{ id: 'evt-y', parcel: 'TEST-ONLY-NO-SUCH-PARCEL', status: 'IN_TRANSIT' }]);
      expect(unknown.status).toBe(200);
      expect(await syncEvents('TEST-ONLY-NO-SUCH-PARCEL')).toMatchObject([{ applied: false, skip_reason: 'UNKNOWN_SHIPMENT' }]);
    });
  });

  describe('webhook and polling converge (test 3, acceptance 5)', () => {
    async function isolatePoll(targetOrderId: string): Promise<void> {
      // Other shipments in this schema must not be refreshed by the poll under test.
      await q(`UPDATE shipments SET last_synced_at = now() WHERE order_id <> $1`, [targetOrderId]);
      await q(`UPDATE shipments SET last_synced_at = NULL WHERE order_id = $1`, [targetOrderId]);
    }

    it('webhook first, then poll: the transition is applied once', async () => {
      const { orderId, parcel } = await shipmentOrder('SHIPPED');
      await webhook([{ id: 'evt-conv-1', parcel, status: 'IN_TRANSIT' }]);

      fake.state.trackResult = tracking('IN_TRANSIT');
      await isolatePoll(orderId);
      await pollCourierStatuses();

      expect(await shipHistory(orderId)).toHaveLength(1);
      expect(await syncEvents(parcel).then((e) => e.filter((x) => x.applied))).toHaveLength(1);
    });

    it('poll first, then webhook: the transition is applied once', async () => {
      const { orderId, parcel } = await shipmentOrder('SHIPPED');
      fake.state.trackResult = tracking('IN_TRANSIT');
      await isolatePoll(orderId);
      const summary = await pollCourierStatuses();
      expect(summary.applied).toBeGreaterThanOrEqual(1);
      expect((await ship(orderId)).shipment_status).toBe('IN_TRANSIT');

      await webhook([{ id: 'evt-conv-2', parcel, status: 'IN_TRANSIT' }]);
      expect(await shipHistory(orderId)).toHaveLength(1);
      expect((await syncEvents(parcel)).filter((e) => e.applied)).toHaveLength(1);
    });

    it('a poll within the refresh TTL makes no second provider call (test 18)', async () => {
      const { orderId, parcel } = await shipmentOrder('SHIPPED');
      fake.state.trackResult = tracking('SHIPPED');
      await isolatePoll(orderId);
      await pollCourierStatuses();
      await pollCourierStatuses();
      expect(fake.state.tracks.filter((p) => p === parcel)).toHaveLength(1);
    });

    it('a provider failure during a poll leaves internal state untouched', async () => {
      const { orderId } = await shipmentOrder('SHIPPED');
      fake.state.trackThrows = true;
      await isolatePoll(orderId);
      await expect(pollCourierStatuses()).resolves.toBeDefined();
      expect((await ship(orderId)).shipment_status).toBe('SHIPPED');
    });
  });

  describe('webhook signature verification (test 4, acceptance 1; §11.8)', () => {
    it('an invalid signature returns 401, processes nothing and is recorded as invalid', async () => {
      const { orderId, parcel } = await shipmentOrder('SHIPPED');
      const res = await webhook([{ id: 'evt-bad', parcel, status: 'IN_TRANSIT' }], { signature: 'deadbeef'.repeat(8) });
      expect(res.status).toBe(401);

      expect((await ship(orderId)).shipment_status).toBe('SHIPPED');
      expect(await syncEvents(parcel)).toHaveLength(0);
      const deliveries = await q(`SELECT signature_valid, http_status_returned, payload_digest FROM courier_webhook_deliveries WHERE courier_code=$1 ORDER BY received_at DESC LIMIT 1`, [COURIER]);
      expect(deliveries[0]).toMatchObject({ signature_valid: false, http_status_returned: 401 });
      expect(deliveries[0].payload_digest).toMatch(/^[0-9a-f]{64}$/);
    });

    it('a missing signature header is rejected the same way', async () => {
      const { orderId, parcel } = await shipmentOrder('SHIPPED');
      expect((await webhook([{ parcel, status: 'IN_TRANSIT' }], { signature: null })).status).toBe(401);
      expect((await ship(orderId)).shipment_status).toBe('SHIPPED');
    });

    it('a tampered body fails verification even with a once-valid signature', async () => {
      const { orderId, parcel } = await shipmentOrder('SHIPPED');
      const signed = sign(JSON.stringify({ events: [{ id: 'e', parcel, status: 'SHIPPED' }] }));
      const res = await webhook([{ id: 'e', parcel, status: 'DELIVERED' }], { signature: signed });
      expect(res.status).toBe(401);
      expect((await ship(orderId)).shipment_status).toBe('SHIPPED');
    });

    it('a valid signature is recorded as valid, and an unknown courier is accepted and ignored', async () => {
      const { parcel } = await shipmentOrder('SHIPPED');
      await webhook([{ id: 'evt-ok', parcel, status: 'IN_TRANSIT' }]);
      const ok = await q(`SELECT signature_valid, http_status_returned FROM courier_webhook_deliveries WHERE courier_code=$1 ORDER BY received_at DESC LIMIT 1`, [COURIER]);
      expect(ok[0]).toMatchObject({ signature_valid: true, http_status_returned: 200 });

      expect((await webhook([{ parcel, status: 'IN_TRANSIT' }], { courier: 'NOSUCHCOURIER' })).status).toBe(200);
      expect((await webhook([{ parcel, status: 'IN_TRANSIT' }], { courier: 'bad code!' })).status).toBe(200);
    });

    it('returns no body content that reveals what was or was not applied', async () => {
      const { parcel } = await shipmentOrder('SHIPPED');
      const a = await webhook([{ id: 'evt-same', parcel, status: 'IN_TRANSIT' }]);
      const b = await webhook([{ id: 'evt-same', parcel, status: 'IN_TRANSIT' }]);
      expect(a.body).toEqual(b.body);
    });
  });

  describe('sync-driven cascades (tests 5-6; §5.21.3, §5.21.4, §5.21.6)', () => {
    it('DELIVERED moves the order to DELIVERED atomically and leaves a COD payment PENDING_COLLECTION (acceptance 6)', async () => {
      const { orderId, parcel } = await shipmentOrder('OUT_FOR_DELIVERY');
      expect((await webhook([{ id: 'evt-del', parcel, status: 'DELIVERED' }])).status).toBe(200);

      const o = await order(orderId);
      expect(o.order_status).toBe('DELIVERED');
      expect(o.payment_status).toBe('PENDING_COLLECTION');
      expect((await ship(orderId)).shipment_status).toBe('DELIVERED');
      expect(await orderHistory(orderId)).toEqual([{ previous_status: 'PROCESSING', new_status: 'DELIVERED' }]);
    });

    it('DELIVERY_FAILED → RETURNED moves the order to RETURNED and restores stock (acceptance 7)', async () => {
      const { orderId, parcel } = await shipmentOrder('DELIVERY_FAILED', { qty: 3 });
      const before = await stock();
      expect((await webhook([{ id: 'evt-ret', parcel, status: 'RETURNED' }])).status).toBe(200);

      expect((await order(orderId)).order_status).toBe('RETURNED');
      expect((await ship(orderId)).shipment_status).toBe('RETURNED');
      expect(await stock()).toBe(before + 3);
    });

    it('a failed order write rolls the shipment change back too — never a delivered shipment on a processing order', async () => {
      const { orderId, parcel } = await shipmentOrder('OUT_FOR_DELIVERY');
      await q(`ALTER TABLE orders ADD CONSTRAINT spec15_force_fail CHECK (order_status <> 'DELIVERED') NOT VALID`);
      try {
        const res = await webhook([{ id: 'evt-fail', parcel, status: 'DELIVERED' }]);
        expect(res.status).toBeGreaterThanOrEqual(400);
      } finally {
        await q(`ALTER TABLE orders DROP CONSTRAINT spec15_force_fail`);
      }
      expect((await ship(orderId)).shipment_status).toBe('OUT_FOR_DELIVERY');
      expect((await order(orderId)).order_status).toBe('PROCESSING');
      expect(await shipHistory(orderId)).toHaveLength(0);
    });

    it('a cascade the order state machine forbids is recorded INVALID_TRANSITION and changes nothing', async () => {
      const { orderId, parcel } = await shipmentOrder('OUT_FOR_DELIVERY', { orderStatus: 'CANCELLED' });
      expect((await webhook([{ id: 'evt-cx', parcel, status: 'DELIVERED' }])).status).toBe(200);
      expect((await ship(orderId)).shipment_status).toBe('OUT_FOR_DELIVERY');
      expect((await order(orderId)).order_status).toBe('CANCELLED');
      expect(await syncEvents(parcel)).toMatchObject([{ applied: false, skip_reason: 'INVALID_TRANSITION' }]);
    });
  });
});
