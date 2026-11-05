import { createHmac } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.ts';
import { applyTestEnv } from '../helpers/testEnv.ts';
import { resetEnvCache } from '../../src/config/env.ts';

/**
 * Steadfast webhook end to end (04-courier §4.6, 11-security §11.8): the real route, the real
 * Steadfast adapter (Bearer + HMAC-SHA256 X-Signature over the raw body, per Steadfast's
 * webhook page), the real idempotent applier and a real Postgres schema with the seeded
 * STEADFAST courier row.
 */
const SCHEMA = 'spec15_steadfast';
const TOKEN = 'TEST-ONLY-WEBHOOK-TOKEN-3c7d';

describe.skipIf(!TEST_DATABASE_URL)('steadfast webhook (spec 15)', () => {
  let app: Express;
  let q: <T = any>(sql: string, params?: unknown[]) => Promise<T[]>;
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;
  let customerId: string;
  let productId: string;
  let variantId: string;
  let seq = 0;

  async function shipmentOrder(status: string): Promise<{ orderId: string; cid: number }> {
    seq += 1;
    const [o] = await q<{ id: string }>(
      `INSERT INTO orders (order_number, customer_id, payment_method, order_status, payment_status, subtotal, shipping_amount, total_amount,
                          full_name, phone_number, division, district, area_unit_type, area_unit_name, ward_unit_type, ward_unit_name, detailed_address)
       VALUES ($1,$2,'COD','PROCESSING','PENDING_COLLECTION',500,0,500,'Sync Tester','01711111111','Dhaka','Dhaka','THANA','Dhanmondi','WARD','Ward 1','House 1')
       RETURNING id`,
      [`FBK-20261106-T${String(seq).padStart(5, '0')}`, customerId],
    );
    await q(
      `INSERT INTO order_items (order_id, product_id, product_variant_id, product_name, unit_price, quantity, line_total)
       VALUES ($1,$2,$3,'Cotton Panjabi',500,1,500)`,
      [o!.id, productId, variantId],
    );
    const cid = 9_000_000 + seq;
    await q(`INSERT INTO shipments (order_id, shipment_status, courier, courier_order_id) VALUES ($1,$2,'STEADFAST',$3)`, [o!.id, status, String(cid)]);
    return { orderId: o!.id, cid };
  }

  const ship = async (orderId: string) => (await q(`SELECT * FROM shipments WHERE order_id=$1`, [orderId]))[0];
  const order = async (orderId: string) => (await q(`SELECT * FROM orders WHERE id=$1`, [orderId]))[0];
  const history = (orderId: string) =>
    q(`SELECT new_status FROM order_status_history WHERE order_id=$1 AND status_field='shipment_status' ORDER BY created_at, id`, [orderId]);

  function post(payload: unknown, opts: { token?: string; signWith?: string; idem?: string } = {}) {
    const body = JSON.stringify(payload);
    const signature = createHmac('sha256', opts.signWith ?? TOKEN).update(body).digest('hex');
    const req = request(app)
      .post('/api/webhooks/courier/steadfast')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${opts.token ?? TOKEN}`)
      .set('X-Signature', signature)
      .set('User-Agent', 'Steadfast-Webhook/1.0');
    if (opts.idem) req.set('Idempotency-Key', opts.idem);
    return req.send(body);
  }

  const delivery = (cid: number, status: string, at = '2026-11-06 12:45:30') => ({
    notification_type: 'delivery_status', consignment_id: cid, invoice: 'X', cod_amount: 500, status,
    delivery_charge: 60, tracking_message: 'm', updated_at: at,
  });

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    applyTestEnv();
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    process.env.RL_PUBLIC_CEILING_MAX = '100000';
    process.env.STEADFAST_WEBHOOK_TOKEN = TOKEN;
    resetEnvCache();

    const tx = await import('../../src/lib/transaction.js');
    resetTransactionPool = tx.resetTransactionPool;
    await tx.resetTransactionPool();
    q = (sql, params) => tx.withTransaction(async (c) => (await c.query(sql, params as any[])).rows);

    const { registerAdapter } = await import('../../src/services/courier/registry.js');
    const { steadfastAdapter } = await import('../../src/services/courier/adapters/steadfast.adapter.js');
    registerAdapter(steadfastAdapter);
    const { createApp } = await import('../../src/app.js');
    app = createApp();

    await q(`UPDATE couriers SET is_enabled = true WHERE code = 'STEADFAST'`);
    [{ id: customerId }] = (await q(
      `INSERT INTO customers (account_type, full_name, phone_number, division, district, area_unit_type, area_unit_name, ward_unit_type, ward_unit_name, detailed_address)
       VALUES ('REGISTERED','Reg Customer','01711111111','Dhaka','Dhaka','THANA','Dhanmondi','WARD','Ward 1','House 1') RETURNING id`,
    )) as any;
    const [{ id: catId }] = (await q(`INSERT INTO categories (name, slug, status) VALUES ('C','c-sf','ACTIVE') RETURNING id`)) as any;
    [{ id: productId }] = (await q(`INSERT INTO products (category_id, name, slug, base_price, status) VALUES ($1,'P','p-sf',500,'ACTIVE') RETURNING id`, [catId])) as any;
    [{ id: variantId }] = (await q(
      `INSERT INTO product_variants (product_id, sku, price, stock_quantity, is_active) VALUES ($1,'SF-SKU',500,1000,true) RETURNING id`,
      [productId],
    )) as any;
  }, 90_000);

  afterAll(async () => {
    const { unregisterAdapter } = await import('../../src/services/courier/registry.js');
    unregisterAdapter();
    delete process.env.STEADFAST_WEBHOOK_TOKEN;
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  it('migration 0027 marks Steadfast as no-cancel with reference lookup', async () => {
    const [row] = await q(`SELECT supports_cancel, supports_reference_lookup, adapter_key FROM couriers WHERE code='STEADFAST'`);
    expect(row).toMatchObject({ supports_cancel: false, supports_reference_lookup: true, adapter_key: 'steadfast' });
  });

  it('a signed delivered event moves the shipment to DELIVERED and cascades the order', async () => {
    const { orderId, cid } = await shipmentOrder('OUT_FOR_DELIVERY');
    const res = await post(delivery(cid, 'delivered'), { idem: 'evt-delivered-1' });
    expect(res.status).toBe(200);
    expect((await ship(orderId)).shipment_status).toBe('DELIVERED');
    expect((await order(orderId)).order_status).toBe('DELIVERED');
  });

  it('a wrong signature or a wrong Bearer token is 401 and changes nothing', async () => {
    const { orderId, cid } = await shipmentOrder('OUT_FOR_DELIVERY');
    expect((await post(delivery(cid, 'delivered'), { signWith: 'not-the-token' })).status).toBe(401);
    expect((await post(delivery(cid, 'delivered'), { token: 'not-the-token' })).status).toBe(401);
    expect((await ship(orderId)).shipment_status).toBe('OUT_FOR_DELIVERY');
  });

  it('a retried delivery (same Idempotency-Key) is 200 and applied once', async () => {
    const { orderId, cid } = await shipmentOrder('IN_TRANSIT');
    expect((await post(delivery(cid, 'cancelled'), { idem: 'evt-retry-1' })).status).toBe(200);
    expect((await post(delivery(cid, 'cancelled'), { idem: 'evt-retry-1' })).status).toBe(200);
    expect((await ship(orderId)).shipment_status).toBe('DELIVERY_FAILED');
    expect((await history(orderId)).filter((h: any) => h.new_status === 'DELIVERY_FAILED')).toHaveLength(1);
  });

  it('a partial delivery leaves the status alone and flags the shipment for a person', async () => {
    const { orderId, cid } = await shipmentOrder('OUT_FOR_DELIVERY');
    expect((await post(delivery(cid, 'partial_delivered'), { idem: 'evt-partial-1' })).status).toBe(200);
    const s = await ship(orderId);
    expect(s.shipment_status).toBe('OUT_FOR_DELIVERY');
    expect(s.sync_problem).toMatch(/partial delivery/);
    expect((await order(orderId)).order_status).toBe('PROCESSING');
  });

  it('non-status events and unknown consignments are acknowledged and ignored', async () => {
    const { orderId, cid } = await shipmentOrder('IN_TRANSIT');
    expect((await post({ notification_type: 'tracking_update', consignment_id: cid, text: 'At hub' })).status).toBe(200);
    expect((await post(delivery(123, 'delivered'), { idem: 'evt-unknown-1' })).status).toBe(200);
    expect((await ship(orderId)).shipment_status).toBe('IN_TRANSIT');
  });
});
