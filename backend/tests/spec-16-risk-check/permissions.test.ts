import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL } from '../helpers/schemaFixture.ts';
import { startRiskSuite, type RiskSuite } from './helpers/riskFixture.ts';

/**
 * Permission enforcement (implementation spec 16, test 12; acceptance 12;
 * 06-rbac §5.18 "Customer Risk Check": Admin Yes, Manager Yes; 09-fraud-risk-check §7.10).
 *
 * Real session layer and real permission middleware. A Yes-tier key cannot be revoked per
 * account, so the Manager's catalogue tier is flipped to NO inside this DISPOSABLE schema (and
 * restored), then re-enabled per account via the real grant path — the same technique as
 * spec 14's permission suite. The grant path only applies to ASSIGNED-tier keys. Every 403 is asserted by code FORBIDDEN so it cannot be
 * PASSWORD_CHANGE_REQUIRED or CSRF_FAILED in disguise.
 */
const SCHEMA = 'spec16_permissions';
const KEY = 'customer.risk.check';

describe.skipIf(!TEST_DATABASE_URL)('risk check permissions (spec 16)', () => {
  let s: RiskSuite;
  let permissionsRepository: typeof import('../../src/repositories/permissions.repository.js');

  beforeAll(async () => {
    s = await startRiskSuite(SCHEMA);
    permissionsRepository = await import('../../src/repositories/permissions.repository.js');
  }, 120_000);

  afterAll(async () => {
    await s?.teardown();
  });

  beforeEach(() => s.fake.reset());

  async function withManagerTier(tier: 'NO' | 'YES' | 'ASSIGNED', fn: () => Promise<void>): Promise<void> {
    const before = (await s.scoped(`SELECT manager_tier FROM permissions WHERE key=$1`, [KEY]))[0].manager_tier;
    await s.scoped(`UPDATE permissions SET manager_tier=$2 WHERE key=$1`, [KEY, tier]);
    try {
      await fn();
    } finally {
      await s.scoped(`UPDATE permissions SET manager_tier=$2 WHERE key=$1`, [KEY, before]);
    }
  }

  it('transcribed §5.18 row: Customer Risk Check is Yes for Admin and Yes for Manager in the seeded matrix', async () => {
    const [row] = await s.q(`SELECT admin_tier, manager_tier FROM permissions WHERE key=$1`, [KEY]);
    expect(row).toEqual({ admin_tier: 'YES', manager_tier: 'YES' });
  });

  it('401 without a session on both verbs, and no provider call', async () => {
    const c = await s.newCustomer();
    const o = await s.newOrder(c.id);
    expect((await request(s.app).get(s.url(o.orderNumber))).status).toBe(401);
    expect((await request(s.app).post(s.url(o.orderNumber)).send({})).status).toBe(401);
    expect(s.fake.state.calls).toEqual([]);
  });

  it('a customer-scope session is not an admin session: 401 on both verbs (scope separation)', async () => {
    const c = await s.newCustomer();
    const o = await s.newOrder(c.id);
    const phone = '01799990001';
    const agent = request.agent(s.app);
    expect((await agent.post('/api/customer/auth/register').send({ phone_number: phone, password: 'CustomerPass12' })).status).toBe(201);
    expect((await agent.post('/api/customer/auth/login').send({ phone_number: phone, password: 'CustomerPass12' })).status).toBe(200);
    expect((await agent.get(s.url(o.orderNumber))).status).toBe(401);
    expect((await agent.post(s.url(o.orderNumber)).send({})).status).toBe(401);
    expect(s.fake.state.calls).toEqual([]);
  });

  it('Admin can GET and POST (200)', async () => {
    const c = await s.newCustomer();
    const o = await s.newOrder(c.id);
    const a = await s.admin();
    expect((await a.agent.get(s.url(o.orderNumber))).status).toBe(200);
    expect((await a.post(s.url(o.orderNumber)).send({})).status).toBe(200);
  });

  it('a default Manager can GET and POST (200): Manager is Yes in §5.18', async () => {
    const c = await s.newCustomer();
    const o = await s.newOrder(c.id);
    const m = await s.manager();
    expect((await m.agent.get(s.url(o.orderNumber))).status).toBe(200);
    expect((await m.post(s.url(o.orderNumber)).send({})).status).toBe(200);
    expect(s.fake.state.calls).toHaveLength(1);
  });

  describe('without customer.risk.check', () => {
    it('GET is 403 FORBIDDEN and nothing is read or called', async () => {
      const c = await s.newCustomer();
      const o = await s.newOrder(c.id);
      await withManagerTier('NO', async () => {
        const m = await s.manager();
        const res = await m.agent.get(s.url(o.orderNumber));
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
        expect(JSON.stringify(res.body)).not.toMatch(/riskLevel/);
        expect(s.fake.state.calls).toEqual([]);
      });
    });

    it('POST is 403 FORBIDDEN: no provider call, no row, no audit row, order untouched', async () => {
      const c = await s.newCustomer();
      const o = await s.newOrder(c.id);
      const auditBefore = (await s.q(`SELECT count(*)::int AS n FROM audit_logs WHERE action='customer_risk_check'`))[0].n;
      const before = await s.snapshot(o.id);
      await withManagerTier('NO', async () => {
        const m = await s.manager();
        const res = await m.post(s.url(o.orderNumber)).send({});
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      });
      expect(s.fake.state.calls).toEqual([]);
      expect(await s.riskRows(c.id)).toHaveLength(0);
      expect((await s.q(`SELECT count(*)::int AS n FROM audit_logs WHERE action='customer_risk_check'`))[0].n).toBe(auditBefore);
      expect(await s.snapshot(o.id)).toEqual(before);
    });

    it('as an ASSIGNED-tier key: ungranted Manager 403, granted Manager 200 on both verbs, revoked again 403; the Admin is unaffected', async () => {
      const c = await s.newCustomer();
      const o = await s.newOrder(c.id);
      await withManagerTier('ASSIGNED', async () => {
        const ungranted = await s.manager();
        expect((await ungranted.agent.get(s.url(o.orderNumber))).status).toBe(403);

        const a = await s.admin();
        expect((await a.agent.get(s.url(o.orderNumber))).status).toBe(200);

        await permissionsRepository.grant(s.managerId, KEY, s.adminId);
        try {
          const m = await s.manager();
          expect((await m.agent.get(s.url(o.orderNumber))).status).toBe(200);
          expect((await m.post(s.url(o.orderNumber)).send({})).status).toBe(200);
        } finally {
          await permissionsRepository.revoke(s.managerId, KEY);
        }
        const m2 = await s.manager();
        expect((await m2.agent.get(s.url(o.orderNumber))).status).toBe(403);
      });
    });

    it('permission is checked before the order is looked up: an unknown order number is 403, not 404, for an unpermitted Manager (no existence leak)', async () => {
      await withManagerTier('NO', async () => {
        const m = await s.manager();
        const res = await m.agent.get(s.url('FBK-20261002-ZZZZZZ'));
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      });
    });
  });

  it('POST without the CSRF header is rejected as CSRF_FAILED (not a permission result) and calls nothing', async () => {
    const c = await s.newCustomer();
    const o = await s.newOrder(c.id);
    const a = await s.admin();
    const res = await a.agent.post(s.url(o.orderNumber)).send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_FAILED');
    expect(s.fake.state.calls).toEqual([]);
    expect(await s.riskRows(c.id)).toHaveLength(0);
  });
});
