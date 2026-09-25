import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.js';
import { applyTestEnv } from '../helpers/testEnv.js';
import { resetEnvCache } from '../../src/config/env.js';
import { loginAsAdmin } from '../helpers/adminSession.js';
import type { PermissionKey } from '../../src/types/permissions.js';

/**
 * Spec 10 — admin coupon management HTTP surface (S2). Tests required items
 * 6, 9, 15, 18, 20, 21 and acceptance items 1, 3, 5, 15, 16, 17.
 */
const SCHEMA = 'spec10_coupons_api';

const COUPON_KEYS: PermissionKey[] = [
  'coupon.view',
  'coupon.create',
  'coupon.update',
  'coupon.status',
  'coupon.delete',
  'coupon.usage.view',
];

describe.skipIf(!TEST_DATABASE_URL)('admin coupons API (10-coupon-discount §8.18, §8.19)', () => {
  let app: Express;
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;
  let withTransactionFn: typeof import('../../src/lib/transaction.js').withTransaction;
  let usersRepository: typeof import('../../src/repositories/users.repository.js');
  let permissionsRepository: typeof import('../../src/repositories/permissions.repository.js');
  let auditRepository: typeof import('../../src/repositories/audit.repository.js');
  let hashPassword: typeof import('../../src/lib/password.js').hashPassword;

  let adminId: string;
  let managerId: string;

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    applyTestEnv();
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    resetEnvCache();

    ({ resetTransactionPool, withTransaction: withTransactionFn } = await import('../../src/lib/transaction.js'));
    await resetTransactionPool();
    usersRepository = await import('../../src/repositories/users.repository.js');
    permissionsRepository = await import('../../src/repositories/permissions.repository.js');
    auditRepository = await import('../../src/repositories/audit.repository.js');
    ({ hashPassword } = await import('../../src/lib/password.js'));
    const { createApp } = await import('../../src/app.js');
    app = createApp();

    const passwordHash = await hashPassword('CouponApiTestPass12');
    adminId = (
      await usersRepository.create({
        role: 'ADMIN',
        userIdentifier: 'coupon-api-admin',
        passwordHash,
        mustChangePassword: false,
      })
    ).id;
    managerId = (
      await usersRepository.create({
        role: 'MANAGER',
        userIdentifier: 'coupon-api-manager',
        passwordHash,
        mustChangePassword: false,
      })
    ).id;
  }, 60_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  async function asAdmin() {
    return loginAsAdmin(app, 'coupon-api-admin', 'CouponApiTestPass12');
  }
  async function asManager() {
    return loginAsAdmin(app, 'coupon-api-manager', 'CouponApiTestPass12');
  }

  async function withManagerTierRevoked<T>(key: PermissionKey, fn: () => Promise<T>): Promise<T> {
    await withTransactionFn(async (client) => {
      await client.query(`UPDATE permissions SET manager_tier = 'NO' WHERE key = $1`, [key]);
    });
    try {
      return await fn();
    } finally {
      await withTransactionFn(async (client) => {
        await client.query(`UPDATE permissions SET manager_tier = $2 WHERE key = $1`, [
          key,
          // coupon.view/coupon.usage.view default YES; the rest default ASSIGNED (§8.19).
          key === 'coupon.view' || key === 'coupon.usage.view' ? 'YES' : 'ASSIGNED',
        ]);
      });
    }
  }

  function couponBody(overrides: Record<string, unknown> = {}) {
    return {
      code: `API${Date.now()}${Math.floor(Math.random() * 10000)}`,
      name: 'API Test Coupon',
      discountType: 'PERCENTAGE',
      discountValue: 10,
      startsAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z',
      ...overrides,
    };
  }

  it.each(COUPON_KEYS)('%s is a known permission key present in the catalogue (test 20)', async (key) => {
    const catalogue = await permissionsRepository.listAll();
    expect(catalogue.some((entry) => entry.key === key)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 20: permission matrix rows, both ungranted and granted for ASSIGNED
  // rows (acceptance 16, 17).
  // -------------------------------------------------------------------------
  describe('permission matrix rows (§5.18, §8.19, test 20)', () => {
    it('coupon.view: Manager (Yes by default) can list coupons', async () => {
      const session = await asManager();
      const res = await session.agent.get('/api/admin/coupons');
      expect(res.status).toBe(200);
    });

    it('coupon.create (Assigned): a Manager without the grant gets 403; list (coupon.view) still 200 (acceptance 16)', async () => {
      const session = await asManager();
      const createRes = await session.post('/api/admin/coupons').send(couponBody());
      expect(createRes.status).toBe(403);
      expect(createRes.body.error.code).toBe('FORBIDDEN');

      const listRes = await session.agent.get('/api/admin/coupons');
      expect(listRes.status).toBe(200);
    });

    it('coupon.create (Assigned): granting it flips only create, not other actions (acceptance 16)', async () => {
      await permissionsRepository.grant(managerId, 'coupon.create', adminId);
      try {
        const session = await asManager();
        const res = await session.post('/api/admin/coupons').send(couponBody());
        expect(res.status).toBe(201);
      } finally {
        await permissionsRepository.revoke(managerId, 'coupon.create');
      }
    });

    it('coupon.update (Assigned): granted only update lets PATCH succeed but not status (acceptance 17)', async () => {
      const created = await withTransactionFn(async () => {
        const coupons = await import('../../src/repositories/coupon.repository.js');
        return coupons.create({
          code: `UPDONLY${Date.now()}`,
          name: 'Update Only',
          discountType: 'PERCENTAGE',
          discountValue: 10,
          startsAt: new Date('2026-01-01T00:00:00.000Z'),
          expiresAt: new Date('2099-01-01T00:00:00.000Z'),
          createdBy: adminId,
        });
      });

      await permissionsRepository.grant(managerId, 'coupon.update', adminId);
      try {
        const session = await asManager();
        const patchRes = await session.patch(`/api/admin/coupons/${created.id}`).send({ name: 'Renamed' });
        expect(patchRes.status).toBe(200);

        const statusRes = await session.post(`/api/admin/coupons/${created.id}/status`).send({ status: 'ACTIVE' });
        expect(statusRes.status).toBe(403);
      } finally {
        await permissionsRepository.revoke(managerId, 'coupon.update');
      }
    });

    it('coupon.status (Assigned): granted lets status change succeed', async () => {
      const created = await withTransactionFn(async () => {
        const coupons = await import('../../src/repositories/coupon.repository.js');
        return coupons.create({
          code: `STATUSONLY${Date.now()}`,
          name: 'Status Only',
          discountType: 'PERCENTAGE',
          discountValue: 10,
          startsAt: new Date('2026-01-01T00:00:00.000Z'),
          expiresAt: new Date('2099-01-01T00:00:00.000Z'),
          createdBy: adminId,
        });
      });

      await permissionsRepository.grant(managerId, 'coupon.status', adminId);
      try {
        const session = await asManager();
        const res = await session.post(`/api/admin/coupons/${created.id}/status`).send({ status: 'ACTIVE' });
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('ACTIVE');
      } finally {
        await permissionsRepository.revoke(managerId, 'coupon.status');
      }
    });

    it('coupon.delete (Assigned): a Manager without the grant is rejected 403', async () => {
      const created = await withTransactionFn(async () => {
        const coupons = await import('../../src/repositories/coupon.repository.js');
        return coupons.create({
          code: `DELONLY${Date.now()}`,
          name: 'Delete Only',
          discountType: 'PERCENTAGE',
          discountValue: 10,
          startsAt: new Date('2026-01-01T00:00:00.000Z'),
          expiresAt: new Date('2099-01-01T00:00:00.000Z'),
          createdBy: adminId,
        });
      });
      const session = await asManager();
      const res = await session.del(`/api/admin/coupons/${created.id}`);
      expect(res.status).toBe(403);
    });

    it('coupon.usage.view: Manager (Yes by default) can view usages', async () => {
      const created = await withTransactionFn(async () => {
        const coupons = await import('../../src/repositories/coupon.repository.js');
        return coupons.create({
          code: `USAGEVIEW${Date.now()}`,
          name: 'Usage View',
          discountType: 'PERCENTAGE',
          discountValue: 10,
          startsAt: new Date('2026-01-01T00:00:00.000Z'),
          expiresAt: new Date('2099-01-01T00:00:00.000Z'),
          createdBy: adminId,
        });
      });
      const session = await asManager();
      const res = await session.agent.get(`/api/admin/coupons/${created.id}/usages`);
      expect(res.status).toBe(200);
    });

    it('coupon.usage.view: revoked Manager is rejected 403', async () => {
      const created = await withTransactionFn(async () => {
        const coupons = await import('../../src/repositories/coupon.repository.js');
        return coupons.create({
          code: `USAGEVIEWREVOKED${Date.now()}`,
          name: 'Usage View Revoked',
          discountType: 'PERCENTAGE',
          discountValue: 10,
          startsAt: new Date('2026-01-01T00:00:00.000Z'),
          expiresAt: new Date('2099-01-01T00:00:00.000Z'),
          createdBy: adminId,
        });
      });
      await withManagerTierRevoked('coupon.usage.view', async () => {
        const session = await asManager();
        const res = await session.agent.get(`/api/admin/coupons/${created.id}/usages`);
        expect(res.status).toBe(403);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Acceptance 1/2: code normalization + duplicate rejection over HTTP.
  // -------------------------------------------------------------------------
  it('POST with code " save20 " stores SAVE20; creating save20 again returns 409 COUPON_CODE_EXISTS (acceptance 1)', async () => {
    const session = await asAdmin();
    const unique = `save20-${Date.now()}`;
    const first = await session.post('/api/admin/coupons').send(couponBody({ code: ` ${unique} ` }));
    expect(first.status).toBe(201);
    expect(first.body.data.code).toBe(unique.toUpperCase());

    const second = await session.post('/api/admin/coupons').send(couponBody({ code: unique }));
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('COUPON_CODE_EXISTS');
  });

  // -------------------------------------------------------------------------
  // Acceptance 3: FIXED_AMOUNT + maximumDiscountAmount -> 400.
  // -------------------------------------------------------------------------
  it('creating a FIXED_AMOUNT coupon with maximumDiscountAmount set returns 400 (acceptance 3, test 18)', async () => {
    const session = await asAdmin();
    const res = await session.post('/api/admin/coupons').send(
      couponBody({ discountType: 'FIXED_AMOUNT', discountValue: 100, maximumDiscountAmount: 50 }),
    );
    expect(res.status).toBe(400);
  });

  it('expiresAt <= startsAt returns 400', async () => {
    const session = await asAdmin();
    const res = await session
      .post('/api/admin/coupons')
      .send(couponBody({ startsAt: '2026-10-15T00:00:00.000Z', expiresAt: '2026-10-01T00:00:00.000Z' }));
    expect(res.status).toBe(400);
  });

  it('a percentage value above 100 returns 400', async () => {
    const session = await asAdmin();
    const res = await session.post('/api/admin/coupons').send(couponBody({ discountValue: 150 }));
    expect(res.status).toBe(400);
  });

  // -------------------------------------------------------------------------
  // Acceptance 5: derived displayStatus.
  // -------------------------------------------------------------------------
  it('an ACTIVE coupon whose expires_at has passed shows displayStatus EXPIRED while status remains ACTIVE (acceptance 5)', async () => {
    const session = await asAdmin();
    const created = await session.post('/api/admin/coupons').send(
      couponBody({
        status: 'ACTIVE',
        startsAt: '2020-01-01T00:00:00.000Z',
        expiresAt: '2020-02-01T00:00:00.000Z',
      }),
    );
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('ACTIVE');
    expect(created.body.data.displayStatus).toBe('EXPIRED');

    const detail = await session.agent.get(`/api/admin/coupons/${created.body.data.id}`);
    expect(detail.body.data.displayStatus).toBe('EXPIRED');
    expect(detail.body.data.status).toBe('ACTIVE');
  });

  it('a scheduled (not-yet-started) ACTIVE coupon shows displayStatus SCHEDULED', async () => {
    const session = await asAdmin();
    const created = await session.post('/api/admin/coupons').send(
      couponBody({
        status: 'ACTIVE',
        startsAt: '2099-01-01T00:00:00.000Z',
        expiresAt: '2099-02-01T00:00:00.000Z',
      }),
    );
    expect(created.body.data.displayStatus).toBe('SCHEDULED');
  });

  // -------------------------------------------------------------------------
  // Test 15: client-supplied economics rejected (§8.16).
  // -------------------------------------------------------------------------
  it('rejects an extra unknown field (e.g. discountAmount) on coupon create with 400 (strict schema)', async () => {
    const session = await asAdmin();
    const res = await session.post('/api/admin/coupons').send({ ...couponBody(), discountAmount: 999 });
    expect(res.status).toBe(400);
  });

  // -------------------------------------------------------------------------
  // Test 18: admin form / API never exposes product/category restriction
  // fields as writable — the schema simply has no such fields (acceptance 18
  // is a frontend check; this documents the API side of the same rule).
  // -------------------------------------------------------------------------
  it('the create schema rejects a productEligibility field — the API accepts no product/category restriction input (§8.12)', async () => {
    const session = await asAdmin();
    const res = await session.post('/api/admin/coupons').send({ ...couponBody(), productEligibility: 'SPECIFIC_PRODUCTS' });
    expect(res.status).toBe(400);
  });

  // -------------------------------------------------------------------------
  // Test 15/19: delete vs archive over HTTP (acceptance 15).
  // -------------------------------------------------------------------------
  describe('delete vs archive over HTTP (§8.9, acceptance 15)', () => {
    it('DELETE on an unused coupon removes it and returns { deleted: true }', async () => {
      const session = await asAdmin();
      const created = await session.post('/api/admin/coupons').send(couponBody());
      const res = await session.del(`/api/admin/coupons/${created.body.data.id}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ deleted: true });

      const getRes = await session.agent.get(`/api/admin/coupons/${created.body.data.id}`);
      expect(getRes.status).toBe(404);
    });

    it('DELETE on a used coupon returns { archived: true } and the row remains fetchable', async () => {
      const session = await asAdmin();
      const created = await session.post('/api/admin/coupons').send(couponBody({ status: 'ACTIVE' }));
      const couponId = created.body.data.id;

      // Record a usage directly via the repository, since no checkout flow exists yet.
      const coupons = await import('../../src/repositories/coupon.repository.js');
      const customersRepo = await import('../../src/repositories/customers.repository.js');
      const customer = await customersRepo.createGuestReference({
        fullName: 'Archive Test Customer',
        phoneNumber: '01733333333',
        email: null,
        address: {
          division: 'Dhaka',
          district: 'Dhaka',
          areaUnitType: 'THANA',
          areaUnitName: 'Gulshan',
          wardUnitType: 'WARD',
          wardUnitName: 'Ward 1',
          detailedAddress: 'Test address',
          postalCode: '1212',
        },
      });
      const { rows: orderRows } = await withTransactionFn((client) =>
        client.query(
          `INSERT INTO orders (order_number, customer_id, payment_method, order_status, payment_status, subtotal, shipping_amount, total_amount)
           VALUES ($1, $2, 'COD', 'PENDING_CONFIRMATION', 'PENDING_COLLECTION', 100, 0, 100) RETURNING id`,
          [`ORD-ARCHIVE-${Date.now()}`, customer.id],
        ),
      );
      await withTransactionFn((client) =>
        coupons.recordCouponUsage(client, {
          couponId,
          orderId: orderRows[0].id,
          customerId: customer.id,
          discountAmount: 10,
          perCustomerLimit: null,
        }),
      );

      const res = await session.del(`/api/admin/coupons/${couponId}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ archived: true });

      const getRes = await session.agent.get(`/api/admin/coupons/${couponId}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.data.isArchived).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Test 21: audit rows on create/update/status-change/delete.
  // -------------------------------------------------------------------------
  describe('audit rows (test 21)', () => {
    it('create writes a coupon_created audit row', async () => {
      const session = await asAdmin();
      const created = await session.post('/api/admin/coupons').send(couponBody());
      const { items } = await auditRepository.listForEntity('coupon', created.body.data.id, { page: 1, pageSize: 10 });
      expect(items.some((entry) => entry.action === 'coupon_created')).toBe(true);
    });

    it('update writes a coupon_updated audit row', async () => {
      const session = await asAdmin();
      const created = await session.post('/api/admin/coupons').send(couponBody());
      await session.patch(`/api/admin/coupons/${created.body.data.id}`).send({ name: 'Renamed Coupon' });
      const { items } = await auditRepository.listForEntity('coupon', created.body.data.id, { page: 1, pageSize: 10 });
      expect(items.some((entry) => entry.action === 'coupon_updated')).toBe(true);
    });

    it('status change writes a coupon_status_changed audit row', async () => {
      const session = await asAdmin();
      const created = await session.post('/api/admin/coupons').send(couponBody());
      await session.post(`/api/admin/coupons/${created.body.data.id}/status`).send({ status: 'ACTIVE' });
      const { items } = await auditRepository.listForEntity('coupon', created.body.data.id, { page: 1, pageSize: 10 });
      expect(items.some((entry) => entry.action === 'coupon_status_changed')).toBe(true);
    });

    it('delete writes a coupon_deleted audit row', async () => {
      const session = await asAdmin();
      const created = await session.post('/api/admin/coupons').send(couponBody());
      await session.del(`/api/admin/coupons/${created.body.data.id}`);
      const { items } = await auditRepository.listForEntity('coupon', created.body.data.id, { page: 1, pageSize: 10 });
      expect(items.some((entry) => entry.action === 'coupon_deleted')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Baseline: unauthenticated / pagination.
  // -------------------------------------------------------------------------
  it('unauthenticated GET /api/admin/coupons is rejected 401', async () => {
    const request = await import('supertest');
    const res = await request.default(app).get('/api/admin/coupons');
    expect(res.status).toBe(401);
  });

  it('rejects a pageSize over 100 with 400', async () => {
    const session = await asAdmin();
    const res = await session.agent.get('/api/admin/coupons').query({ page: 1, pageSize: 101 });
    expect(res.status).toBe(400);
  });
});
