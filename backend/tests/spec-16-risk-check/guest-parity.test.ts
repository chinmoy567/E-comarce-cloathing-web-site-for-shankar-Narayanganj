import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL } from '../helpers/schemaFixture.ts';
import { RESPONSE_KEYS, startRiskSuite, type RiskSuite } from './helpers/riskFixture.ts';

/**
 * Guest parity (implementation spec 16, test 13; acceptance 6; 09-fraud-risk-check §7.6:
 * "this works identically for guest orders"; 02-customer §2.9.4, §2.9.8).
 *
 * A guest and a registered customer are both phone-keyed `customers` rows, so parity must hold
 * by construction: identical behaviour is asserted over HTTP + Postgres, and the "no code
 * branch on account_type" claim is asserted by a source scan of the service and repository.
 */
const SCHEMA = 'spec16_guest';

describe.skipIf(!TEST_DATABASE_URL)('risk check guest parity (spec 16)', () => {
  let s: RiskSuite;

  beforeAll(async () => {
    s = await startRiskSuite(SCHEMA);
  }, 120_000);

  afterAll(async () => {
    await s?.teardown();
  });

  beforeEach(() => s.fake.reset());

  const TYPES = ['GUEST', 'REGISTERED'] as const;

  it.each(TYPES)('%s customer: GET (never checked) → POST → GET, with the same shapes, one provider call and the same stored row', async (type) => {
    const c = await s.newCustomer({ type });
    const o = await s.newOrder(c.id);
    const a = await s.admin();

    const first = await a.agent.get(s.url(o.orderNumber));
    expect(first.body.data).toMatchObject({ available: false, riskLevel: 'UNKNOWN', canTriggerFreshCheck: true });

    const post = await a.post(s.url(o.orderNumber)).send({});
    expect(post.status).toBe(200);
    expect(Object.keys(post.body.data).sort()).toEqual(RESPONSE_KEYS);
    expect(post.body.data).toMatchObject({ available: true, riskLevel: 'LOW', totalOrders: 25, successfulOrders: 22, returnedOrders: 3, successRatePercent: 88, phoneNumber: c.phone });

    const again = await a.agent.get(s.url(o.orderNumber));
    expect(again.body.data).toEqual(post.body.data);
    expect(s.fake.state.calls).toEqual([c.phone]);

    const rows = await s.riskRows(c.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ customer_id: c.id, order_id: o.id, provider: 'FAKE_RISK', risk_level: 'LOW', checked_by: s.adminId });
  });

  it('the guest and registered responses differ only in the customer-specific values (same field set, same gate, same message rules)', async () => {
    const g = await s.newCustomer({ type: 'GUEST' });
    const r = await s.newCustomer({ type: 'REGISTERED' });
    const og = await s.newOrder(g.id, { status: 'CANCELLED' });
    const or = await s.newOrder(r.id, { status: 'CANCELLED' });
    const a = await s.admin();
    const strip = ({ phoneNumber: _p, ...rest }: Record<string, unknown>) => rest;
    const gr = await a.agent.get(s.url(og.orderNumber));
    const rr = await a.agent.get(s.url(or.orderNumber));
    expect(strip(gr.body.data)).toEqual(strip(rr.body.data));
    const gp = await a.post(s.url(og.orderNumber)).send({});
    const rp = await a.post(s.url(or.orderNumber)).send({});
    expect([gp.status, gp.body.error.code]).toEqual([rp.status, rp.body.error.code]);
  });

  it.each(TYPES)('%s customer: failure and no-history paths behave the same', async (type) => {
    const c = await s.newCustomer({ type });
    const o = await s.newOrder(c.id);
    const a = await s.admin();
    s.fake.state.mode = 'timeout';
    expect((await a.post(s.url(o.orderNumber)).send({})).body.data.riskLevel).toBe('CHECK_FAILED');
    s.fake.state.mode = 'noHistory';
    expect((await a.post(s.url(o.orderNumber)).send({})).body.data).toMatchObject({ riskLevel: 'UNKNOWN', message: 'No courier history found.' });
  });

  it('a guest who later registers on the SAME customer record keeps the cached result (§2.9.8: one phone-keyed record)', async () => {
    const g = await s.newCustomer({ type: 'GUEST' });
    const o = await s.newOrder(g.id);
    const a = await s.admin();
    await a.post(s.url(o.orderNumber)).send({});
    await s.q(`UPDATE customers SET account_type='REGISTERED' WHERE id=$1`, [g.id]);
    const res = await a.agent.get(s.url(o.orderNumber));
    expect(res.body.data).toMatchObject({ available: true, riskLevel: 'LOW' });
    expect(s.fake.state.calls).toHaveLength(1);
  });

  it('there is no code branch on account_type in the risk service or repository (acceptance 6) — source scan', () => {
    const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    for (const file of [
      '../../src/services/fraud/customerRiskService.ts',
      '../../src/repositories/customerRiskChecks.repository.ts',
      '../../src/controllers/admin/riskCheck.controller.ts',
    ]) {
      expect(read(file), file).not.toMatch(/account_?type|['"`](GUEST|REGISTERED)['"`]/i);
    }
  });
});
