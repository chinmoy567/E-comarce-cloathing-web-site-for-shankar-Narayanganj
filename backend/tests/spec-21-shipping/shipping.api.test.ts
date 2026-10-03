import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.js';
import { applyTestEnv } from '../helpers/testEnv.js';
import { resetEnvCache } from '../../src/config/env.js';
import { loginAsAdmin, type AdminSession } from '../helpers/adminSession.js';

/**
 * Spec 21 — shipping over HTTP: the public quote / checkout-pricing endpoints, createOrder() totals,
 * the §8.14c / §8.10 coupon ordering, snapshot immutability, `.strict()` rejection, the admin zone/rate
 * API (system.configure + audit) and a concurrent-checkout invariant.
 * Tests required: 3, 4, 5, 6, 8 (concurrency), 9 (RBAC); acceptance 1-11.
 */
const SCHEMA = 'spec21_shipping_api';
const PASSWORD = 'ShippingApiTestPass12';

describe.skipIf(!TEST_DATABASE_URL)('shipping API (spec 21)', () => {
  let app: Express;
  let withTransaction: typeof import('../../src/lib/transaction.js').withTransaction;
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;
  let admin: AdminSession;
  let manager: AdminSession;

  let productId: string;
  let variantId: string;
  let phoneCounter = 0;
  let keyCounter = 0;

  async function seedCatalogue() {
    return withTransaction(async (client) => {
      const cat = await client.query<{ id: string }>(
        `INSERT INTO categories (name, slug, status) VALUES ('Ship Cat','ship-cat','ACTIVE') RETURNING id`,
      );
      const prod = await client.query<{ id: string }>(
        `INSERT INTO products (category_id, name, slug, base_price, status)
         VALUES ($1, 'Ship Product', 'ship-product', 500, 'ACTIVE') RETURNING id`,
        [cat.rows[0]!.id],
      );
      const variant = await client.query<{ id: string }>(
        `INSERT INTO product_variants (product_id, sku, price, stock_quantity, is_active)
         VALUES ($1, 'SHIP-SKU-1', 500, 1000, true) RETURNING id`,
        [prod.rows[0]!.id],
      );
      return { productId: prod.rows[0]!.id, variantId: variant.rows[0]!.id };
    });
  }

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    applyTestEnv();
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    process.env.RL_PUBLIC_CEILING_MAX = '100000';
    process.env.RL_AUTHENTICATED_CEILING_MAX = '100000';
    resetEnvCache();

    ({ withTransaction, resetTransactionPool } = await import('../../src/lib/transaction.js'));
    await resetTransactionPool();
    const usersRepository = await import('../../src/repositories/users.repository.js');
    const { hashPassword } = await import('../../src/lib/password.js');
    const { createApp } = await import('../../src/app.js');
    app = createApp();

    const passwordHash = await hashPassword(PASSWORD);
    await usersRepository.create({ role: 'ADMIN', userIdentifier: 'ship-admin', passwordHash, mustChangePassword: false });
    await usersRepository.create({ role: 'MANAGER', userIdentifier: 'ship-manager', passwordHash, mustChangePassword: false });

    ({ productId, variantId } = await seedCatalogue());
    admin = await loginAsAdmin(app, 'ship-admin', PASSWORD);
    manager = await loginAsAdmin(app, 'ship-manager', PASSWORD);
  }, 90_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  // ---- helpers ---------------------------------------------------------------------------------

  const line = (quantity = 1) => ({ productId, variantId, quantity });

  function guest(overrides: Record<string, unknown> = {}) {
    phoneCounter += 1;
    return {
      fullName: 'Ship Tester',
      phoneNumber: `0171${String(2000000 + phoneCounter)}`,
      division: 'Dhaka',
      district: 'Dhaka',
      areaUnitType: 'THANA',
      areaUnitName: 'Gulshan',
      wardUnitType: 'WARD',
      wardUnitName: '5',
      detailedAddress: 'House 1, Road 2',
      ...overrides,
    };
  }

  async function placeOrder(opts: { guestFields?: Record<string, unknown>; couponCode?: string; quantity?: number; extra?: Record<string, unknown> } = {}) {
    keyCounter += 1;
    return request(app)
      .post('/api/customer/orders')
      .send({
        paymentMethod: 'COD',
        lines: [line(opts.quantity ?? 1)],
        idempotencyKey: `ship-idem-${keyCounter}`,
        guestFields: guest(opts.guestFields),
        ...(opts.couponCode ? { couponCode: opts.couponCode } : {}),
        ...(opts.extra ?? {}),
      });
  }

  const validate = (body: Record<string, unknown>) => request(app).post('/api/checkout/validate').send(body);

  async function zones() {
    const res = await admin.agent.get('/api/admin/shipping/zones');
    expect(res.status).toBe(200);
    return res.body.data as Array<{
      id: string; code: string; name: string; isDefault: boolean;
      districts: Array<{ district: string; metroOnly: boolean }>;
      currentRate: { strategy: string; flatAmount: number; freeOverAmount: number | null } | null;
    }>;
  }
  const zoneByCode = async (code: string) => (await zones()).find((z) => z.code === code)!;

  async function setRate(code: string, body: Record<string, unknown>) {
    const zone = await zoneByCode(code);
    return admin.post(`/api/admin/shipping/zones/${zone.id}/rates`).send(body);
  }

  async function createCoupon(overrides: Record<string, unknown>) {
    const res = await admin.post('/api/admin/coupons').send({
      code: `SHIP${Date.now()}${Math.floor(Math.random() * 100000)}`,
      name: 'Shipping Coupon',
      startsAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z',
      status: 'ACTIVE',
      ...overrides,
    });
    expect(res.status).toBe(201);
    return res.body.data.code as string;
  }

  const orderRow = (orderNumber: string) =>
    withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT subtotal::float AS subtotal, shipping_amount::float AS shipping_amount,
                discount_amount::float AS discount_amount, total_amount::float AS total_amount, shipping_zone_code
           FROM orders WHERE order_number = $1`,
        [orderNumber],
      );
      return rows[0] as { subtotal: number; shipping_amount: number; discount_amount: number | null; total_amount: number; shipping_zone_code: string | null };
    });

  // ---- public quote ------------------------------------------------------------------------------

  describe('GET /api/shipping/quote', () => {
    it('returns zone name and amount for a metropolitan Dhaka address, without the internal zone code', async () => {
      const res = await request(app).get('/api/shipping/quote').query({ district: 'Dhaka', areaUnitType: 'THANA' });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ zoneName: 'Inside Dhaka', amount: 60, freeShippingApplied: false, freeShippingRemaining: null });
      expect(JSON.stringify(res.body)).not.toContain('INSIDE_DHAKA');
    });

    it('derives metropolitan from areaUnitType server-side (UPAZILA -> suburb rate)', async () => {
      const res = await request(app).get('/api/shipping/quote').query({ district: 'Dhaka', areaUnitType: 'UPAZILA' });
      expect(res.body.data).toMatchObject({ zoneName: 'Dhaka Suburbs', amount: 100 });
    });

    it('rejects an unknown areaUnitType and a client-supplied isMetropolitan', async () => {
      expect((await request(app).get('/api/shipping/quote').query({ district: 'Dhaka', areaUnitType: 'CITY' })).status).toBe(400);
      expect(
        (await request(app).get('/api/shipping/quote').query({ district: 'Dhaka', areaUnitType: 'THANA', isMetropolitan: 'false' })).status,
      ).toBe(400);
    });

    it('does not write an unmatched-district row for an anonymous quote', async () => {
      await request(app).get('/api/shipping/quote').query({ district: 'Nowhereland', areaUnitType: 'UPAZILA' });
      const res = await admin.agent.get('/api/admin/shipping/unmatched-districts');
      expect(res.body.data.map((d: { district: string }) => d.district)).not.toContain('Nowhereland');
    });
  });

  // ---- order totals & snapshot -------------------------------------------------------------------

  describe('order creation (acceptance 1, 2, 3, 6, 7, 9)', () => {
    it('charges INSIDE_DHAKA to a metro Dhaka address and DHAKA_SUBURB to the same district non-metro', async () => {
      const metro = await placeOrder();
      expect(metro.status).toBe(201);
      expect(metro.body.data).toMatchObject({ subtotal: 500, shippingAmount: 60, totalAmount: 560 });
      expect((await orderRow(metro.body.data.orderNumber)).shipping_zone_code).toBe('INSIDE_DHAKA');

      const suburb = await placeOrder({ guestFields: { areaUnitType: 'UPAZILA' } });
      expect(suburb.body.data).toMatchObject({ shippingAmount: 100, totalAmount: 600 });
      expect((await orderRow(suburb.body.data.orderNumber)).shipping_zone_code).toBe('DHAKA_SUBURB');
    });

    it('charges the default zone for an unmapped district and records it as unmatched', async () => {
      const res = await placeOrder({ guestFields: { district: 'Atlantis', division: 'Sylhet' } });
      expect(res.status).toBe(201);
      expect(res.body.data.shippingAmount).toBe(120);
      expect((await orderRow(res.body.data.orderNumber)).shipping_zone_code).toBe('OUTSIDE_DHAKA');

      const unmatched = await admin.agent.get('/api/admin/shipping/unmatched-districts');
      expect(unmatched.status).toBe(200);
      expect(unmatched.body.data).toEqual(
        expect.arrayContaining([expect.objectContaining({ district: 'Atlantis', occurrences: 1 })]),
      );
    });

    it('keeps total = subtotal - discount + shipping, enforced by the database CHECK (acceptance 3)', async () => {
      const res = await placeOrder();
      await expect(
        withTransaction((client) =>
          client.query(`UPDATE orders SET total_amount = 1 WHERE order_number = $1`, [res.body.data.orderNumber]),
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('rejects a client-supplied shipping/total field outright instead of overriding it (test 6, acceptance 7)', async () => {
      for (const field of ['shippingAmount', 'shipping_amount', 'shipping', 'totalAmount', 'total', 'subtotal']) {
        const res = await placeOrder({ extra: { [field]: 0 } });
        expect(res.status, field).toBe(400);
        expect(res.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ field })]));
      }
    });

    it('is idempotent: replaying the same key returns the same order and shipping', async () => {
      const body = {
        paymentMethod: 'COD',
        lines: [line()],
        idempotencyKey: 'ship-idem-fixed',
        guestFields: guest(),
      };
      const first = await request(app).post('/api/customer/orders').send(body);
      const second = await request(app).post('/api/customer/orders').send(body);
      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(second.body.data.orderNumber).toBe(first.body.data.orderNumber);
      expect(second.body.data.shippingAmount).toBe(first.body.data.shippingAmount);
    });
  });

  // ---- coupon ordering (§8.14c, §8.10) ------------------------------------------------------------

  describe('coupon interaction (tests 3, 4; acceptance 4, 5)', () => {
    it('applies the discount first, then adds shipping — a coupon never reduces shipping', async () => {
      const code = await createCoupon({ discountType: 'FIXED_AMOUNT', discountValue: 100 });
      const res = await placeOrder({ couponCode: code });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ subtotal: 500, discountAmount: 100, shippingAmount: 60, totalAmount: 460 });

      const preview = await validate({ lines: [line()], couponCode: code, delivery: { district: 'Dhaka', areaUnitType: 'THANA' } });
      expect(preview.body.data).toMatchObject({ subtotal: 500, discountAmount: 100, shippingAmount: 60, totalAmount: 460 });
      expect(preview.body.data.appliedCoupon).toMatchObject({ code, discountAmount: 100 });
    });

    it('rejects a coupon that would qualify only once shipping is added (minimum order excludes shipping)', async () => {
      // Subtotal 500 + shipping 60 = 560 >= 550, but the minimum is tested on 500 alone.
      const code = await createCoupon({ discountType: 'FIXED_AMOUNT', discountValue: 50, minimumOrderAmount: 550 });

      const res = await placeOrder({ couponCode: code });
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'couponCode' })]));

      const preview = await validate({ lines: [line()], couponCode: code, delivery: { district: 'Dhaka', areaUnitType: 'THANA' } });
      expect(preview.status).toBe(200);
      expect(preview.body.data.appliedCoupon).toBeNull();
      expect(preview.body.data.couponMessage).toEqual(expect.any(String));
      expect(preview.body.data.discountAmount).toBe(0);
    });

    it('evaluates the free-shipping threshold on the post-discount subtotal', async () => {
      const set = await setRate('INSIDE_DHAKA', { strategy: 'FREE_OVER_THRESHOLD', flatAmount: 60, freeOverAmount: 450 });
      expect(set.status).toBe(201);
      try {
        const noCoupon = await validate({ lines: [line()], delivery: { district: 'Dhaka', areaUnitType: 'THANA' } });
        expect(noCoupon.body.data).toMatchObject({ shippingAmount: 0, totalAmount: 500 });
        expect(noCoupon.body.data.shipping).toMatchObject({ freeShippingApplied: true, freeShippingRemaining: null });

        // 500 - 100 = 400 < 450: the discount pushed the order under the line, so shipping is charged.
        const code = await createCoupon({ discountType: 'FIXED_AMOUNT', discountValue: 100 });
        const withCoupon = await validate({ lines: [line()], couponCode: code, delivery: { district: 'Dhaka', areaUnitType: 'THANA' } });
        expect(withCoupon.body.data).toMatchObject({ shippingAmount: 60, totalAmount: 460 });
        expect(withCoupon.body.data.shipping).toMatchObject({ freeShippingApplied: false, freeShippingRemaining: 50 });

        // The placed order agrees with the preview.
        const placed = await placeOrder({ couponCode: code });
        expect(placed.body.data).toMatchObject({ shippingAmount: 60, totalAmount: 460 });
      } finally {
        await setRate('INSIDE_DHAKA', { strategy: 'FLAT', flatAmount: 60 });
      }
    });
  });

  // ---- POST /api/checkout/validate --------------------------------------------------------------

  describe('POST /api/checkout/validate', () => {
    it('prices a guest on the submitted delivery district and requires one', async () => {
      const ok = await validate({ lines: [line(2)], delivery: { district: 'Dhaka', areaUnitType: 'UPAZILA' } });
      expect(ok.status).toBe(200);
      expect(ok.body.data).toMatchObject({
        currency: 'BDT', subtotal: 1000, discountAmount: 0, shippingAmount: 100, totalAmount: 1100, appliedCoupon: null,
        shipping: { zoneName: 'Dhaka Suburbs', freeShippingApplied: false, freeShippingRemaining: null },
      });

      const missing = await validate({ lines: [line()] });
      expect(missing.status).toBe(400);
    });

    it('rejects client-supplied money fields (.strict())', async () => {
      for (const field of ['shippingAmount', 'totalAmount', 'discountAmount', 'subtotal', 'isMetropolitan']) {
        const res = await validate({ lines: [line()], delivery: { district: 'Dhaka', areaUnitType: 'THANA' }, [field]: 0 });
        expect(res.status, field).toBe(400);
      }
      const nested = await validate({ lines: [line()], delivery: { district: 'Dhaka', areaUnitType: 'THANA', isMetropolitan: false } });
      expect(nested.status).toBe(400);
    });

    it('does not tally an unmatched district (public advisory path)', async () => {
      await validate({ lines: [line()], delivery: { district: 'Preview-Only-District', areaUnitType: 'UPAZILA' } });
      const res = await admin.agent.get('/api/admin/shipping/unmatched-districts');
      expect(res.body.data.map((d: { district: string }) => d.district)).not.toContain('Preview-Only-District');
    });
  });

  // ---- snapshot immutability + audit ------------------------------------------------------------

  describe('rate changes (acceptance 9, 10; test 5)', () => {
    it('never alters an existing order, applies to new ones, and is audited with before/after', async () => {
      const before = await placeOrder();
      const beforeRow = await orderRow(before.body.data.orderNumber);

      const change = await setRate('INSIDE_DHAKA', { strategy: 'FLAT', flatAmount: 80 });
      expect(change.status).toBe(201);
      try {
        expect(await orderRow(before.body.data.orderNumber)).toEqual(beforeRow);
        expect(beforeRow.shipping_amount).toBe(60);

        const after = await placeOrder();
        expect(after.body.data).toMatchObject({ shippingAmount: 80, totalAmount: 580 });
        expect((await orderRow(after.body.data.orderNumber)).shipping_zone_code).toBe('INSIDE_DHAKA');

        const audit = await withTransaction(async (client) => {
          const { rows } = await client.query(
            `SELECT previous_value, new_value, actor_user_id FROM audit_logs
              WHERE entity_type = 'shipping_rate' AND entity_id = $1`,
            [change.body.data.id],
          );
          return rows;
        });
        expect(audit).toHaveLength(1);
        expect(audit[0].previous_value).toMatchObject({ zoneCode: 'INSIDE_DHAKA', flatAmount: 60 });
        expect(audit[0].new_value).toMatchObject({ zoneCode: 'INSIDE_DHAKA', flatAmount: 80 });
        expect(audit[0].actor_user_id).toEqual(expect.any(String));
      } finally {
        await setRate('INSIDE_DHAKA', { strategy: 'FLAT', flatAmount: 60 });
      }
    });

    it('keeps rate history, newest first, paginated', async () => {
      const zone = await zoneByCode('INSIDE_DHAKA');
      const res = await admin.agent.get(`/api/admin/shipping/zones/${zone.id}/rates`).query({ page: 1, pageSize: 2 });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.pagination.total).toBeGreaterThan(2);
      expect(new Date(res.body.data[0].effectiveFrom).getTime()).toBeGreaterThanOrEqual(new Date(res.body.data[1].effectiveFrom).getTime());
    });

    it('validates rate bodies: threshold all-or-nothing, flat required, decimals, FREE', async () => {
      const bad: Array<Record<string, unknown>> = [
        { strategy: 'FLAT' },
        { strategy: 'FLAT', flatAmount: 50, freeOverAmount: 500 },
        { strategy: 'FREE_OVER_THRESHOLD', flatAmount: 50 },
        { strategy: 'FLAT', flatAmount: -1 },
        { strategy: 'FLAT', flatAmount: 10.123 },
        { strategy: 'FREE', flatAmount: 20 },
        { strategy: 'PER_KG', flatAmount: 20 },
        { strategy: 'FLAT', flatAmount: 20, extra: true },
      ];
      for (const body of bad) {
        expect((await setRate('INSIDE_DHAKA', body)).status, JSON.stringify(body)).toBe(400);
      }
      const free = await setRate('OUTSIDE_DHAKA', { strategy: 'FREE' });
      expect(free.status).toBe(201);
      expect(free.body.data).toMatchObject({ strategy: 'FREE', flatAmount: 0, freeOverAmount: null });
      await setRate('OUTSIDE_DHAKA', { strategy: 'FLAT', flatAmount: 120 });
    });
  });

  // ---- admin API ---------------------------------------------------------------------------------

  describe('admin zone API & RBAC (test 9; acceptance 11)', () => {
    it('requires an admin session (401) and system.configure (403 for a default Manager) on every route', async () => {
      const zone = await zoneByCode('INSIDE_DHAKA');
      const calls: Array<[string, string, Record<string, unknown>?]> = [
        ['get', '/api/admin/shipping/zones'],
        ['post', '/api/admin/shipping/zones', { code: 'MGR_ZONE', name: 'M', districts: [] }],
        ['patch', `/api/admin/shipping/zones/${zone.id}`, { name: 'Renamed' }],
        ['post', `/api/admin/shipping/zones/${zone.id}/make-default`, {}],
        ['get', `/api/admin/shipping/zones/${zone.id}/rates`],
        ['post', `/api/admin/shipping/zones/${zone.id}/rates`, { strategy: 'FLAT', flatAmount: 1 }],
        ['get', '/api/admin/shipping/unmatched-districts'],
      ];

      for (const [method, url, body] of calls) {
        const anon = await (request(app) as unknown as Record<string, (u: string) => request.Test>)[method]!(url).send(body);
        expect(anon.status, `${method} ${url} anonymous`).toBe(401);

        const asManager =
          method === 'get' ? manager.agent.get(url) : method === 'patch' ? manager.patch(url).send(body) : manager.post(url).send(body);
        expect((await asManager).status, `${method} ${url} manager`).toBe(403);
      }

      // The Manager's failed write changed nothing.
      expect((await zoneByCode('INSIDE_DHAKA')).name).toBe('Inside Dhaka');
      expect((await zones()).some((z) => z.code === 'MGR_ZONE')).toBe(false);
    });

    it('lists every seeded zone with its districts and current rate', async () => {
      const list = await zones();
      expect(list.map((z) => z.code)).toEqual(['INSIDE_DHAKA', 'DHAKA_SUBURB', 'OUTSIDE_DHAKA']);
      expect(list.filter((z) => z.isDefault).map((z) => z.code)).toEqual(['OUTSIDE_DHAKA']);
      expect(list[0]!.districts).toEqual([{ district: 'Dhaka', metroOnly: true }]);
      expect(list[0]!.currentRate).toMatchObject({ strategy: 'FLAT', flatAmount: 60 });
    });

    it('creates a zone atomically with its rate and districts, audits it, and prices orders with it', async () => {
      const res = await admin.post('/api/admin/shipping/zones').send({
        code: 'SYLHET_ZONE',
        name: 'Sylhet Division',
        sortOrder: 9,
        districts: [{ district: 'Sylhet', metroOnly: false }],
        rate: { strategy: 'FLAT', flatAmount: 150 },
      });
      expect(res.status).toBe(201);
      expect(res.body.data.currentRate).toMatchObject({ strategy: 'FLAT', flatAmount: 150 });

      const order = await placeOrder({ guestFields: { district: 'sylhet', division: 'Sylhet', areaUnitType: 'UPAZILA' } });
      expect(order.status, JSON.stringify(order.body)).toBe(201);
      expect(order.body.data.shippingAmount).toBe(150);
      expect((await orderRow(order.body.data.orderNumber)).shipping_zone_code).toBe('SYLHET_ZONE');

      const audited = await withTransaction(async (client) => {
        const { rows } = await client.query(`SELECT action FROM audit_logs WHERE entity_type = 'shipping_zone' AND entity_id = $1`, [res.body.data.id]);
        return rows.map((r) => r.action);
      });
      expect(audited).toContain('shipping_zone_created');
    });

    it('rejects districts without a rate, duplicate codes, duplicate districts and bad codes', async () => {
      const noRate = await admin.post('/api/admin/shipping/zones').send({
        code: 'NO_RATE', name: 'No rate', districts: [{ district: 'Khulna', metroOnly: false }],
      });
      expect(noRate.status).toBe(400);

      const dupCode = await admin.post('/api/admin/shipping/zones').send({ code: 'SYLHET_ZONE', name: 'Dup', districts: [] });
      expect(dupCode.status).toBe(409);
      expect(dupCode.body.error.code).toBe('SHIPPING_ZONE_CODE_EXISTS');

      const dupDistrict = await admin.post('/api/admin/shipping/zones').send({
        code: 'DUP_DISTRICT', name: 'Dup district',
        districts: [{ district: 'GAZIPUR', metroOnly: false }],
        rate: { strategy: 'FLAT', flatAmount: 10 },
      });
      expect(dupDistrict.status).toBe(409);
      expect(dupDistrict.body.error.code).toBe('SHIPPING_DISTRICT_ALREADY_MAPPED');
      expect((await zones()).some((z) => z.code === 'DUP_DISTRICT')).toBe(false); // rolled back atomically

      const listedTwice = await admin.post('/api/admin/shipping/zones').send({
        code: 'TWICE', name: 'Twice',
        districts: [{ district: 'Rangpur', metroOnly: false }, { district: ' rangpur ', metroOnly: false }],
        rate: { strategy: 'FLAT', flatAmount: 10 },
      });
      expect(listedTwice.status).toBe(400);

      const badCode = await admin.post('/api/admin/shipping/zones').send({ code: 'lower case', name: 'Bad', districts: [] });
      expect(badCode.status).toBe(400);
    });

    it('replaces a zone\'s district list in full, which also clears a matching unmatched entry', async () => {
      const zone = await zoneByCode('SYLHET_ZONE');
      const res = await admin.patch(`/api/admin/shipping/zones/${zone.id}`).send({
        name: 'Sylhet & Rangpur',
        districts: [{ district: 'Sylhet', metroOnly: false }, { district: 'Atlantis', metroOnly: false }],
      });
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Sylhet & Rangpur');
      expect(res.body.data.districts).toHaveLength(2);

      const unmatched = await admin.agent.get('/api/admin/shipping/unmatched-districts');
      expect(unmatched.body.data.map((d: { district: string }) => d.district)).not.toContain('Atlantis');

      const shrink = await admin.patch(`/api/admin/shipping/zones/${zone.id}`).send({ districts: [{ district: 'Sylhet', metroOnly: false }] });
      expect(shrink.body.data.districts).toEqual([{ district: 'Sylhet', metroOnly: false }]);

      expect((await admin.patch(`/api/admin/shipping/zones/${zone.id}`).send({})).status).toBe(400);
      expect((await admin.patch(`/api/admin/shipping/zones/${zone.id}`).send({ code: 'NEW_CODE' })).status).toBe(400);
      expect((await admin.patch('/api/admin/shipping/zones/00000000-0000-4000-8000-000000000000').send({ name: 'x' })).status).toBe(404);
    });

    it('swaps the default zone in one step and keeps exactly one default (test 10)', async () => {
      const target = await zoneByCode('DHAKA_SUBURB');
      const res = await admin.post(`/api/admin/shipping/zones/${target.id}/make-default`).send({});
      expect(res.status).toBe(200);
      expect(res.body.data.isDefault).toBe(true);
      expect((await zones()).filter((z) => z.isDefault).map((z) => z.code)).toEqual(['DHAKA_SUBURB']);

      // An unmapped district now prices at the new default (100).
      const q = await request(app).get('/api/shipping/quote').query({ district: 'Nowhere-Else', areaUnitType: 'UPAZILA' });
      expect(q.body.data.amount).toBe(100);

      const back = await zoneByCode('OUTSIDE_DHAKA');
      expect((await admin.post(`/api/admin/shipping/zones/${back.id}/make-default`).send({})).status).toBe(200);
      expect((await zones()).filter((z) => z.isDefault).map((z) => z.code)).toEqual(['OUTSIDE_DHAKA']);

      const audited = await withTransaction(async (client) => {
        const { rows } = await client.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'shipping_default_zone_changed'`);
        return rows[0].n as number;
      });
      expect(audited).toBe(2);
    });

    it('exposes no delete route for zones, districts or rates', async () => {
      const zone = await zoneByCode('INSIDE_DHAKA');
      for (const url of [`/api/admin/shipping/zones/${zone.id}`, `/api/admin/shipping/zones/${zone.id}/rates`]) {
        const res = await admin.del(url);
        expect([404, 405]).toContain(res.status);
      }
      expect(await zoneByCode('INSIDE_DHAKA')).toBeTruthy();
    });
  });

  // ---- concurrency (test 8) -----------------------------------------------------------------------

  describe('concurrency (test 8)', () => {
    it('rate inserts during in-flight checkouts never produce an order that violates the total invariant', async () => {
      const placed = Promise.all(Array.from({ length: 8 }, () => placeOrder()));
      const changes = (async () => {
        for (const amount of [70, 80, 90, 60]) {
          await setRate('INSIDE_DHAKA', { strategy: 'FLAT', flatAmount: amount });
        }
      })();
      const [orders] = await Promise.all([placed, changes]);

      expect(orders.every((o) => o.status === 201)).toBe(true);
      for (const o of orders) {
        // Each order carries a coherent snapshot of ONE rate: total = subtotal + shipping, shipping in the set.
        expect([60, 70, 80, 90]).toContain(o.body.data.shippingAmount);
        expect(o.body.data.totalAmount).toBe(o.body.data.subtotal + o.body.data.shippingAmount);
      }

      const violations = await withTransaction(async (client) => {
        const { rows } = await client.query(
          `SELECT count(*)::int AS n FROM orders
            WHERE total_amount <> subtotal - COALESCE(discount_amount, 0) + shipping_amount`,
        );
        return rows[0].n as number;
      });
      expect(violations).toBe(0);
    });
  });
});
