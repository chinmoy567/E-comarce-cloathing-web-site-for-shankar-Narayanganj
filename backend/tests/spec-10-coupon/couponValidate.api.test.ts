import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.js';
import { applyTestEnv } from '../helpers/testEnv.js';
import { resetEnvCache } from '../../src/config/env.js';

/**
 * Spec 10 — POST /api/coupons/validate (S2). Tests required items 8, 15, 19,
 * 22, and acceptance items 6, 19.
 */
const SCHEMA = 'spec10_coupon_validate_api';

describe.skipIf(!TEST_DATABASE_URL)('POST /api/coupons/validate (10-coupon-discount §8.15a, §8.18)', () => {
  let app: Express;
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;
  let withTransactionFn: typeof import('../../src/lib/transaction.js').withTransaction;
  let usersRepository: typeof import('../../src/repositories/users.repository.js');
  let categoriesRepository: typeof import('../../src/repositories/categories.repository.js');
  let productsRepository: typeof import('../../src/repositories/products.repository.js');
  let productVariantsRepository: typeof import('../../src/repositories/productVariants.repository.js');
  let couponRepository: typeof import('../../src/repositories/coupon.repository.js');
  let hashPassword: typeof import('../../src/lib/password.js').hashPassword;

  let adminId: string;
  let categoryId: string;
  let variantId: string;

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    applyTestEnv();
    // This file makes many sequential /validate calls against the same
    // unauthenticated IP counter across many `it` blocks — set the ceiling
    // far above that so only the dedicated rate-limit test below (which
    // overrides this itself, then restores it) actually observes a 429.
    process.env.RL_COUPON_VALIDATE_MAX = '10000';
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    resetEnvCache();

    ({ resetTransactionPool, withTransaction: withTransactionFn } = await import('../../src/lib/transaction.js'));
    await resetTransactionPool();
    usersRepository = await import('../../src/repositories/users.repository.js');
    categoriesRepository = await import('../../src/repositories/categories.repository.js');
    productsRepository = await import('../../src/repositories/products.repository.js');
    productVariantsRepository = await import('../../src/repositories/productVariants.repository.js');
    couponRepository = await import('../../src/repositories/coupon.repository.js');
    ({ hashPassword } = await import('../../src/lib/password.js'));
    const { createApp } = await import('../../src/app.js');
    app = createApp();

    const passwordHash = await hashPassword('CouponValidateApiPass12');
    adminId = (
      await usersRepository.create({
        role: 'ADMIN',
        userIdentifier: 'coupon-validate-admin',
        passwordHash,
        mustChangePassword: false,
      })
    ).id;

    const category = await categoriesRepository.create({
      name: 'Validate Test Category',
      slug: 'validate-test-category',
      createdBy: adminId,
    });
    categoryId = category.id;

    const product = await productsRepository.create({
      categoryId,
      name: 'Validate Test Product',
      slug: 'validate-test-product',
      basePrice: 1000,
      createdBy: adminId,
    });
    // Activate the product so the pricing lookup finds it.
    await withTransactionFn((client) => client.query(`UPDATE products SET status = 'ACTIVE' WHERE id = $1`, [product.id]));

    const variant = await productVariantsRepository.create({
      productId: product.id,
      stockQuantity: 100,
    });
    variantId = variant.id;
  }, 60_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  async function createActiveCoupon(overrides: Record<string, unknown> = {}) {
    return couponRepository.create({
      code: `VALCODE${Date.now()}${Math.floor(Math.random() * 10000)}`,
      name: 'Validate Test Coupon',
      discountType: 'PERCENTAGE',
      discountValue: 10,
      startsAt: new Date('2026-01-01T00:00:00.000Z'),
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      status: 'ACTIVE',
      createdBy: adminId,
      ...overrides,
    });
  }

  // -------------------------------------------------------------------------
  // Acceptance 6 / test 8: non-enumeration.
  // -------------------------------------------------------------------------
  it('a nonexistent code, a DRAFT coupon, a DISABLED coupon, and an archived coupon all return byte-identical rejection (acceptance 6)', async () => {
    const draft = await createActiveCoupon({ status: 'DRAFT' });
    const disabled = await createActiveCoupon({ status: 'DISABLED' });
    const archived = await createActiveCoupon({ status: 'ACTIVE' });
    await couponRepository.setArchived(archived.id, true);

    const bodies = [
      { code: 'DOES-NOT-EXIST-CODE', lines: [{ variantId, quantity: 1 }] },
      { code: draft.code, lines: [{ variantId, quantity: 1 }] },
      { code: disabled.code, lines: [{ variantId, quantity: 1 }] },
      { code: archived.code, lines: [{ variantId, quantity: 1 }] },
    ];

    const results = await Promise.all(bodies.map((body) => request(app).post('/api/coupons/validate').send(body)));

    for (const res of results) {
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ valid: false, message: 'Invalid coupon code.' });
    }
  });

  // -------------------------------------------------------------------------
  // Acceptance 7: lifecycle rejection messages over HTTP.
  // -------------------------------------------------------------------------
  it('a coupon before starts_at returns "not active yet"; after expires_at returns "expired" (acceptance 7)', async () => {
    const future = await createActiveCoupon({
      startsAt: new Date('2099-01-01T00:00:00.000Z'),
      expiresAt: new Date('2099-06-01T00:00:00.000Z'),
    });
    const past = await createActiveCoupon({
      startsAt: new Date('2020-01-01T00:00:00.000Z'),
      expiresAt: new Date('2020-06-01T00:00:00.000Z'),
    });

    const futureRes = await request(app)
      .post('/api/coupons/validate')
      .send({ code: future.code, lines: [{ variantId, quantity: 1 }] });
    expect(futureRes.body.data).toEqual({ valid: false, message: 'This coupon is not active yet.' });

    const pastRes = await request(app)
      .post('/api/coupons/validate')
      .send({ code: past.code, lines: [{ variantId, quantity: 1 }] });
    expect(pastRes.body.data).toEqual({ valid: false, message: 'This coupon has expired.' });
  });

  // -------------------------------------------------------------------------
  // A valid preview returns the exact §8.18a shape.
  // -------------------------------------------------------------------------
  it('a valid code returns the exact §8.18a response shape and correct discount', async () => {
    const coupon = await createActiveCoupon({ discountType: 'PERCENTAGE', discountValue: 10 });
    const res = await request(app)
      .post('/api/coupons/validate')
      .send({ code: coupon.code.toLowerCase(), lines: [{ variantId, quantity: 2 }] });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      valid: true,
      couponCode: coupon.code,
      discountType: 'percentage',
      eligibleSubtotal: 2000,
      discountAmount: 200,
    });
    expect(typeof res.body.data.message).toBe('string');
  });

  // -------------------------------------------------------------------------
  // Test 14 / acceptance: preview writes nothing.
  // -------------------------------------------------------------------------
  it('a valid preview call creates no coupon_usages row and leaves usage_count unchanged (§8.15a, test 14)', async () => {
    const coupon = await createActiveCoupon();
    await request(app)
      .post('/api/coupons/validate')
      .send({ code: coupon.code, lines: [{ variantId, quantity: 1 }] });

    const reloaded = await couponRepository.findById(coupon.id);
    expect(reloaded!.usageCount).toBe(0);
    expect(await couponRepository.countUsages(coupon.id)).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Test 15: client-supplied economics rejected (§8.16).
  // -------------------------------------------------------------------------
  it('a request carrying a discountAmount field is rejected with 400 (§8.16, test 15)', async () => {
    const coupon = await createActiveCoupon();
    const res = await request(app)
      .post('/api/coupons/validate')
      .send({ code: coupon.code, lines: [{ variantId, quantity: 1 }], discountAmount: 999 });
    expect(res.status).toBe(400);
  });

  it('a request carrying a subtotal field is rejected with 400', async () => {
    const coupon = await createActiveCoupon();
    const res = await request(app)
      .post('/api/coupons/validate')
      .send({ code: coupon.code, lines: [{ variantId, quantity: 1 }], subtotal: 5000 });
    expect(res.status).toBe(400);
  });

  it('a request carrying a total field is rejected with 400', async () => {
    const coupon = await createActiveCoupon();
    const res = await request(app)
      .post('/api/coupons/validate')
      .send({ code: coupon.code, lines: [{ variantId, quantity: 1 }], total: 4500 });
    expect(res.status).toBe(400);
  });

  // -------------------------------------------------------------------------
  // Test 16: server time only — a client-supplied timestamp field is rejected.
  // -------------------------------------------------------------------------
  it('a request carrying a now/timestamp field is rejected with 400 (§8.5, test 16)', async () => {
    const coupon = await createActiveCoupon();
    const res = await request(app)
      .post('/api/coupons/validate')
      .send({ code: coupon.code, lines: [{ variantId, quantity: 1 }], now: '2020-01-01T00:00:00.000Z' });
    expect(res.status).toBe(400);
  });

  // -------------------------------------------------------------------------
  // Missing/malformed request shape.
  // -------------------------------------------------------------------------
  it('rejects a request with no lines with 400', async () => {
    const res = await request(app).post('/api/coupons/validate').send({ code: 'ANY', lines: [] });
    expect(res.status).toBe(400);
  });

  it('an unknown/inactive variant id contributes nothing rather than erroring', async () => {
    const coupon = await createActiveCoupon({ minimumOrderAmount: null });
    const res = await request(app)
      .post('/api/coupons/validate')
      .send({ code: coupon.code, lines: [{ variantId: '00000000-0000-4000-8000-000000000000', quantity: 1 }] });
    expect(res.status).toBe(200);
    // eligibleSubtotal is 0 for an unknown variant, so a PERCENTAGE coupon still "applies" for ৳0.
    expect(res.body.data.valid).toBe(true);
    expect(res.body.data.eligibleSubtotal).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Test 22: rate limiting — under vs over the limit.
  // -------------------------------------------------------------------------
  describe('rate limiting (§8.28, test 22, acceptance 19)', () => {
    it('requests under the limit succeed; exceeding it returns 429', async () => {
      const { resetRateLimiterStore } = await import('../../src/lib/rateLimiterStore.js');
      process.env.RL_COUPON_VALIDATE_MAX = '3';
      process.env.RL_COUPON_VALIDATE_WINDOW_SEC = '600';
      resetEnvCache();
      resetRateLimiterStore();

      const coupon = await createActiveCoupon();
      const agent = request.agent(app);

      try {
        for (let i = 0; i < 3; i++) {
          const res = await agent
            .post('/api/coupons/validate')
            .send({ code: coupon.code, lines: [{ variantId, quantity: 1 }] });
          expect(res.status).toBe(200);
        }

        const overLimitRes = await agent
          .post('/api/coupons/validate')
          .send({ code: coupon.code, lines: [{ variantId, quantity: 1 }] });
        expect(overLimitRes.status).toBe(429);
      } finally {
        delete process.env.RL_COUPON_VALIDATE_MAX;
        delete process.env.RL_COUPON_VALIDATE_WINDOW_SEC;
        resetEnvCache();
        resetRateLimiterStore();
      }
    });
  });
});
