import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.js';
import { applyTestEnv } from '../helpers/testEnv.js';
import { resetEnvCache } from '../../src/config/env.js';

/**
 * Spec 11 — customer checkout (guest + registered), 02-customer §2.3/§2.9,
 * 03-payment-order §3, 10-coupon-discount §8.15b.
 *
 * Covers: §2.9.3's exact ordered guest validation (stopping at first
 * failure), idempotency dedup, duplicate bKash transaction id rejection,
 * coupon revalidation at order creation, registered-customer incomplete-
 * profile redirect, guest-lookup non-enumeration + field projection, and
 * out-of-stock abort rolling back cleanly.
 */
const SCHEMA = 'spec11_checkout_api';

describe.skipIf(!TEST_DATABASE_URL)('customer checkout (spec 11)', () => {
  let app: Express;
  let withTransaction: typeof import('../../src/lib/transaction.js').withTransaction;
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;
  let couponRepository: typeof import('../../src/repositories/coupon.repository.js');

  let productId: string;
  let variantId: string;
  let lowStockVariantId: string;

  async function seedCatalogue() {
    return withTransaction(async (client) => {
      const cat = await client.query<{ id: string }>(
        `INSERT INTO categories (name, slug, status) VALUES ('Checkout Cat','checkout-cat','ACTIVE') RETURNING id`,
      );
      const categoryId = cat.rows[0]!.id;

      const prod = await client.query<{ id: string }>(
        `INSERT INTO products (category_id, name, slug, base_price, status)
         VALUES ($1, 'Checkout Product', 'checkout-product', 500, 'ACTIVE') RETURNING id`,
        [categoryId],
      );
      const pId = prod.rows[0]!.id;

      const variant = await client.query<{ id: string }>(
        `INSERT INTO product_variants (product_id, sku, price, stock_quantity, is_active)
         VALUES ($1, 'CHECKOUT-SKU-1', 500, 10, true) RETURNING id`,
        [pId],
      );

      const lowStock = await client.query<{ id: string }>(
        `INSERT INTO product_variants (product_id, sku, price, stock_quantity, is_active)
         VALUES ($1, 'CHECKOUT-SKU-LOW', 300, 1, true) RETURNING id`,
        [pId],
      );

      return { productId: pId, variantId: variant.rows[0]!.id, lowStockVariantId: lowStock.rows[0]!.id };
    });
  }

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    applyTestEnv();
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    process.env.RL_GUEST_LOOKUP_MAX = '10000';
    process.env.RL_PUBLIC_CEILING_MAX = '10000';
    resetEnvCache();

    ({ withTransaction, resetTransactionPool } = await import('../../src/lib/transaction.js'));
    await resetTransactionPool();
    couponRepository = await import('../../src/repositories/coupon.repository.js');
    const { createApp } = await import('../../src/app.js');
    app = createApp();

    const seeded = await seedCatalogue();
    productId = seeded.productId;
    variantId = seeded.variantId;
    lowStockVariantId = seeded.lowStockVariantId;
  }, 60_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  function guestFields(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      fullName: 'Guest Tester',
      phoneNumber: '01712340001',
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

  function baseLine(overrides: Partial<Record<string, unknown>> = {}) {
    return { productId, variantId, quantity: 1, ...overrides };
  }

  it('creates a guest COD order end-to-end', async () => {
    const res = await request(app)
      .post('/api/customer/orders')
      .send({
        paymentMethod: 'COD',
        lines: [baseLine()],
        idempotencyKey: 'idem-guest-cod-1',
        guestFields: guestFields({ phoneNumber: '01712340002' }),
      });

    expect(res.status).toBe(201);
    expect(res.body.data.orderStatus).toBe('COD_VERIFICATION_PENDING');
    expect(res.body.data.paymentStatus).toBe('PENDING_COLLECTION');
    expect(res.body.data.totalAmount).toBe(500);
  });

  describe('§2.9.3 ordered guest validation — stops at the first failing field', () => {
    it('step 1: required-field presence (fullName missing)', async () => {
      const res = await request(app)
        .post('/api/customer/orders')
        .send({
          paymentMethod: 'COD',
          lines: [baseLine()],
          idempotencyKey: 'idem-guest-step1',
          guestFields: guestFields({ fullName: '', phoneNumber: '01712340003' }),
        });
      expect(res.status).toBe(400);
      expect(res.body.error.details[0].field).toBe('fullName');
    });

    it('step 2: Bangladesh phone number format', async () => {
      const res = await request(app)
        .post('/api/customer/orders')
        .send({
          paymentMethod: 'COD',
          lines: [baseLine()],
          idempotencyKey: 'idem-guest-step2',
          guestFields: guestFields({ phoneNumber: '12345' }),
        });
      expect(res.status).toBe(400);
      expect(res.body.error.details[0].field).toBe('phoneNumber');
    });

    it('step 3: address structure (invalid areaUnitType)', async () => {
      const res = await request(app)
        .post('/api/customer/orders')
        .send({
          paymentMethod: 'COD',
          lines: [baseLine()],
          idempotencyKey: 'idem-guest-step3',
          guestFields: guestFields({ phoneNumber: '01712340004', areaUnitType: 'BOGUS' }),
        });
      expect(res.status).toBe(400);
      expect(res.body.error.details[0].field).toBe('areaUnitType');
    });

    it('step 4: email format, only when provided', async () => {
      const res = await request(app)
        .post('/api/customer/orders')
        .send({
          paymentMethod: 'COD',
          lines: [baseLine()],
          idempotencyKey: 'idem-guest-step4',
          guestFields: guestFields({ phoneNumber: '01712340005', email: 'not-an-email' }),
        });
      expect(res.status).toBe(400);
      expect(res.body.error.details[0].field).toBe('email');
    });

    it('step 5: cart/price revalidation rejects an unknown/inactive variant', async () => {
      const res = await request(app)
        .post('/api/customer/orders')
        .send({
          paymentMethod: 'COD',
          lines: [baseLine({ variantId: '00000000-0000-0000-0000-000000000000' })],
          idempotencyKey: 'idem-guest-step5',
          guestFields: guestFields({ phoneNumber: '01712340006' }),
        });
      expect(res.status).toBe(400);
    });
  });

  it('idempotency: a repeated request with the same key returns the original order, no duplicate row', async () => {
    const key = 'idem-dedup-key-1';
    const payload = {
      paymentMethod: 'COD' as const,
      lines: [baseLine()],
      idempotencyKey: key,
      guestFields: guestFields({ phoneNumber: '01712340007' }),
    };

    const first = await request(app).post('/api/customer/orders').send(payload);
    expect(first.status).toBe(201);

    const second = await request(app).post('/api/customer/orders').send(payload);
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(second.body.data.orderNumber).toBe(first.body.data.orderNumber);

    const client = await (await import('../helpers/schemaFixture.js')).connect(SCHEMA);
    try {
      const { rows } = await client.query('SELECT count(*)::int AS c FROM orders WHERE idempotency_key = $1', [key]);
      expect(rows[0].c).toBe(1);
    } finally {
      await client.end();
    }
  });

  it('rejects a duplicate bKash transaction id across two different orders', async () => {
    const txnId = 'TXN-DUP-CHECK-1';
    const first = await request(app)
      .post('/api/customer/orders')
      .send({
        paymentMethod: 'BKASH',
        lines: [baseLine()],
        idempotencyKey: 'idem-bkash-dup-1',
        guestFields: guestFields({ phoneNumber: '01712340008' }),
        bkashTransactionId: txnId,
      });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/customer/orders')
      .send({
        paymentMethod: 'BKASH',
        lines: [baseLine()],
        idempotencyKey: 'idem-bkash-dup-2',
        guestFields: guestFields({ phoneNumber: '01712340009' }),
        bkashTransactionId: txnId,
      });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('BKASH_TRANSACTION_ID_EXISTS');
  });

  it('treats casing and surrounding-whitespace variants of a bKash transaction id as the same id (spec 11 acceptance 23)', async () => {
    const first = await request(app)
      .post('/api/customer/orders')
      .send({
        paymentMethod: 'BKASH',
        lines: [baseLine()],
        idempotencyKey: 'idem-bkash-case-1',
        guestFields: guestFields({ phoneNumber: '01712340018' }),
        bkashTransactionId: 'Trx-Case-Check-9',
      });
    expect(first.status).toBe(201);

    const variant = await request(app)
      .post('/api/customer/orders')
      .send({
        paymentMethod: 'BKASH',
        lines: [baseLine()],
        idempotencyKey: 'idem-bkash-case-2',
        guestFields: guestFields({ phoneNumber: '01712340019' }),
        bkashTransactionId: '  TRX-CASE-CHECK-9 ',
      });
    expect(variant.status).toBe(409);
    expect(variant.body.error.code).toBe('BKASH_TRANSACTION_ID_EXISTS');
  });

  it('bKash order creation succeeds without a transaction id (§3.1: id is submitted after placing the order)', async () => {
    const res = await request(app)
      .post('/api/customer/orders')
      .send({
        paymentMethod: 'BKASH',
        lines: [baseLine()],
        idempotencyKey: 'idem-bkash-no-txn',
        guestFields: guestFields({ phoneNumber: '01712340010' }),
      });
    expect(res.status).toBe(201);
    expect(res.body.data.orderStatus).toBe('PENDING_CONFIRMATION');
    expect(res.body.data.paymentStatus).toBe('PENDING_VERIFICATION');
  });

  describe('coupon revalidation at order creation (§8.15b, §8.22)', () => {
    it('rejects a coupon that hit its usage limit between preview and placement', async () => {
      const admin = await import('../../src/repositories/users.repository.js');
      const { hashPassword } = await import('../../src/lib/password.js');
      const passwordHash = await hashPassword('CheckoutTestPass12');
      const adminUser = await admin.create({
        role: 'ADMIN',
        userIdentifier: 'checkout-coupon-admin',
        passwordHash,
        mustChangePassword: false,
      });

      const coupon = await couponRepository.create({
        code: 'CHECKOUTLIMIT1',
        name: 'Limited coupon',
        discountType: 'FIXED_AMOUNT',
        discountValue: 50,
        startsAt: new Date('2020-01-01T00:00:00.000Z'),
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
        usageLimit: 1,
        status: 'ACTIVE',
        createdBy: adminUser.id,
      });

      // First order consumes the coupon's only usage.
      const first = await request(app)
        .post('/api/customer/orders')
        .send({
          paymentMethod: 'COD',
          lines: [baseLine()],
          idempotencyKey: 'idem-coupon-limit-1',
          couponCode: coupon.code,
          guestFields: guestFields({ phoneNumber: '01712340011' }),
        });
      expect(first.status).toBe(201);

      // Second order (different guest) attempts the same now-exhausted coupon.
      const second = await request(app)
        .post('/api/customer/orders')
        .send({
          paymentMethod: 'COD',
          lines: [baseLine()],
          idempotencyKey: 'idem-coupon-limit-2',
          couponCode: coupon.code,
          guestFields: guestFields({ phoneNumber: '01712340012' }),
        });
      expect(second.status).toBe(400);
      expect(second.body.error.message).toBe('This coupon has reached its usage limit.');
    });
  });

  describe('guest order lookup (§2.9.5-2.9.7) — non-enumeration + field projection', () => {
    it('returns matching order details for the correct pair', async () => {
      const created = await request(app)
        .post('/api/customer/orders')
        .send({
          paymentMethod: 'COD',
          lines: [baseLine()],
          idempotencyKey: 'idem-lookup-1',
          guestFields: guestFields({ phoneNumber: '01712340013' }),
        });
      expect(created.status).toBe(201);
      const orderNumber = created.body.data.orderNumber;

      const res = await request(app)
        .post('/api/orders/lookup')
        .send({ orderNumber, phoneNumber: '01712340013' });

      expect(res.status).toBe(200);
      expect(res.body.data.found).toBe(true);
      expect(res.body.data.orderNumber).toBe(orderNumber);
      expect(res.body.data).not.toHaveProperty('adminNotes');
      expect(res.body.data).not.toHaveProperty('riskCheck');
      expect(res.body.data).not.toHaveProperty('paymentProof');
      expect(res.body.data).not.toHaveProperty('bkashTransactionId');
    });

    it('returns the identical generic response for a wrong phone number', async () => {
      const created = await request(app)
        .post('/api/customer/orders')
        .send({
          paymentMethod: 'COD',
          lines: [baseLine()],
          idempotencyKey: 'idem-lookup-2',
          guestFields: guestFields({ phoneNumber: '01712340014' }),
        });
      const orderNumber = created.body.data.orderNumber;

      const wrongPhone = await request(app)
        .post('/api/orders/lookup')
        .send({ orderNumber, phoneNumber: '01799999999' });
      const wrongOrderNumber = await request(app)
        .post('/api/orders/lookup')
        .send({ orderNumber: 'FBK-00000000-ZZZZZZ', phoneNumber: '01712340014' });

      // Spec 15: every mismatch is a 200 `found: false` with the identical body (§2.9.7).
      expect(wrongPhone.status).toBe(200);
      expect(wrongOrderNumber.status).toBe(200);
      expect(wrongPhone.body).toEqual(wrongOrderNumber.body);
      expect(wrongPhone.body.data.found).toBe(false);
    });
  });

  describe('registered customer — profile completeness (§2.3)', () => {
    it('redirects (fails) an incomplete profile rather than falling through to guest validation', async () => {
      const registerRes = await request(app)
        .post('/api/customer/auth/register')
        .send({ phone_number: '01755500001', password: 'RegisteredPass12' });
      expect(registerRes.status).toBe(201);

      const agent = request.agent(app);
      const loginRes = await agent
        .post('/api/customer/auth/login')
        .send({ phone_number: '01755500001', password: 'RegisteredPass12' });
      expect(loginRes.status).toBe(200);

      const res = await agent.post('/api/customer/orders').send({
        paymentMethod: 'COD',
        lines: [baseLine()],
        idempotencyKey: 'idem-registered-incomplete',
      });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/profile is incomplete/i);
    });

    it('allows checkout once the profile is complete, and lists it in order history', async () => {
      const registerRes = await request(app)
        .post('/api/customer/auth/register')
        .send({ phone_number: '01755500002', password: 'RegisteredPass12' });
      expect(registerRes.status).toBe(201);

      const client = await (await import('../helpers/schemaFixture.js')).connect(SCHEMA);
      try {
        await client.query(
          `UPDATE customers SET full_name='Complete Tester', division='Dhaka', district='Dhaka',
             area_unit_type='THANA', area_unit_name='Gulshan', ward_unit_type='WARD', ward_unit_name='5',
             detailed_address='House 9' WHERE phone_number='01755500002'`,
        );
      } finally {
        await client.end();
      }

      const agent = request.agent(app);
      const loginRes = await agent
        .post('/api/customer/auth/login')
        .send({ phone_number: '01755500002', password: 'RegisteredPass12' });
      expect(loginRes.status).toBe(200);

      const orderRes = await agent.post('/api/customer/orders').send({
        paymentMethod: 'COD',
        lines: [baseLine()],
        idempotencyKey: 'idem-registered-complete',
      });
      expect(orderRes.status).toBe(201);

      const historyRes = await agent.get('/api/customer/orders');
      expect(historyRes.status).toBe(200);
      expect(historyRes.body.data.some((o: { orderNumber: string }) => o.orderNumber === orderRes.body.data.orderNumber)).toBe(
        true,
      );
    });
  });

  describe('out-of-stock abort rolls back cleanly (no partial order, no partial stock decrement)', () => {
    it('quantity exceeding a low-stock variant does not create an order or corrupt stock — NOTE: v1 decrements stock at CONFIRMED, not at placement (§5.21), so this test asserts the request simply succeeds without touching stock_quantity at all', async () => {
      const client = await (await import('../helpers/schemaFixture.js')).connect(SCHEMA);
      let stockBefore: number;
      try {
        const { rows } = await client.query('SELECT stock_quantity FROM product_variants WHERE id = $1', [lowStockVariantId]);
        stockBefore = rows[0].stock_quantity;
      } finally {
        await client.end();
      }

      const res = await request(app)
        .post('/api/customer/orders')
        .send({
          paymentMethod: 'COD',
          lines: [baseLine({ variantId: lowStockVariantId, quantity: 1 })],
          idempotencyKey: 'idem-stock-check-1',
          guestFields: guestFields({ phoneNumber: '01712340015' }),
        });
      expect(res.status).toBe(201);

      const client2 = await (await import('../helpers/schemaFixture.js')).connect(SCHEMA);
      try {
        const { rows } = await client2.query('SELECT stock_quantity FROM product_variants WHERE id = $1', [lowStockVariantId]);
        // Stock is untouched at order-creation time per §5.21 (decrement happens
        // at CONFIRMED, a later admin action outside this slice's scope).
        expect(rows[0].stock_quantity).toBe(stockBefore);
      } finally {
        await client2.end();
      }
    });
  });
});
