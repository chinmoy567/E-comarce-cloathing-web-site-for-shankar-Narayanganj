import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.js';
import { applyTestEnv } from '../helpers/testEnv.js';
import { resetEnvCache } from '../../src/config/env.js';

/**
 * Spec 21 security regressions on the public pricing endpoint:
 *  - a coupon code on `POST /api/checkout/validate` is a coupon-validity oracle, so it must meet the
 *    same `couponValidate` limiter as `POST /api/coupons/validate` (10-coupon-discount §8.28);
 *    requests without a code stay on the general ceiling;
 *  - an unbounded `lines` array is rejected (bounded work per request).
 */
const SCHEMA = 'spec21_shipping_limits';

describe.skipIf(!TEST_DATABASE_URL)('shipping public endpoint limits (spec 21)', () => {
  let app: Express;
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;

  const uuid = '00000000-0000-4000-8000-000000000001';
  const delivery = { district: 'Dhaka', areaUnitType: 'THANA' };

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    applyTestEnv();
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    process.env.RL_PUBLIC_CEILING_MAX = '100000';
    process.env.RL_COUPON_VALIDATE_MAX = '3';
    process.env.RL_COUPON_VALIDATE_WINDOW_SEC = '600';
    resetEnvCache();
    ({ resetTransactionPool } = await import('../../src/lib/transaction.js'));
    await resetTransactionPool();
    const { resetRateLimiterStore } = await import('../../src/lib/rateLimiterStore.js');
    resetRateLimiterStore();
    const { createApp } = await import('../../src/app.js');
    app = createApp();
  }, 60_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  it('rate-limits coupon-code guessing through checkout/validate with the couponValidate limiter', async () => {
    const attempt = () =>
      request(app)
        .post('/api/checkout/validate')
        .send({ lines: [{ productId: uuid, variantId: null, quantity: 1 }], couponCode: 'GUESS1', delivery });

    // The first three attempts reach the controller (400/404 for the unknown product is fine — not 429).
    for (let i = 0; i < 3; i += 1) expect((await attempt()).status).not.toBe(429);

    const limited = await attempt();
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('does not apply the coupon limiter to requests without a coupon code', async () => {
    for (let i = 0; i < 6; i += 1) {
      const res = await request(app)
        .post('/api/checkout/validate')
        .send({ lines: [{ productId: uuid, variantId: null, quantity: 1 }], delivery });
      expect(res.status).not.toBe(429);
    }
  });

  it('rejects more than 50 cart lines on both validate and order creation', async () => {
    const lines = Array.from({ length: 51 }, () => ({ productId: uuid, variantId: null, quantity: 1 }));
    const validate = await request(app).post('/api/checkout/validate').send({ lines, delivery });
    expect(validate.status).toBe(400);
    expect(validate.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'lines' })]));

    const order = await request(app).post('/api/customer/orders').send({ paymentMethod: 'COD', lines, idempotencyKey: 'too-many-lines' });
    expect(order.status).toBe(400);
  });

  it('bounds the unmatched-district key so a huge guest district cannot bloat the tally', async () => {
    const { withTransaction } = await import('../../src/lib/transaction.js');
    const shippingRepository = await import('../../src/repositories/shipping.repository.js');
    const huge = 'x'.repeat(5000);
    await withTransaction((client) => shippingRepository.recordUnmatchedDistrict(huge, client));
    const rows = await withTransaction(async (client) => {
      const { rows } = await client.query<{ k: number; t: number }>(
        `SELECT length(district_key) AS k, length(district_text) AS t FROM shipping_unmatched_districts`,
      );
      return rows;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.k).toBeLessThanOrEqual(200);
    expect(rows[0]!.t).toBeLessThanOrEqual(200);
  });
});
