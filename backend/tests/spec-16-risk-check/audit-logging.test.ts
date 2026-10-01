import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL } from '../helpers/schemaFixture.ts';
import { startRiskSuite, type RiskSuite } from './helpers/riskFixture.ts';

/**
 * Audit trail (implementation spec 16, test 14; acceptance 15; 09-fraud-risk-check §7.9,
 * 06-rbac §5.15 rule 10): who ran a check, when, for which order and customer.
 *
 * Real Postgres. The row/audit atomicity claim is tested by failure injection: a trigger that
 * makes the audit INSERT fail, created in this DISPOSABLE schema only.
 */
const SCHEMA = 'spec16_audit';

describe.skipIf(!TEST_DATABASE_URL)('risk check audit logging (spec 16)', () => {
  let s: RiskSuite;

  beforeAll(async () => {
    s = await startRiskSuite(SCHEMA);
  }, 120_000);

  afterAll(async () => {
    await s?.teardown();
  });

  beforeEach(() => s.fake.reset());

  const auditRows = (orderId: string) =>
    s.q(`SELECT * FROM audit_logs WHERE action='customer_risk_check' AND entity_id=$1 ORDER BY created_at, id`, [orderId]);

  it('a successful check appends one audit row: actor, actor type, order, customer, outcome, request id, timestamp', async () => {
    const c = await s.newCustomer();
    const o = await s.newOrder(c.id);
    const a = await s.admin();
    const t0 = Date.now();
    const res = await a.post(s.url(o.orderNumber)).send({});
    expect(res.status).toBe(200);

    const rows = await auditRows(o.id);
    expect(rows).toHaveLength(1);
    const [rowId] = (await s.riskRows(c.id)).map((r) => r.id);
    expect(rows[0]).toMatchObject({ entity_type: 'order', entity_id: o.id, actor_user_id: s.adminId, actor_type: 'USER' });
    expect(rows[0].request_id).toBeTruthy();
    expect(rows[0].new_value).toEqual({ orderNumber: o.orderNumber, customerId: c.id, riskLevel: 'LOW', riskCheckId: rowId });
    expect(Math.abs(new Date(rows[0].created_at).getTime() - t0)).toBeLessThan(60_000);
  });

  it('records the acting Manager, not the Admin', async () => {
    const c = await s.newCustomer();
    const o = await s.newOrder(c.id);
    const m = await s.manager();
    await m.post(s.url(o.orderNumber)).send({});
    const rows = await auditRows(o.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_user_id).toBe(s.managerId);
  });

  it('a failed check is audited too (the attempt happened), with riskLevel CHECK_FAILED', async () => {
    const c = await s.newCustomer();
    const o = await s.newOrder(c.id);
    const a = await s.admin();
    s.fake.state.mode = 'timeout';
    await a.post(s.url(o.orderNumber)).send({});
    const rows = await auditRows(o.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].new_value).toMatchObject({ riskLevel: 'CHECK_FAILED' });
  });

  it('every explicit check appends its own row: three checks, three audit rows', async () => {
    const c = await s.newCustomer();
    const o = await s.newOrder(c.id);
    const a = await s.admin();
    for (let i = 0; i < 3; i += 1) await a.post(s.url(o.orderNumber)).send({});
    expect(await auditRows(o.id)).toHaveLength(3);
  });

  it('GET (cache read) and a gated 409 write no audit row', async () => {
    const c = await s.newCustomer();
    const ok = await s.newOrder(c.id);
    const gated = await s.newOrder(c.id, { status: 'CANCELLED' });
    const a = await s.admin();
    await a.agent.get(s.url(ok.orderNumber));
    await a.post(s.url(gated.orderNumber)).send({});
    expect(await auditRows(ok.id)).toHaveLength(0);
    expect(await auditRows(gated.id)).toHaveLength(0);
  });

  it('the audit payload carries no PII and no provider data: exact key set, no phone, no raw payload', async () => {
    const c = await s.newCustomer();
    const o = await s.newOrder(c.id);
    const a = await s.admin();
    await a.post(s.url(o.orderNumber)).send({});
    const [row] = await auditRows(o.id);
    expect(Object.keys(row.new_value).sort()).toEqual(['customerId', 'orderNumber', 'riskCheckId', 'riskLevel']);
    expect(JSON.stringify(row)).not.toContain(c.phone);
    expect(JSON.stringify(row)).not.toContain('providerOnlyKey');
  });

  it('atomicity: if the audit insert fails, the risk row is rolled back with it and the caller gets an error (no unaudited check)', async () => {
    const c = await s.newCustomer();
    const o = await s.newOrder(c.id);
    const a = await s.admin();
    await s.scoped(`
      CREATE FUNCTION spec16_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'customer_risk_check' THEN RAISE EXCEPTION 'injected audit failure'; END IF;
        RETURN NEW;
      END $$`);
    await s.scoped(`CREATE TRIGGER spec16_fail_audit_trg BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION spec16_fail_audit()`);
    try {
      const res = await a.post(s.url(o.orderNumber)).send({});
      expect(res.status).toBe(500);
      expect(await s.riskRows(c.id)).toHaveLength(0);
      expect(await auditRows(o.id)).toHaveLength(0);
    } finally {
      await s.scoped(`DROP TRIGGER spec16_fail_audit_trg ON audit_logs`);
      await s.scoped(`DROP FUNCTION spec16_fail_audit()`);
    }
    expect((await a.post(s.url(o.orderNumber)).send({})).status).toBe(200);
    expect(await s.riskRows(c.id)).toHaveLength(1);
    expect(await auditRows(o.id)).toHaveLength(1);
  });
});
