import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, connect, dropSchema, resetSchema } from './helpers/schemaFixture.js';
import { PERMISSION_KEYS } from '../src/types/permissions.js';

/**
 * Spec 02 acceptance 7–8, tests 6–7 — the seeded permission catalogue.
 *
 * MATRIX below is transcribed from 06-rbac §5.18 independently of the migration
 * that seeds the table. That duplication is the point: if someone edits the
 * migration's tier for a row, or adds a key without a matrix row, the two
 * transcriptions disagree and this test fails rather than the drift shipping.
 * §5.18 is authoritative — when they disagree, the migration is what gets fixed.
 */
const SCHEMA = 'spec02_permissions';

/** key -> [Admin tier, Manager tier], verbatim from the §5.18 table. */
const MATRIX: Record<string, readonly [string, string]> = {
  'dashboard.view': ['YES', 'YES'],
  'analytics.view': ['YES', 'ASSIGNED'],
  'audit.view': ['YES', 'ASSIGNED'],
  'product.create': ['YES', 'YES'],
  'product.update': ['YES', 'YES'],
  'product.delete': ['YES', 'ASSIGNED'],
  'category.manage': ['YES', 'YES'],
  'product.image.manage': ['YES', 'YES'],
  'product.attribute.manage': ['YES', 'YES'],
  'product.variant.manage': ['YES', 'YES'],
  'product.price.manage': ['YES', 'YES'],
  'inventory.manage': ['YES', 'YES'],
  'product.visibility.manage': ['YES', 'YES'],
  'order.view': ['YES', 'YES'],
  'order.update': ['YES', 'ASSIGNED'],
  'order.confirm': ['YES', 'YES'],
  'order.cancel': ['YES', 'ASSIGNED'],
  'payment.view': ['YES', 'YES'],
  'payment.verify': ['YES', 'YES'],
  'payment.reject': ['YES', 'YES'],
  'payment.review': ['YES', 'YES'],
  'order.cod.confirm': ['YES', 'YES'],
  'customer.view': ['YES', 'YES'],
  'customer.update': ['YES', 'ASSIGNED'],
  'customer.risk.check': ['YES', 'YES'],
  'shipment.view': ['YES', 'YES'],
  'shipment.create': ['YES', 'YES'],
  'courier.select': ['YES', 'YES'],
  'shipment.track': ['YES', 'YES'],
  'shipment.retry': ['YES', 'YES'],
  'shipment.courier.change': ['YES', 'YES'],
  'courier.manage': ['YES', 'ASSIGNED'],
  'cms.manage': ['YES', 'ASSIGNED'],
  'user.manager.create': ['YES', 'NO'],
  'user.manager.update': ['YES', 'NO'],
  'user.manager.delete': ['YES', 'NO'],
  'permission.assign': ['YES', 'NO'],
  'role.manage': ['YES', 'NO'],
  'permission.manage': ['YES', 'NO'],
  'system.configure': ['YES', 'NO'],
  'rbac.configure': ['YES', 'NO'],
  'coupon.view': ['YES', 'YES'],
  'coupon.create': ['YES', 'ASSIGNED'],
  'coupon.update': ['YES', 'ASSIGNED'],
  'coupon.status': ['YES', 'ASSIGNED'],
  'coupon.delete': ['YES', 'ASSIGNED'],
  'coupon.usage.view': ['YES', 'YES'],
};

/** §5.17 — the administrative half of the operational/administrative split. */
const ADMINISTRATIVE = new Set([
  'user.manager.create',
  'user.manager.update',
  'user.manager.delete',
  'permission.assign',
  'role.manage',
  'permission.manage',
  'system.configure',
  'rbac.configure',
]);

describe.skipIf(!TEST_DATABASE_URL)('spec 02 permission catalogue seed', () => {
  let db: pg.Client;
  let seeded: Map<string, { admin: string; manager: string; administrative: boolean }>;

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    db = await connect(SCHEMA);

    const { rows } = await db.query<{
      key: string;
      admin_tier: string;
      manager_tier: string;
      is_administrative: boolean;
    }>('SELECT key, admin_tier, manager_tier, is_administrative FROM permissions');

    seeded = new Map(
      rows.map((r) => [
        r.key,
        { admin: r.admin_tier, manager: r.manager_tier, administrative: r.is_administrative },
      ]),
    );
  }, 60_000);

  afterAll(async () => {
    await db?.end();
    await dropSchema(SCHEMA);
  });

  it('seeds exactly 47 rows (acceptance 7)', () => {
    expect(seeded.size).toBe(47);
    expect(Object.keys(MATRIX)).toHaveLength(47);
  });

  it('seeds no key the §5.18 matrix does not list', () => {
    expect([...seeded.keys()].filter((key) => !(key in MATRIX))).toEqual([]);
  });

  it.each(Object.entries(MATRIX))('%s matches the §5.18 matrix', (key, [admin, manager]) => {
    expect(seeded.get(key), `permission '${key}' is missing from the seed`).toBeDefined();
    expect(seeded.get(key)!.admin).toBe(admin);
    expect(seeded.get(key)!.manager).toBe(manager);
  });

  it('marks exactly the §5.17 administrative permissions', () => {
    const flagged = [...seeded.entries()]
      .filter(([, v]) => v.administrative)
      .map(([k]) => k)
      .sort();
    expect(flagged).toEqual([...ADMINISTRATIVE].sort());
  });

  it('keeps courier.manage and courier.select distinct (acceptance 8, test 7)', () => {
    expect(seeded.get('courier.manage')!.manager).toBe('ASSIGNED');
    expect(seeded.get('courier.select')!.manager).toBe('YES');
  });

  it('spot-checks the acceptance-7 keys', () => {
    expect(seeded.get('cms.manage')!.manager).toBe('ASSIGNED');
    expect(seeded.get('order.confirm')!.manager).toBe('YES');
    expect(seeded.get('user.manager.create')!.manager).toBe('NO');
  });

  it('is re-runnable: re-applying the seed adds no duplicate rows', async () => {
    // The ON CONFLICT (key) DO NOTHING guard, exercised directly rather than by
    // re-running the migration — the runner would skip an already-recorded file.
    await db.query(
      `INSERT INTO permissions (key, label, admin_tier, manager_tier, is_administrative)
       VALUES ('cms.manage', 'CMS Management', 'YES', 'ASSIGNED', false)
       ON CONFLICT (key) DO NOTHING`,
    );
    const { rows } = await db.query<{ n: string }>('SELECT count(*)::text AS n FROM permissions');
    expect(rows[0]!.n).toBe('47');
  });

  it('the PermissionKey union matches the seeded catalogue', () => {
    expect([...PERMISSION_KEYS].sort()).toEqual([...seeded.keys()].sort());
  });
});
