import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, connect, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.js';
import { applyTestEnv } from '../helpers/testEnv.js';
import { resetEnvCache } from '../../src/config/env.js';

/**
 * Customer account surface (02-customer §2.6, §2.9.6): profile edit, address
 * edit, change password, order detail, order history shipment status, and the
 * guest-lookup shipment projection.
 */
const SCHEMA = 'spec11_customer_account_api';
const PASSWORD = 'AccountPass12';

describe.skipIf(!TEST_DATABASE_URL)('customer account (spec 11)', () => {
  let app: Express;
  let withTransaction: typeof import('../../src/lib/transaction.js').withTransaction;
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;
  let productId: string;
  let variantId: string;

  const address = {
    division: 'Dhaka',
    district: 'Dhaka',
    area_unit: { type: 'THANA', name: 'Gulshan' },
    ward_unit: { type: 'WARD', name: '5' },
    detailed_address: 'House 9, Road 3',
    postal_code: '1212',
  };

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    applyTestEnv();
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    process.env.RL_GUEST_LOOKUP_MAX = '10000';
    process.env.RL_PUBLIC_CEILING_MAX = '10000';
    process.env.RL_CUSTOMER_LOGIN_MAX = '10000';
    process.env.RL_REGISTRATION_MAX = '10000';
    resetEnvCache();

    ({ withTransaction, resetTransactionPool } = await import('../../src/lib/transaction.js'));
    await resetTransactionPool();
    const { createApp } = await import('../../src/app.js');
    app = createApp();

    await withTransaction(async (client) => {
      const cat = await client.query<{ id: string }>(
        `INSERT INTO categories (name, slug, status) VALUES ('Acct Cat','acct-cat','ACTIVE') RETURNING id`,
      );
      const prod = await client.query<{ id: string }>(
        `INSERT INTO products (category_id, name, slug, base_price, status)
         VALUES ($1, 'Acct Product', 'acct-product', 500, 'ACTIVE') RETURNING id`,
        [cat.rows[0]!.id],
      );
      productId = prod.rows[0]!.id;
      const variant = await client.query<{ id: string }>(
        `INSERT INTO product_variants (product_id, sku, price, stock_quantity, is_active)
         VALUES ($1, 'ACCT-SKU-1', 500, 10, true) RETURNING id`,
        [productId],
      );
      variantId = variant.rows[0]!.id;
    });
  }, 60_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  async function registeredAgent(phone: string) {
    const reg = await request(app).post('/api/customer/auth/register').send({ phone_number: phone, password: PASSWORD });
    expect(reg.status).toBe(201);
    const agent = request.agent(app);
    const login = await agent.post('/api/customer/auth/login').send({ phone_number: phone, password: PASSWORD });
    expect(login.status).toBe(200);
    return agent;
  }

  describe('profile (§2.6)', () => {
    it('rejects unauthenticated access', async () => {
      expect((await request(app).patch('/api/customer/auth/profile').send({ full_name: 'X' })).status).toBe(401);
      expect((await request(app).put('/api/customer/auth/address').send(address)).status).toBe(401);
    });

    it('starts incomplete, becomes complete after profile + address edits, and then allows checkout', async () => {
      const agent = await registeredAgent('01766600001');

      const before = await agent.get('/api/customer/auth/me');
      expect(before.body.data.is_complete).toBe(false);

      const profile = await agent
        .patch('/api/customer/auth/profile')
        .send({ full_name: 'Account Tester', email: 'tester@example.com' });
      expect(profile.status).toBe(200);
      expect(profile.body.data.full_name).toBe('Account Tester');
      expect(profile.body.data.email).toBe('tester@example.com');
      expect(profile.body.data.is_complete).toBe(false);

      const addr = await agent.put('/api/customer/auth/address').send(address);
      expect(addr.status).toBe(200);
      expect(addr.body.data.is_complete).toBe(true);
      expect(addr.body.data.area_unit_name).toBe('Gulshan');
      expect(addr.body.data.postal_code).toBe('1212');

      const me = await agent.get('/api/customer/auth/me');
      expect(me.body.data.detailed_address).toBe('House 9, Road 3');

      const order = await agent
        .post('/api/customer/orders')
        .send({ paymentMethod: 'COD', lines: [{ productId, variantId, quantity: 1 }], idempotencyKey: 'idem-acct-1' });
      expect(order.status).toBe(201);
    });

    it('never changes the phone number, even if one is sent', async () => {
      const agent = await registeredAgent('01766600002');
      const res = await agent
        .patch('/api/customer/auth/profile')
        .send({ full_name: 'Phone Tester', phone_number: '01799999999' });
      expect(res.status).toBe(200);
      expect(res.body.data.phone_number).toBe('01766600002');
    });

    it('clears the email when blank and rejects a malformed one', async () => {
      const agent = await registeredAgent('01766600003');
      const bad = await agent.patch('/api/customer/auth/profile').send({ full_name: 'E', email: 'not-an-email' });
      expect(bad.status).toBe(400);

      await agent.patch('/api/customer/auth/profile').send({ full_name: 'E', email: 'a@example.com' });
      const cleared = await agent.patch('/api/customer/auth/profile').send({ full_name: 'E', email: '' });
      expect(cleared.status).toBe(200);
      expect(cleared.body.data.email).toBeUndefined();
    });

    it('rejects an address with a missing field or invalid area-unit type', async () => {
      const agent = await registeredAgent('01766600004');
      expect((await agent.put('/api/customer/auth/address').send({ ...address, district: '' })).status).toBe(400);
      expect(
        (await agent.put('/api/customer/auth/address').send({ ...address, area_unit: { type: 'CITY', name: 'x' } })).status,
      ).toBe(400);
    });

    it('does not let one customer edit another (identity comes from the session)', async () => {
      const a = await registeredAgent('01766600005');
      const b = await registeredAgent('01766600006');
      await a.patch('/api/customer/auth/profile').send({ full_name: 'Customer A' });
      await b.patch('/api/customer/auth/profile').send({ full_name: 'Customer B' });
      expect((await a.get('/api/customer/auth/me')).body.data.full_name).toBe('Customer A');
    });
  });

  describe('change password (§2.6)', () => {
    it('rejects unauthenticated access', async () => {
      const res = await request(app)
        .post('/api/customer/auth/change-password')
        .send({ old_password: PASSWORD, new_password: 'NewAccountPass12' });
      expect(res.status).toBe(401);
    });

    it('rejects a wrong current password and keeps the old one working', async () => {
      const agent = await registeredAgent('01766600007');
      const res = await agent
        .post('/api/customer/auth/change-password')
        .send({ old_password: 'WrongPassword99', new_password: 'NewAccountPass12' });
      expect(res.status).toBe(401);

      const login = await request(app)
        .post('/api/customer/auth/login')
        .send({ phone_number: '01766600007', password: PASSWORD });
      expect(login.status).toBe(200);
    });

    it('rejects a too-short new password', async () => {
      const agent = await registeredAgent('01766600008');
      const res = await agent
        .post('/api/customer/auth/change-password')
        .send({ old_password: PASSWORD, new_password: 'short' });
      expect(res.status).toBe(400);
    });

    it('changes the password: new one logs in, old one no longer does, and the session is kept', async () => {
      const agent = await registeredAgent('01766600009');
      const res = await agent
        .post('/api/customer/auth/change-password')
        .send({ old_password: PASSWORD, new_password: 'NewAccountPass12' });
      expect(res.status).toBe(200);
      // The call must not behave like logout (it used to be wired to it).
      expect((await agent.get('/api/customer/auth/me')).status).toBe(200);

      const oldLogin = await request(app)
        .post('/api/customer/auth/login')
        .send({ phone_number: '01766600009', password: PASSWORD });
      expect(oldLogin.status).toBe(401);
      const newLogin = await request(app)
        .post('/api/customer/auth/login')
        .send({ phone_number: '01766600009', password: 'NewAccountPass12' });
      expect(newLogin.status).toBe(200);
    });
  });

  describe('order detail, history and guest-lookup shipment info (§2.6, §2.9.6)', () => {
    async function completeAgent(phone: string) {
      const agent = await registeredAgent(phone);
      await agent.patch('/api/customer/auth/profile').send({ full_name: 'Detail Tester' });
      await agent.put('/api/customer/auth/address').send(address);
      return agent;
    }

    async function place(agent: ReturnType<typeof request.agent>, key: string) {
      const res = await agent
        .post('/api/customer/orders')
        .send({ paymentMethod: 'COD', lines: [{ productId, variantId, quantity: 2 }], idempotencyKey: key });
      expect(res.status).toBe(201);
      return res.body.data as { id: string; orderNumber: string };
    }

    it('shows the owner their order with items, address and shipment, without internal fields', async () => {
      const agent = await completeAgent('01766600010');
      const order = await place(agent, 'idem-detail-1');

      const res = await agent.get(`/api/customer/orders/${order.id}`);
      expect(res.status).toBe(200);
      expect(res.body.data.orderNumber).toBe(order.orderNumber);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].quantity).toBe(2);
      expect(res.body.data.deliveryAddress.areaUnitName).toBe('Gulshan');
      expect(res.body.data.shipment.shipmentStatus).toBe('NOT_CREATED');

      const serialized = JSON.stringify(res.body);
      for (const forbidden of ['risk', 'note', 'courier_error', 'courierError', 'bkash', 'idempotency']) {
        expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
      }
    });

    it('returns 404 for another customer\'s order, a missing order, and 400 for a malformed id', async () => {
      const owner = await completeAgent('01766600011');
      const other = await completeAgent('01766600012');
      const order = await place(owner, 'idem-detail-2');

      expect((await other.get(`/api/customer/orders/${order.id}`)).status).toBe(404);
      expect((await other.get('/api/customer/orders/00000000-0000-4000-8000-000000000000')).status).toBe(404);
      expect((await other.get('/api/customer/orders/not-a-uuid')).status).toBe(400);
      expect((await request(app).get(`/api/customer/orders/${order.id}`)).status).toBe(401);
    });

    it('includes shipmentStatus in order history', async () => {
      const agent = await completeAgent('01766600013');
      const order = await place(agent, 'idem-history-1');

      const res = await agent.get('/api/customer/orders');
      const row = res.body.data.find((o: { id: string }) => o.id === order.id);
      expect(row.shipmentStatus).toBe('NOT_CREATED');
    });

    it('guest lookup shows courier + tracking id once a shipment exists, never the courier error', async () => {
      const agent = await completeAgent('01766600014');
      const order = await place(agent, 'idem-lookup-ship-1');

      const client = await connect(SCHEMA);
      try {
        await client.query(
          `INSERT INTO shipments (order_id, shipment_status, courier, courier_order_id, courier_error)
           VALUES ($1, 'IN_TRANSIT', 'PATHAO', 'TRK-12345', 'internal failure text')
           ON CONFLICT (order_id) DO UPDATE SET shipment_status='IN_TRANSIT', courier='PATHAO',
             courier_order_id='TRK-12345', courier_error='internal failure text'`,
          [order.id],
        );
      } finally {
        await client.end();
      }

      const res = await request(app)
        .get('/api/customer/orders/lookup')
        .query({ order_number: order.orderNumber, phone_number: '01766600014' });
      expect(res.status).toBe(200);
      expect(res.body.data.shipment).toEqual({ shipmentStatus: 'IN_TRANSIT', courier: 'PATHAO', trackingId: 'TRK-12345' });
      expect(JSON.stringify(res.body)).not.toContain('internal failure text');

      const detail = await agent.get(`/api/customer/orders/${order.id}`);
      expect(detail.body.data.shipment.trackingId).toBe('TRK-12345');
      expect(JSON.stringify(detail.body)).not.toContain('internal failure text');
    });
  });
});
