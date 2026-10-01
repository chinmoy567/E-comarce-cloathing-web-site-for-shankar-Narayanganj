import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.ts';
import { applyTestEnv } from '../helpers/testEnv.ts';
import { resetEnvCache } from '../../src/config/env.ts';

/**
 * Separate rate limiters for the two public lookups (implementation spec 15, test 13,
 * acceptance 15-16; 04-courier §4.16, 11-security §11.2/§11.3).
 *
 * Limits are tiny so they can be exhausted. Each limiter has an under-limit success and an
 * over-limit 429, and exhausting one must leave the other usable.
 */
const SCHEMA = 'spec15_limits';
const TRACK_MAX = 3;
const GUEST_MAX = 3;

describe.skipIf(!TEST_DATABASE_URL)('lookup rate limiters (spec 15)', () => {
  let app: Express;
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;
  let resetRateLimiterStore: typeof import('../../src/lib/rateLimiterStore.js').resetRateLimiterStore;

  const track = (id: string) => request(app).post('/api/track-order').send({ trackingId: id });
  const guest = (n: string) => request(app).post('/api/orders/lookup').send({ orderNumber: n, phoneNumber: '01770000099' });

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    applyTestEnv();
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    process.env.RL_PUBLIC_CEILING_MAX = '100000';
    process.env.RL_TRACK_ORDER_MAX = String(TRACK_MAX);
    process.env.RL_GUEST_LOOKUP_MAX = String(GUEST_MAX);
    resetEnvCache();

    ({ resetRateLimiterStore } = await import('../../src/lib/rateLimiterStore.js'));
    ({ resetTransactionPool } = await import('../../src/lib/transaction.js'));
    await resetTransactionPool();
    const { createApp } = await import('../../src/app.js');
    app = createApp();
  }, 90_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  beforeEach(() => resetRateLimiterStore());

  it('Track Order: under the limit succeeds, over it returns 429 with Retry-After and a non-revealing message', async () => {
    for (let i = 0; i < TRACK_MAX; i += 1) expect((await track(`TEST-ONLY-NOSUCH-${i}`)).status).toBe(200);
    const blocked = await track('TEST-ONLY-NOSUCH-9');
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toMatch(/^\d+$/);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.body.error.message).not.toMatch(/exist|found|valid|tracking/i);
  });

  it('guest lookup: under the limit succeeds, over it returns 429 with Retry-After', async () => {
    for (let i = 0; i < GUEST_MAX; i += 1) expect((await guest('FBK-00000000-AAAAAA')).status).toBe(200);
    const blocked = await guest('FBK-00000000-AAAAAA');
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toMatch(/^\d+$/);
    expect(blocked.body.error.message).not.toMatch(/exist|found|match/i);
  });

  it('exhausting Track Order does not consume the guest lookup budget', async () => {
    for (let i = 0; i < TRACK_MAX + 1; i += 1) await track(`TEST-ONLY-NOSUCH-${i}`);
    expect((await track('TEST-ONLY-NOSUCH-X')).status).toBe(429);
    expect((await guest('FBK-00000000-BBBBBB')).status).toBe(200);
  });

  it('exhausting the guest lookup does not consume the Track Order budget', async () => {
    for (let i = 0; i < GUEST_MAX + 1; i += 1) await guest('FBK-00000000-CCCCCC');
    expect((await guest('FBK-00000000-CCCCCC')).status).toBe(429);
    expect((await track('TEST-ONLY-NOSUCH-Y')).status).toBe(200);
  });
});
