import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL } from '../helpers/schemaFixture.ts';
import { startRiskSuite, type RiskSuite } from './helpers/riskFixture.ts';

/**
 * Fresh-check rate limiting (implementation spec 16, test 11; acceptance 7;
 * 09-fraud-risk-check §7.6 "applied here to limit how often a fresh check can be triggered for
 * the same customer"; 11-security-hardening §11.3).
 *
 * Two limiters guard POST: the route's `riskCheck` limiter (per actor only — no IP counter, so staff behind one office IP are not pooled) and the service's
 * per-CUSTOMER limiter. Both read RL_RISK_CHECK_MAX/WINDOW_SEC, so to observe the customer
 * limiter over HTTP the fourth call must come from a different actor AND a different client IP
 * (X-Forwarded-For, TRUST_PROXY_HOPS=1). The customer limiter's rejection message differs from
 * the route limiter's, which is how the two are told apart. Limits are the spec's documented
 * defaults: 3 per 900 s.
 */
const SCHEMA = 'spec16_rate_limit';
const IP_A = '203.0.113.10';
const IP_B = '203.0.113.20';
const CUSTOMER_MSG = 'Too many checks for this customer. Please try again later.';
const ROUTE_MSG = 'Too many requests. Please try again later.';

describe.skipIf(!TEST_DATABASE_URL)('risk check rate limiting (spec 16)', () => {
  let s: RiskSuite;

  beforeAll(async () => {
    s = await startRiskSuite(SCHEMA, { RL_RISK_CHECK_MAX: '3', RL_RISK_CHECK_WINDOW_SEC: '900', TRUST_PROXY_HOPS: '1' });
  }, 120_000);

  afterAll(async () => {
    await s?.teardown();
  });

  beforeEach(async () => {
    s.fake.reset();
    await s.resetLimiters();
  });

  it('under the limit succeeds: three fresh checks for one customer are all 200 and three rows exist', async () => {
    const c = await s.newCustomer();
    const o = await s.newOrder(c.id);
    const a = await s.admin();
    for (let i = 0; i < 3; i += 1) {
      const res = await a.post(s.url(o.orderNumber)).set('X-Forwarded-For', IP_A).send({});
      expect(res.status, `call ${i + 1}`).toBe(200);
    }
    expect(s.fake.state.calls).toHaveLength(3);
    expect(await s.riskRows(c.id)).toHaveLength(3);
  });

  it('over the limit: the fourth fresh check is 429 RATE_LIMITED with a positive integer Retry-After, and nothing more is called or stored', async () => {
    const c = await s.newCustomer();
    const o = await s.newOrder(c.id);
    const a = await s.admin();
    for (let i = 0; i < 3; i += 1) expect((await a.post(s.url(o.orderNumber)).set('X-Forwarded-For', IP_A).send({})).status).toBe(200);

    const res = await a.post(s.url(o.orderNumber)).set('X-Forwarded-For', IP_A).send({});
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number.isInteger(Number(res.headers['retry-after']))).toBe(true);
    expect(s.fake.state.calls).toHaveLength(3);
    expect(await s.riskRows(c.id)).toHaveLength(3);
  });

  it('the limit is per customer: a different actor on a different IP is still refused for the SAME customer, by the customer limiter', async () => {
    const c = await s.newCustomer();
    const o = await s.newOrder(c.id);
    const a = await s.admin();
    const m = await s.manager();
    for (let i = 0; i < 3; i += 1) expect((await a.post(s.url(o.orderNumber)).set('X-Forwarded-For', IP_A).send({})).status).toBe(200);

    const res = await m.post(s.url(o.orderNumber)).set('X-Forwarded-For', IP_B).send({});
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(res.body.error.message).toBe(CUSTOMER_MSG);
    expect(res.body.error.message).not.toBe(ROUTE_MSG);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(s.fake.state.calls).toHaveLength(3);
    expect(await s.riskRows(c.id)).toHaveLength(3);
  });

  it('a DIFFERENT customer is unaffected by the first customer being exhausted', async () => {
    const c1 = await s.newCustomer();
    const c2 = await s.newCustomer();
    const o1 = await s.newOrder(c1.id);
    const o2 = await s.newOrder(c2.id);
    const a = await s.admin();
    const m = await s.manager();
    for (let i = 0; i < 3; i += 1) expect((await a.post(s.url(o1.orderNumber)).set('X-Forwarded-For', IP_A).send({})).status).toBe(200);
    expect((await m.post(s.url(o1.orderNumber)).set('X-Forwarded-For', IP_B).send({})).status).toBe(429);

    const other = await m.post(s.url(o2.orderNumber)).set('X-Forwarded-For', IP_B).send({});
    expect(other.status).toBe(200);
    expect(s.fake.state.calls).toEqual([c1.phone, c1.phone, c1.phone, c2.phone]);
    expect(await s.riskRows(c2.id)).toHaveLength(1);
  });

  it('staff behind ONE shared IP are not throttled together: two actors each get their own per-actor budget', async () => {
    const c1 = await s.newCustomer();
    const c2 = await s.newCustomer();
    const o1 = await s.newOrder(c1.id);
    const o2 = await s.newOrder(c2.id);
    const a = await s.admin();
    const m = await s.manager();
    for (let i = 0; i < 3; i += 1) expect((await a.post(s.url(o1.orderNumber)).set('X-Forwarded-For', IP_A).send({})).status, `admin ${i + 1}`).toBe(200);
    // Same IP, different actor, different customer: with an IP counter this would be refused.
    for (let i = 0; i < 3; i += 1) expect((await m.post(s.url(o2.orderNumber)).set('X-Forwarded-For', IP_A).send({})).status, `manager ${i + 1}`).toBe(200);
  });

  it('one actor is still capped across customers by the route limiter (per-actor budget, route message)', async () => {
    const c1 = await s.newCustomer();
    const c2 = await s.newCustomer();
    const o1 = await s.newOrder(c1.id);
    const o2 = await s.newOrder(c2.id);
    const a = await s.admin();
    for (let i = 0; i < 3; i += 1) expect((await a.post(s.url(o1.orderNumber)).set('X-Forwarded-For', IP_A).send({})).status).toBe(200);
    const res = await a.post(s.url(o2.orderNumber)).set('X-Forwarded-For', IP_B).send({});
    expect(res.status).toBe(429);
    expect(res.body.error.message).toBe(ROUTE_MSG);
    expect(await s.riskRows(c2.id)).toHaveLength(0);
  });

  it('GET is not subject to the fresh-check limiter: the cached result stays readable after exhaustion', async () => {
    const c = await s.newCustomer();
    const o = await s.newOrder(c.id);
    const a = await s.admin();
    for (let i = 0; i < 3; i += 1) await a.post(s.url(o.orderNumber)).set('X-Forwarded-For', IP_A).send({});
    expect((await a.post(s.url(o.orderNumber)).set('X-Forwarded-For', IP_A).send({})).status).toBe(429);
    for (let i = 0; i < 5; i += 1) {
      const res = await a.agent.get(s.url(o.orderNumber)).set('X-Forwarded-For', IP_A);
      expect(res.status).toBe(200);
      expect(res.body.data.available).toBe(true);
    }
    expect(s.fake.state.calls).toHaveLength(3);
  });

  describe('service level (the per-customer limiter itself)', () => {
    it('refuses the 4th check with CustomerRiskRateLimitError {status 429, RATE_LIMITED, retryAfterSec in 1..900} while customer B is unaffected', async () => {
      const svc = await import('../../src/services/fraud/customerRiskService.js');
      const c1 = await s.newCustomer();
      const c2 = await s.newCustomer();
      const o1 = await s.newOrder(c1.id);
      const o2 = await s.newOrder(c2.id);
      const actor = { userId: s.adminId };
      for (let i = 0; i < 3; i += 1) await svc.runRiskCheck(o1.orderNumber, actor);

      const err = await svc.runRiskCheck(o1.orderNumber, actor).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(svc.CustomerRiskRateLimitError);
      expect(err).toMatchObject({ status: 429, code: 'RATE_LIMITED' });
      expect((err as { retryAfterSec: number }).retryAfterSec).toBeGreaterThanOrEqual(1);
      expect((err as { retryAfterSec: number }).retryAfterSec).toBeLessThanOrEqual(900);

      expect((await svc.runRiskCheck(o2.orderNumber, actor)).available).toBe(true);
      expect(s.fake.state.calls).toHaveLength(4);
    });

    it('a request refused by the status gate does not spend the customer budget (§7.2 gate runs before the limiter)', async () => {
      const svc = await import('../../src/services/fraud/customerRiskService.js');
      const c = await s.newCustomer();
      const pending = await s.newOrder(c.id, { status: 'PENDING_CONFIRMATION' });
      const confirmed = await s.newOrder(c.id, { status: 'CONFIRMED' });
      const actor = { userId: s.adminId };
      for (let i = 0; i < 5; i += 1) {
        await expect(svc.runRiskCheck(pending.orderNumber, actor)).rejects.toMatchObject({ status: 409, code: 'RISK_CHECK_NOT_ALLOWED' });
      }
      for (let i = 0; i < 3; i += 1) await svc.runRiskCheck(confirmed.orderNumber, actor);
      expect(s.fake.state.calls).toHaveLength(3);
    });

    it('a request that cannot reach the provider (not configured: 503) does not spend the customer budget', async () => {
      const svc = await import('../../src/services/fraud/customerRiskService.js');
      const c = await s.newCustomer();
      const o = await s.newOrder(c.id, { status: 'CONFIRMED' });
      const actor = { userId: s.adminId };
      s.fake.state.configured = false;
      for (let i = 0; i < 5; i += 1) {
        await expect(svc.runRiskCheck(o.orderNumber, actor)).rejects.toMatchObject({ status: 503, code: 'RISK_PROVIDER_UNCONFIGURED' });
      }
      s.fake.state.configured = true;
      for (let i = 0; i < 3; i += 1) await svc.runRiskCheck(o.orderNumber, actor);
      expect(s.fake.state.calls).toHaveLength(3);
    });
  });
});
