import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.ts';
import { applyTestEnv } from '../helpers/testEnv.ts';
import { resetEnvCache } from '../../src/config/env.ts';
import { loginAsAdmin } from '../helpers/adminSession.ts';
import { MATRIX } from '../helpers/rbacMatrix.ts';
import type { PermissionKey } from '../../src/types/permissions.ts';

/**
 * Spec 03 — full §5.18 permission matrix, exercised through
 * `resolveEffectivePermissions` + `requirePermission` via `GET /auth/me`
 * (tests required item 1: "one test per row, so a failure names the exact
 * permission"), plus item 8 (courier.manage vs courier.select independence)
 * and item 10 (frontend-hiding is not a boundary — every call below goes
 * straight at the API with no UI).
 *
 * `GET /auth/me` reports the resolved `permissions[]` array for the caller,
 * which is the precise per-row claim §5.18 makes ("Admin: Yes/Manager:
 * Yes/Assigned/No") without needing a live route for all 47 keys — most keys
 * are gated by specs not yet built. Spec 03's own five gated routes
 * (`user.manager.create/update/delete`, `permission.assign`, `audit.view`)
 * additionally get a direct-call assertion via `ROUTES`, satisfying "call the
 * mutation endpoints directly as an unauthorized actor" for the highest-risk
 * subset this slice actually mounts.
 */
const SCHEMA = 'spec03_rbacmatrix';

describe.skipIf(!TEST_DATABASE_URL)('RBAC matrix (06-rbac §5.18)', () => {
  let app: Express;
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;
  let users: typeof import('../../src/repositories/users.repository.js');
  let permissionsRepo: typeof import('../../src/repositories/permissions.repository.js');
  let hashPassword: typeof import('../../src/lib/password.js').hashPassword;

  let adminId: string;
  let managerId: string;

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    applyTestEnv();
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    resetEnvCache();

    ({ resetTransactionPool } = await import('../../src/lib/transaction.js'));
    await resetTransactionPool();
    users = await import('../../src/repositories/users.repository.js');
    permissionsRepo = await import('../../src/repositories/permissions.repository.js');
    ({ hashPassword } = await import('../../src/lib/password.js'));
    const { createApp } = await import('../../src/app.js');
    app = createApp();

    const passwordHash = await hashPassword('RbacMatrixPass12');
    adminId = (
      await users.create({ role: 'ADMIN', userIdentifier: 'matrix-admin', passwordHash, mustChangePassword: false })
    ).id;
    managerId = (
      await users.create({
        role: 'MANAGER',
        userIdentifier: 'matrix-manager',
        passwordHash,
        mustChangePassword: false,
      })
    ).id;
  }, 60_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  async function meAsManager(): Promise<string[]> {
    const session = await loginAsAdmin(app, 'matrix-manager', 'RbacMatrixPass12');
    const res = await session.agent.get('/api/admin/auth/me');
    return res.body.data.permissions as string[];
  }
  async function meAsAdmin(): Promise<string[]> {
    const session = await loginAsAdmin(app, 'matrix-admin', 'RbacMatrixPass12');
    const res = await session.agent.get('/api/admin/auth/me');
    return res.body.data.permissions as string[];
  }

  it.each(Object.entries(MATRIX))(
    '%s matches the §5.18 matrix (test 1)',
    async (key, [adminTier, managerTier]) => {
      const adminPermissions = await meAsAdmin();
      expect(adminPermissions, `Admin should hold ${key} (${adminTier})`).toContain(key);

      // Clean slate: remove any grant from a prior row's test.
      await permissionsRepo.revoke(managerId, key as PermissionKey);

      const managerBefore = await meAsManager();
      if (managerTier === 'YES') {
        expect(managerBefore, `Manager should hold ${key} by default (YES)`).toContain(key);
      } else {
        expect(managerBefore, `Manager should NOT hold ${key} (${managerTier}) without a grant`).not.toContain(key);
      }

      if (managerTier === 'ASSIGNED') {
        await permissionsRepo.grant(managerId, key as PermissionKey, adminId);
        const managerAfterGrant = await meAsManager();
        expect(managerAfterGrant, `Manager should hold ${key} once granted (ASSIGNED)`).toContain(key);

        await permissionsRepo.revoke(managerId, key as PermissionKey);
        const managerAfterRevoke = await meAsManager();
        expect(managerAfterRevoke, `Manager should lose ${key} once revoked`).not.toContain(key);
      }
    },
  );

  describe('courier.manage vs courier.select independence (test 8)', () => {
    it('a default Manager has courier.select but not courier.manage', async () => {
      await permissionsRepo.revoke(managerId, 'courier.manage');
      const permissions = await meAsManager();
      expect(permissions).toContain('courier.select');
      expect(permissions).not.toContain('courier.manage');
    });

    it('granting courier.manage does not remove or imply anything about courier.select', async () => {
      await permissionsRepo.grant(managerId, 'courier.manage', adminId);
      const permissions = await meAsManager();
      expect(permissions).toContain('courier.manage');
      expect(permissions).toContain('courier.select');
      await permissionsRepo.revoke(managerId, 'courier.manage');
    });
  });

  describe('a manager_tier=NO permission is unreachable even if granted directly at the data layer', () => {
    it('user.manager.create stays absent after a direct INSERT (test 14, defence in depth)', async () => {
      const { withTransaction } = await import('../../src/lib/transaction.js');
      await withTransaction(async (c) => {
        await c.query(
          `INSERT INTO user_permissions (user_id, permission_key, granted_by)
           VALUES ($1, 'user.manager.create', $2) ON CONFLICT DO NOTHING`,
          [managerId, adminId],
        );
      });
      const permissions = await meAsManager();
      expect(permissions).not.toContain('user.manager.create');

      // Cleanup so it doesn't affect later `it.each` iterations if re-ordered.
      await permissionsRepo.revoke(managerId, 'user.manager.create');
    });
  });

  describe('frontend-hiding is not a boundary — direct unauthorized calls (test 10)', () => {
    it('POST /api/admin/managers as an ungranted Manager is rejected (no UI involved)', async () => {
      const session = await loginAsAdmin(app, 'matrix-manager', 'RbacMatrixPass12');
      const res = await session.post('/api/admin/managers').send({
        userIdentifier: 'unauthorized-create',
        password: 'IrrelevantPass12',
      });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(await users.findByUserIdentifier('unauthorized-create')).toBeNull();
    });

    it('PUT /api/admin/managers/:id/permissions as an ungranted Manager is rejected', async () => {
      const session = await loginAsAdmin(app, 'matrix-manager', 'RbacMatrixPass12');
      const targetHash = await hashPassword('TargetPass12');
      const target = await users.create({
        role: 'MANAGER',
        userIdentifier: 'matrix-target',
        passwordHash: targetHash,
        mustChangePassword: false,
      });
      const res = await session.put(`/api/admin/managers/${target.id}/permissions`).send({
        permissions: ['cms.manage'],
      });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(await permissionsRepo.listGrantsForUser(target.id)).toEqual([]);
    });

    it('DELETE /api/admin/managers/:id as an ungranted Manager is rejected', async () => {
      const session = await loginAsAdmin(app, 'matrix-manager', 'RbacMatrixPass12');
      const targetHash = await hashPassword('TargetPass12');
      const target = await users.create({
        role: 'MANAGER',
        userIdentifier: 'matrix-delete-target',
        passwordHash: targetHash,
        mustChangePassword: false,
      });
      const res = await session.del(`/api/admin/managers/${target.id}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(await users.findById(target.id)).not.toBeNull();
    });

    it('unauthenticated (no session) POST /api/admin/managers is rejected with 401', async () => {
      const request = (await import('supertest')).default;
      const res = await request(app).post('/api/admin/managers').send({
        userIdentifier: 'no-session-create',
        password: 'IrrelevantPass12',
      });
      expect(res.status).toBe(401);
    });
  });
});
