import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL } from '../helpers/schemaFixture.ts';
import { RAW_MARKER, type FakeMode } from './helpers/fakeRiskProvider.ts';
import { RESPONSE_KEYS, startRiskSuite, type RiskSuite } from './helpers/riskFixture.ts';

/**
 * Graceful degradation and honest absence (implementation spec 16, tests 4, 5, 6, 15;
 * acceptance 8, 9, 10, 18; 09-fraud-risk-check §7.5, §7.8, §7.11) plus the 422 / 503 error rows.
 *
 * Real HTTP + Postgres; only the provider is scripted. Persisted rows and order state are read
 * back after every failure: a returned 200 alone would not prove the row was stored or the
 * order left alone. The provider's own failure modes (timeout, HTTP 500, malformed body) are
 * driven through the real adapter in provider-request.unit.test.ts.
 */
const SCHEMA = 'spec16_failure';
const UNAVAILABLE = 'Risk check unavailable — please try again.';

describe.skipIf(!TEST_DATABASE_URL)('risk check failure handling (spec 16)', () => {
  let s: RiskSuite;

  beforeAll(async () => {
    s = await startRiskSuite(SCHEMA);
  }, 120_000);

  afterAll(async () => {
    await s?.teardown();
  });

  beforeEach(() => s.fake.reset());

  describe('provider failure degrades gracefully (test 4; acceptance 8; §7.8)', () => {
    it.each<[string, FakeMode]>([
      ['a timeout / unreachable provider', 'timeout'],
      ['an HTTP 500 from the provider', 'http500'],
      ['an unexpected non-provider exception inside the adapter', 'plainThrow'],
    ])('%s: 200 CHECK_FAILED with the documented message, row stored, all three statuses untouched', async (_name, mode) => {
      const c = await s.newCustomer();
      const o = await s.newOrder(c.id, { status: 'PROCESSING' });
      const a = await s.admin();
      const before = await s.snapshot(o.id);
      s.fake.state.mode = mode;

      const res = await a.post(s.url(o.orderNumber)).send({});
      expect(res.status).toBe(200);
      expect(Object.keys(res.body.data).sort()).toEqual(RESPONSE_KEYS);
      expect(res.body.data).toMatchObject({
        available: true,
        riskLevel: 'CHECK_FAILED',
        message: UNAVAILABLE,
        riskScore: null,
        totalOrders: null,
        successfulOrders: null,
        returnedOrders: null,
        successRatePercent: null,
      });
      expect(JSON.stringify(res.body)).not.toContain('boom');

      const rows = await s.riskRows(c.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ risk_level: 'CHECK_FAILED', order_id: o.id, checked_by: s.adminId });
      expect(rows[0].total_orders).toBeNull();
      expect(rows[0].raw_result).toEqual(expect.objectContaining({ error: expect.any(String) }));
      expect(await s.snapshot(o.id)).toEqual(before);
    });

    it('a stored failure is returned by GET as available:true with the same message (not "never checked")', async () => {
      const c = await s.newCustomer();
      const o = await s.newOrder(c.id);
      const a = await s.admin();
      s.fake.state.mode = 'timeout';
      await a.post(s.url(o.orderNumber)).send({});
      const get = await a.agent.get(s.url(o.orderNumber));
      expect(get.body.data).toMatchObject({ available: true, riskLevel: 'CHECK_FAILED', message: UNAVAILABLE });
    });

    it('the panel shows the failure rather than a stale success; a later success replaces it', async () => {
      const c = await s.newCustomer();
      const o = await s.newOrder(c.id);
      const a = await s.admin();
      await a.post(s.url(o.orderNumber)).send({});
      s.fake.state.mode = 'timeout';
      await a.post(s.url(o.orderNumber)).send({});
      expect((await a.agent.get(s.url(o.orderNumber))).body.data.riskLevel).toBe('CHECK_FAILED');
      s.fake.state.mode = 'ok';
      expect((await a.post(s.url(o.orderNumber)).send({})).body.data.riskLevel).toBe('LOW');
      expect((await s.riskRows(c.id)).map((r) => r.risk_level)).toEqual(['LOW', 'CHECK_FAILED', 'LOW']);
    });

    it('the order remains fully operable after a failure (no block, hold or cancel)', async () => {
      const c = await s.newCustomer();
      const o = await s.newOrder(c.id, { status: 'CONFIRMED' });
      const a = await s.admin();
      s.fake.state.mode = 'http500';
      await a.post(s.url(o.orderNumber)).send({});
      const [row] = await s.q(`SELECT order_status, payment_status FROM orders WHERE id=$1`, [o.id]);
      expect(row).toEqual({ order_status: 'CONFIRMED', payment_status: 'PENDING_COLLECTION' });
    });
  });

  describe('no history is not high risk (test 5; acceptance 9; §7.8)', () => {
    it('an empty-history result stores UNKNOWN (never HIGH) and shows "No courier history found."', async () => {
      const c = await s.newCustomer();
      const o = await s.newOrder(c.id);
      const a = await s.admin();
      s.fake.state.mode = 'noHistory';
      const res = await a.post(s.url(o.orderNumber)).send({});
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        available: true,
        riskLevel: 'UNKNOWN',
        message: 'No courier history found.',
        totalOrders: null,
        successfulOrders: null,
        returnedOrders: null,
        successRatePercent: null,
      });
      const [row] = await s.riskRows(c.id);
      expect(row.risk_level).toBe('UNKNOWN');
      expect(row.risk_level).not.toBe('HIGH');
      expect((await a.agent.get(s.url(o.orderNumber))).body.data).toMatchObject({ riskLevel: 'UNKNOWN', message: 'No courier history found.' });
    });

    it('an UNKNOWN result that DOES carry counts (unrecognised band) is not described as "no history", and is not HIGH', async () => {
      const c = await s.newCustomer();
      const o = await s.newOrder(c.id);
      const a = await s.admin();
      s.fake.state.result = { ...s.fake.state.result, riskLevel: 'UNKNOWN', totalOrders: 8, successfulOrders: 6, returnedOrders: 2 };
      const res = await a.post(s.url(o.orderNumber)).send({});
      expect(res.body.data.riskLevel).toBe('UNKNOWN');
      expect(res.body.data.message).not.toBe('No courier history found.');
      expect(res.body.data).toMatchObject({ totalOrders: 8, successfulOrders: 6, returnedOrders: 2, successRatePercent: 75 });
    });
  });

  describe('absent fields stay null (test 6; acceptance 10; §7.5)', () => {
    it('a partial provider result stores NULL, not 0, and the response carries null for every absent field', async () => {
      const c = await s.newCustomer();
      const o = await s.newOrder(c.id);
      const a = await s.admin();
      s.fake.state.mode = 'partial';
      const res = await a.post(s.url(o.orderNumber)).send({});
      expect(res.body.data).toMatchObject({
        riskLevel: 'MEDIUM',
        riskScore: null,
        totalOrders: null,
        successfulOrders: null,
        returnedOrders: null,
        successRatePercent: null,
      });
      const [row] = await s.riskRows(c.id);
      expect([row.risk_score, row.total_orders, row.successful_orders, row.returned_orders]).toEqual([null, null, null, null]);
    });

    it.each([
      ['total present, successful absent', { totalOrders: 10, successfulOrders: null, returnedOrders: 2 }],
      ['successful present, total absent', { totalOrders: null, successfulOrders: 5, returnedOrders: null }],
      ['total is zero (no divide by zero)', { totalOrders: 0, successfulOrders: 0, returnedOrders: 0 }],
    ])('success rate is omitted (null) when its inputs are not both usable: %s', async (_name, counts) => {
      const c = await s.newCustomer();
      const o = await s.newOrder(c.id);
      const a = await s.admin();
      s.fake.state.result = { ...s.fake.state.result, ...counts };
      const res = await a.post(s.url(o.orderNumber)).send({});
      expect(res.body.data.successRatePercent).toBeNull();
    });
  });

  describe('error rows 503 / 422 (spec 16 "Error cases")', () => {
    it('provider not configured: 503 RISK_PROVIDER_UNCONFIGURED with the safe message, no provider call, no row', async () => {
      const c = await s.newCustomer();
      const o = await s.newOrder(c.id);
      const a = await s.admin();
      s.fake.state.configured = false;
      const res = await a.post(s.url(o.orderNumber)).send({});
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('RISK_PROVIDER_UNCONFIGURED');
      expect(res.body.error.message).toBe('Risk check is not configured.');
      expect(s.fake.state.calls).toEqual([]);
      expect(await s.riskRows(c.id)).toHaveLength(0);
    });

    describe('invalid customer phone', () => {
      beforeAll(async () => {
        await s.scoped(`ALTER TABLE customers DROP CONSTRAINT customers_phone_number_format`);
      });
      afterAll(async () => {
        await s.scoped(`DELETE FROM customer_risk_checks`);
        await s.scoped(`DELETE FROM orders WHERE customer_id IN (SELECT id FROM customers WHERE phone_number !~ '^01[3-9][0-9]{8}$')`);
        await s.scoped(`DELETE FROM customers WHERE phone_number !~ '^01[3-9][0-9]{8}$'`);
        await s.scoped(`ALTER TABLE customers ADD CONSTRAINT customers_phone_number_format CHECK (phone_number ~ '^01[3-9][0-9]{8}$')`);
      });

      it.each(['12345', 'not-a-phone', '01212345678'])('stored phone %j: 422 INVALID_PHONE_NUMBER before any outbound call, no row', async (bad) => {
        const c = await s.newCustomer({ phone: bad });
        const o = await s.newOrder(c.id);
        const a = await s.admin();
        const res = await a.post(s.url(o.orderNumber)).send({});
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe('INVALID_PHONE_NUMBER');
        expect(res.body.error.message).toBe("This customer's phone number could not be checked.");
        expect(s.fake.state.calls).toEqual([]);
        expect(await s.riskRows(c.id)).toHaveLength(0);
      });
    });
  });

  it('the raw provider payload is stored for audit but never returned (marker is in raw_result, absent from the response)', async () => {
    const c = await s.newCustomer();
    const o = await s.newOrder(c.id);
    const a = await s.admin();
    const res = await a.post(s.url(o.orderNumber)).send({});
    expect(JSON.stringify(res.body)).not.toContain(RAW_MARKER);
    expect(JSON.stringify((await s.riskRows(c.id))[0].raw_result)).toContain(RAW_MARKER);
  });
});
