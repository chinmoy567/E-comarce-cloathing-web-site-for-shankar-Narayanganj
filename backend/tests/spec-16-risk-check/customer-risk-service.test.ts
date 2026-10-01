import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL } from '../helpers/schemaFixture.ts';
import { RESPONSE_KEYS, startRiskSuite, type RiskSuite } from './helpers/riskFixture.ts';

/**
 * Customer risk check: caching, provider calls, mapping to the response
 * (implementation spec 16, tests 1, 2, 10; acceptance 1, 2, 4, 5, 18;
 * 09-fraud-risk-check §7.2, §7.6, §7.9, §7.11).
 *
 * Real HTTP, real middleware, real permission layer, real service/repository and real
 * Postgres schema; only the outbound provider is replaced (fake via setRiskProvider).
 * A mocked repository would assert nothing about the customer_id cache key.
 */
const SCHEMA = 'spec16_service';

describe.skipIf(!TEST_DATABASE_URL)('customer risk check service (spec 16)', () => {
  let s: RiskSuite;

  beforeAll(async () => {
    s = await startRiskSuite(SCHEMA);
  }, 120_000);

  afterAll(async () => {
    await s?.teardown();
  });

  beforeEach(() => s.fake.reset());

  describe('caching is real (test 1; acceptance 1, 2; §7.2, §7.6)', () => {
    it('GET with no stored result makes zero provider calls and says "never checked" (available false)', async () => {
      const c = await s.newCustomer();
      const o = await s.newOrder(c.id);
      const a = await s.admin();

      const res = await a.agent.get(s.url(o.orderNumber));
      expect(res.status).toBe(200);
      expect(Object.keys(res.body.data).sort()).toEqual(RESPONSE_KEYS);
      expect(res.body.data).toMatchObject({
        available: false,
        riskLevel: 'UNKNOWN',
        phoneNumber: c.phone,
        riskScore: null,
        totalOrders: null,
        successfulOrders: null,
        returnedOrders: null,
        successRatePercent: null,
        checkedAt: null,
        checkedByUserIdentifier: null,
        canTriggerFreshCheck: true,
        triggerBlockedReason: null,
        message: 'No risk check has been run for this customer yet.',
      });
      expect(s.fake.state.calls).toEqual([]);
      expect(await s.riskRows(c.id)).toHaveLength(0);
    });

    it('repeated GETs (an order page opened again and again) produce zero provider calls, with or without a cached row', async () => {
      const c = await s.newCustomer();
      const o = await s.newOrder(c.id);
      const a = await s.admin();
      for (let i = 0; i < 3; i += 1) expect((await a.agent.get(s.url(o.orderNumber))).status).toBe(200);
      expect((await a.post(s.url(o.orderNumber)).send({})).status).toBe(200);
      expect(s.fake.state.calls).toHaveLength(1);
      for (let i = 0; i < 3; i += 1) expect((await a.agent.get(s.url(o.orderNumber))).status).toBe(200);
      expect(s.fake.state.calls).toHaveLength(1);
      expect(await s.riskRows(c.id)).toHaveLength(1);
    });

    it('POST calls the provider exactly once, stores one row and returns the mapped fields', async () => {
      const c = await s.newCustomer();
      const o = await s.newOrder(c.id, { status: 'CONFIRMED' });
      const a = await s.admin();

      const res = await a.post(s.url(o.orderNumber)).send({});
      expect(res.status).toBe(200);
      expect(s.fake.state.calls).toEqual([c.phone]);
      expect(Object.keys(res.body.data).sort()).toEqual(RESPONSE_KEYS);
      expect(res.body.data).toMatchObject({
        available: true,
        phoneNumber: c.phone,
        riskLevel: 'LOW',
        riskScore: null,
        totalOrders: 25,
        successfulOrders: 22,
        returnedOrders: 3,
        successRatePercent: 88, // 22/25, computed for display (§7.5), not stored
        checkedByUserIdentifier: 'r-admin',
        canTriggerFreshCheck: true,
        triggerBlockedReason: null,
        message: null,
      });
      expect(Number.isNaN(Date.parse(res.body.data.checkedAt))).toBe(false);

      const rows = await s.riskRows(c.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        customer_id: c.id,
        order_id: o.id,
        phone_number: c.phone,
        provider: 'FAKE_RISK',
        risk_level: 'LOW',
        total_orders: 25,
        successful_orders: 22,
        returned_orders: 3,
        checked_by: s.adminId,
      });
      expect(rows[0].risk_score).toBeNull();
      expect(rows[0].raw_result).not.toBeNull();
    });

    it('the success rate is derived for display only: it is not a stored column', async () => {
      const cols = await s.q<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='customer_risk_checks'`,
        [SCHEMA],
      );
      expect(cols.map((r) => r.column_name).sort()).toEqual(
        [
          'checked_at', 'checked_by', 'customer_id', 'id', 'order_id', 'phone_number', 'provider', 'raw_result',
          'returned_orders', 'risk_level', 'risk_score', 'successful_orders', 'total_orders',
        ].sort(),
      );
    });

    it('GET after POST returns the stored result with no second provider call', async () => {
      const c = await s.newCustomer();
      const o = await s.newOrder(c.id);
      const a = await s.admin();
      const post = await a.post(s.url(o.orderNumber)).send({});
      const get = await a.agent.get(s.url(o.orderNumber));
      expect(get.body.data).toEqual(post.body.data);
      expect(s.fake.state.calls).toHaveLength(1);
    });
  });

  describe('the cache key is customer_id, not order_id (test 2; acceptance 5; §7.6)', () => {
    it('a check run against order A is shown on order B of the same customer with no provider call', async () => {
      const c = await s.newCustomer();
      const orderA = await s.newOrder(c.id);
      const orderB = await s.newOrder(c.id, { status: 'PENDING_CONFIRMATION' });
      const a = await s.admin();

      const post = await a.post(s.url(orderA.orderNumber)).send({});
      expect(post.status).toBe(200);
      expect(s.fake.state.calls).toHaveLength(1);

      const onB = await a.agent.get(s.url(orderB.orderNumber));
      expect(onB.status).toBe(200);
      expect(onB.body.data).toMatchObject({
        available: true,
        riskLevel: 'LOW',
        totalOrders: 25,
        checkedAt: post.body.data.checkedAt,
        // gate flags still follow order B's own status
        canTriggerFreshCheck: false,
      });
      expect(s.fake.state.calls).toHaveLength(1);

      const [row] = await s.riskRows(c.id);
      expect(row.order_id).toBe(orderA.id); // provenance only
    });

    it('a different customer does not see the cached result', async () => {
      const c1 = await s.newCustomer();
      const c2 = await s.newCustomer();
      const o1 = await s.newOrder(c1.id);
      const o2 = await s.newOrder(c2.id);
      const a = await s.admin();
      await a.post(s.url(o1.orderNumber)).send({});
      const other = await a.agent.get(s.url(o2.orderNumber));
      expect(other.body.data).toMatchObject({ available: false, riskLevel: 'UNKNOWN', checkedAt: null });
      expect(s.fake.state.calls).toHaveLength(1);
    });

    it('history is append-only: a second explicit check inserts a second row and GET returns the newest', async () => {
      const c = await s.newCustomer();
      const o1 = await s.newOrder(c.id);
      const o2 = await s.newOrder(c.id);
      const a = await s.admin();
      await a.post(s.url(o1.orderNumber)).send({});
      s.fake.state.result = { ...s.fake.state.result, riskLevel: 'HIGH', totalOrders: 10, successfulOrders: 4, returnedOrders: 6 };
      const second = await a.post(s.url(o2.orderNumber)).send({});
      expect(second.body.data).toMatchObject({ riskLevel: 'HIGH', totalOrders: 10, successRatePercent: 40 });

      const rows = await s.riskRows(c.id);
      expect(rows.map((r) => [r.risk_level, r.order_id])).toEqual([['LOW', o1.id], ['HIGH', o2.id]]);
      const get = await a.agent.get(s.url(o1.orderNumber));
      expect(get.body.data.riskLevel).toBe('HIGH');
      expect(s.fake.state.calls).toHaveLength(2);
    });
  });

  describe('server authority: a tampered POST body changes nothing (§7.9, CLAUDE.md §3)', () => {
    it('client-supplied riskLevel / counts / phone / customerId in the body are ignored; the stored and outbound values come from the server', async () => {
      const c = await s.newCustomer();
      const other = await s.newCustomer();
      const o = await s.newOrder(c.id);
      const a = await s.admin();
      const res = await a.post(s.url(o.orderNumber)).send({
        riskLevel: 'HIGH', totalOrders: 999, successfulOrders: 0, phone: '01999999999', phoneNumber: '01999999999', customerId: other.id, forceRefresh: true,
      });
      expect(res.status).toBe(200);
      expect(s.fake.state.calls).toEqual([c.phone]);
      expect(res.body.data).toMatchObject({ riskLevel: 'LOW', totalOrders: 25, phoneNumber: c.phone });
      expect(await s.riskRows(other.id)).toHaveLength(0);
    });
  });

  describe('phone normalization before the call (test 10; §7.9)', () => {
    beforeAll(async () => {
      // The customers CHECK only stores canonical 01XXXXXXXXX, so non-canonical stored values need the
      // CHECK dropped in this DISPOSABLE schema. It is re-added in afterAll.
      await s.scoped(`ALTER TABLE customers DROP CONSTRAINT customers_phone_number_format`);
    });
    afterAll(async () => {
      await s.scoped(`DELETE FROM customer_risk_checks`);
      await s.scoped(`DELETE FROM orders WHERE customer_id IN (SELECT id FROM customers WHERE phone_number !~ '^01[3-9][0-9]{8}$')`);
      await s.scoped(`DELETE FROM customers WHERE phone_number !~ '^01[3-9][0-9]{8}$'`);
      await s.scoped(`ALTER TABLE customers ADD CONSTRAINT customers_phone_number_format CHECK (phone_number ~ '^01[3-9][0-9]{8}$')`);
    });

    it.each([
      ['+8801712340001', '01712340001'],
      ['8801712340002', '01712340002'],
      ['017-1234 0003', '01712340003'],
      ['(01712) 340.004', '01712340004'],
    ])('stored variant %s reaches the provider, and the stored row, as %s', async (variant, canonical) => {
      const c = await s.newCustomer({ phone: variant });
      const o = await s.newOrder(c.id);
      const a = await s.admin();
      const res = await a.post(s.url(o.orderNumber)).send({});
      expect(res.status).toBe(200);
      expect(s.fake.state.calls).toEqual([canonical]);
      expect(res.body.data.phoneNumber).toBe(canonical);
      expect((await s.riskRows(c.id))[0].phone_number).toBe(canonical);
    });
  });

  describe('no side effects on the order (test 15; acceptance 18; §7.11)', () => {
    it('before/after snapshots of the three statuses, history rows and shipments are identical, and no shipment is created', async () => {
      const c = await s.newCustomer();
      const o = await s.newOrder(c.id, { status: 'PROCESSING' });
      const a = await s.admin();
      const before = await s.snapshot(o.id);
      expect((await a.post(s.url(o.orderNumber)).send({})).status).toBe(200);
      expect((await a.agent.get(s.url(o.orderNumber))).status).toBe(200);
      expect(await s.snapshot(o.id)).toEqual(before);
      expect(before).toMatchObject({ shipments: 0, orderStatus: 'PROCESSING', paymentStatus: 'PENDING_COLLECTION' });
    });

    it('a HIGH result does not hold, flag or cancel the order (§7.8: advisory only)', async () => {
      const c = await s.newCustomer();
      const o = await s.newOrder(c.id);
      s.fake.state.result = { ...s.fake.state.result, riskLevel: 'HIGH', totalOrders: 10, successfulOrders: 1, returnedOrders: 9 };
      const a = await s.admin();
      const before = await s.snapshot(o.id);
      expect((await a.post(s.url(o.orderNumber)).send({})).body.data.riskLevel).toBe('HIGH');
      expect(await s.snapshot(o.id)).toEqual(before);
    });
  });
});
