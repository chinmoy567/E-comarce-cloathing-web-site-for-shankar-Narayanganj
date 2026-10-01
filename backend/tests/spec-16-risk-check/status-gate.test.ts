import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL } from '../helpers/schemaFixture.ts';
import { startRiskSuite, type OrderStatus, type RiskSuite } from './helpers/riskFixture.ts';

/**
 * Server-side status gate (implementation spec 16, test 3; acceptance 3, 4;
 * 09-fraud-risk-check §7.2: enabled only for CONFIRMED or PROCESSING, "the backend must
 * enforce this status check server-side").
 *
 * Calls the API directly, as a client that bypassed the UI would. The allowed/disallowed
 * sets are transcribed from §7.2, not imported from src/.
 */
const SCHEMA = 'spec16_status_gate';

const ALLOWED: OrderStatus[] = ['CONFIRMED', 'PROCESSING'];
const DISALLOWED: OrderStatus[] = ['PENDING_CONFIRMATION', 'COD_VERIFICATION_PENDING', 'CANCELLED', 'DELIVERED', 'RETURNED'];
const BLOCKED_REASON = 'A new check can be run while the order is Confirmed or Processing.';

describe.skipIf(!TEST_DATABASE_URL)('risk check status gate (spec 16)', () => {
  let s: RiskSuite;

  beforeAll(async () => {
    s = await startRiskSuite(SCHEMA);
  }, 120_000);

  afterAll(async () => {
    await s?.teardown();
  });

  beforeEach(() => s.fake.reset());

  it.each(DISALLOWED)('POST on a %s order is 409 RISK_CHECK_NOT_ALLOWED: no provider call, no row, no audit, order untouched (§7.2, acceptance 3)', async (status) => {
    const c = await s.newCustomer();
    const o = await s.newOrder(c.id, { status });
    const a = await s.admin();
    const before = await s.snapshot(o.id);
    const auditBefore = (await s.q(`SELECT count(*)::int AS n FROM audit_logs WHERE action='customer_risk_check'`))[0].n;

    const res = await a.post(s.url(o.orderNumber)).send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RISK_CHECK_NOT_ALLOWED');
    expect(s.fake.state.calls).toEqual([]);
    expect(await s.riskRows(c.id)).toHaveLength(0);
    expect((await s.q(`SELECT count(*)::int AS n FROM audit_logs WHERE action='customer_risk_check'`))[0].n).toBe(auditBefore);
    expect(await s.snapshot(o.id)).toEqual(before);
  });

  it.each(ALLOWED)('POST on a %s order succeeds with exactly one provider call (acceptance 2, 4)', async (status) => {
    const c = await s.newCustomer();
    const o = await s.newOrder(c.id, { status });
    const a = await s.admin();
    const res = await a.post(s.url(o.orderNumber)).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.riskLevel).toBe('LOW');
    expect(s.fake.state.calls).toHaveLength(1);
    expect(await s.riskRows(c.id)).toHaveLength(1);
  });

  it.each([...ALLOWED, ...DISALLOWED])('GET on a %s order reports canTriggerFreshCheck / triggerBlockedReason per §7.2 and never calls the provider', async (status) => {
    const c = await s.newCustomer();
    const o = await s.newOrder(c.id, { status });
    const a = await s.admin();
    const res = await a.agent.get(s.url(o.orderNumber));
    expect(res.status).toBe(200);
    const allowed = ALLOWED.includes(status);
    expect(res.body.data.canTriggerFreshCheck).toBe(allowed);
    expect(res.body.data.triggerBlockedReason).toBe(allowed ? null : BLOCKED_REASON);
    expect(s.fake.state.calls).toEqual([]);
  });

  it('a cached result stays viewable on a disallowed order (GET works, only the fresh check is blocked)', async () => {
    const c = await s.newCustomer();
    const confirmed = await s.newOrder(c.id, { status: 'CONFIRMED' });
    const delivered = await s.newOrder(c.id, { status: 'DELIVERED' });
    const a = await s.admin();
    await a.post(s.url(confirmed.orderNumber)).send({});
    const res = await a.agent.get(s.url(delivered.orderNumber));
    expect(res.body.data).toMatchObject({ available: true, riskLevel: 'LOW', canTriggerFreshCheck: false });
  });

  it('the gate reads the CURRENT status: PENDING_CONFIRMATION is refused, then allowed once the order is CONFIRMED', async () => {
    const c = await s.newCustomer();
    const o = await s.newOrder(c.id, { status: 'PENDING_CONFIRMATION' });
    const a = await s.admin();
    expect((await a.post(s.url(o.orderNumber)).send({})).status).toBe(409);
    await s.q(`UPDATE orders SET order_status='CONFIRMED' WHERE id=$1`, [o.id]);
    expect((await a.post(s.url(o.orderNumber)).send({})).status).toBe(200);
    expect(s.fake.state.calls).toHaveLength(1);
  });

  it('a Manager is gated identically (the gate is not an Admin-only rule)', async () => {
    const c = await s.newCustomer();
    const o = await s.newOrder(c.id, { status: 'CANCELLED' });
    const m = await s.manager();
    const res = await m.post(s.url(o.orderNumber)).send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RISK_CHECK_NOT_ALLOWED');
  });

  it('an unknown order number is a 404 on both verbs, and a malformed one is a 400 (no provider call)', async () => {
    const a = await s.admin();
    const missing = 'FBK-20261002-ZZZZZZ';
    const get = await a.agent.get(s.url(missing));
    const post = await a.post(s.url(missing)).send({});
    expect(get.status).toBe(404);
    expect(post.status).toBe(404);
    expect((await a.agent.get(s.url('x'))).status).toBe(400);
    expect((await a.post(s.url("FBK-1'; DROP TABLE orders;--")).send({})).status).toBe(400);
    expect(s.fake.state.calls).toEqual([]);
  });

  it('the order number is matched case-insensitively', async () => {
    const c = await s.newCustomer();
    const o = await s.newOrder(c.id);
    const a = await s.admin();
    expect((await a.agent.get(s.url(o.orderNumber.toLowerCase()))).status).toBe(200);
  });
});
