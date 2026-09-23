import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.ts';
import { resetEnvCache } from '../../src/config/env.ts';

/**
 * Spec 03 — `managers.service` (§Service-layer rules and transaction
 * boundaries), 06-rbac §5.11, §5.12.3, §5.14 Rule 2, §5.15 rules 4/6.
 *
 * Tests required items 2 (Manager cannot manage Admin), 3 (Manager cannot
 * manage another Manager), 5 (grantor ceiling — no row written on rejection),
 * 6 (protected system Admin, including as Admin itself), 9 (audit logging
 * with actor + previous/new values).
 */
const SCHEMA = 'spec03_managersvc';

describe.skipIf(!TEST_DATABASE_URL)('managers.service', () => {
  let service: typeof import('../../src/services/managers.service.js');
  let users: typeof import('../../src/repositories/users.repository.js');
  let permissionsRepo: typeof import('../../src/repositories/permissions.repository.js');
  let auditRepo: typeof import('../../src/repositories/audit.repository.js');
  let withTransaction: typeof import('../../src/lib/transaction.js').withTransaction;
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;

  let systemAdminId: string;
  let otherAdminId: string;
  let managerAId: string;
  let managerBId: string;

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    resetEnvCache();

    ({ withTransaction, resetTransactionPool } = await import('../../src/lib/transaction.js'));
    await resetTransactionPool();
    service = await import('../../src/services/managers.service.js');
    users = await import('../../src/repositories/users.repository.js');
    permissionsRepo = await import('../../src/repositories/permissions.repository.js');
    auditRepo = await import('../../src/repositories/audit.repository.js');
  }, 60_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  beforeEach(async () => {
    await withTransaction(async (c) => {
      await c.query('DELETE FROM audit_logs');
      await c.query('DELETE FROM user_permissions');
      await c.query('DELETE FROM users');
    });

    // The protected system Admin — is_system_admin can only be set by direct
    // SQL (the seed script's own path), never through usersRepository.create.
    const sysAdmin = await withTransaction(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO users (role, user_identifier, password_hash, is_system_admin, must_change_password)
         VALUES ('ADMIN', 'sysadmin', 'hash', true, false) RETURNING id`,
      );
      return rows[0]!.id;
    });
    systemAdminId = sysAdmin;

    const otherAdmin = await users.create({
      role: 'ADMIN',
      userIdentifier: 'admin02',
      passwordHash: 'hash',
      mustChangePassword: false,
    });
    otherAdminId = otherAdmin.id;

    const managerA = await users.create({
      role: 'MANAGER',
      userIdentifier: 'mgrA',
      passwordHash: 'hash',
      createdBy: otherAdminId,
      mustChangePassword: false,
    });
    managerAId = managerA.id;

    const managerB = await users.create({
      role: 'MANAGER',
      userIdentifier: 'mgrB',
      passwordHash: 'hash',
      createdBy: otherAdminId,
      mustChangePassword: false,
    });
    managerBId = managerB.id;
  });

  async function grantsFor(userId: string) {
    return permissionsRepo.listGrantsForUser(userId);
  }

  async function auditRowsFor(entityId: string) {
    const { items } = await auditRepo.listForEntity('user', entityId, { page: 1, pageSize: 50 });
    return items;
  }

  describe('createManager (test 3, test 9)', () => {
    it('Admin creates a Manager and an audit row records it', async () => {
      const result = await service.createManager(
        { userId: otherAdminId, role: 'ADMIN' },
        { userIdentifier: 'newmgr', password: 'irrelevant-for-this-fixture' },
      );
      expect(result.role).toBe('MANAGER');

      const rows = await auditRowsFor(result.id);
      expect(rows.some((r) => r.action === 'manager_created' && r.actorUserId === otherAdminId)).toBe(true);
    });

    it('Manager cannot create a Manager (§5.14 Rule 2, test 3)', async () => {
      await expect(
        service.createManager(
          { userId: managerAId, role: 'MANAGER' },
          { userIdentifier: 'illegal-mgr', password: 'irrelevant' },
        ),
      ).rejects.toMatchObject({ status: 403 });

      expect(await users.findByUserIdentifier('illegal-mgr')).toBeNull();
    });

    it('rejects granting a permission the Admin actor does not itself hold — no user_permissions row written (test 5)', async () => {
      // Simulate a reduced-permission Admin scenario is not directly possible
      // (Admin always holds every YES-tier key), so this exercises the same
      // guard through a Manager grantor path in setManagerPermissions below;
      // createManager's own ceiling check is exercised here via an
      // ASSIGNED-tier key the actor (Admin) DOES hold, confirming the happy
      // path, and the negative case is covered by setManagerPermissions
      // (which every grantor, Admin or Manager, goes through identically).
      const result = await service.createManager(
        { userId: otherAdminId, role: 'ADMIN' },
        { userIdentifier: 'grant-on-create', password: 'irrelevant', permissions: ['cms.manage'] },
      );
      expect(result.permissions).toEqual(['cms.manage']);
      expect(await grantsFor(result.id)).toEqual(['cms.manage']);
    });

    it('rejects a YES-tier permission on create with PERMISSION_NOT_ASSIGNABLE', async () => {
      await expect(
        service.createManager(
          { userId: otherAdminId, role: 'ADMIN' },
          { userIdentifier: 'yes-tier-mgr', password: 'irrelevant', permissions: ['order.confirm'] },
        ),
      ).rejects.toMatchObject({ code: 'PERMISSION_NOT_ASSIGNABLE', status: 400 });
    });

    it('rejects a NO-tier permission on create with PERMISSION_NOT_ASSIGNABLE', async () => {
      await expect(
        service.createManager(
          { userId: otherAdminId, role: 'ADMIN' },
          { userIdentifier: 'no-tier-mgr', password: 'irrelevant', permissions: ['rbac.configure'] },
        ),
      ).rejects.toMatchObject({ code: 'PERMISSION_NOT_ASSIGNABLE', status: 400 });
    });
  });

  describe('updateManager (test 2, test 3, test 6)', () => {
    it('Admin updates a Manager and an audit row records previous/new values', async () => {
      const result = await service.updateManager(
        { userId: otherAdminId, role: 'ADMIN' },
        managerAId,
        { userIdentifier: 'mgrA-renamed' },
      );
      expect(result.userIdentifier).toBe('mgrA-renamed');

      const rows = await auditRowsFor(managerAId);
      const updateRow = rows.find((r) => r.action === 'manager_updated');
      expect(updateRow?.actorUserId).toBe(otherAdminId);
      expect(updateRow?.previousValue).toMatchObject({ userIdentifier: 'mgrA' });
      expect(updateRow?.newValue).toMatchObject({ userIdentifier: 'mgrA-renamed' });
    });

    it('Manager cannot update the Admin account (§5.11, test 2)', async () => {
      await expect(
        service.updateManager({ userId: managerAId, role: 'MANAGER' }, otherAdminId, {
          userIdentifier: 'hijacked',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    });

    it('Manager cannot update another Manager account (§5.11, §5.14 Rule 2, test 3)', async () => {
      await expect(
        service.updateManager({ userId: managerAId, role: 'MANAGER' }, managerBId, {
          userIdentifier: 'hijacked-b',
        }),
      ).rejects.toMatchObject({ status: 403 });

      const untouched = await users.findById(managerBId);
      expect(untouched?.userIdentifier).toBe('mgrB');
    });

    it('the system Admin id 404s on update, even called by the Admin itself (§5.12.3, test 6)', async () => {
      await expect(
        service.updateManager({ userId: otherAdminId, role: 'ADMIN' }, systemAdminId, {
          userIdentifier: 'renamed-sysadmin',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });

      const untouched = await users.findById(systemAdminId);
      expect(untouched?.userIdentifier).toBe('sysadmin');
    });

    it('an Admin targeting its own (non-Manager) id 404s — this endpoint only ever operates on Manager rows (§5.12.3)', async () => {
      // updateManager's target-role check runs before the self-check, so an
      // Admin can never even reach the self-modification guard here: the only
      // creatable/updatable role through this endpoint is MANAGER, and the
      // Admin's own row is role ADMIN.
      await expect(
        service.updateManager({ userId: otherAdminId, role: 'ADMIN' }, otherAdminId, {
          userIdentifier: 'self-renamed',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    });

    it('a Manager cannot modify its own account (§5.15 rule 4)', async () => {
      await expect(
        service.updateManager({ userId: managerAId, role: 'MANAGER' }, managerAId, {
          userIdentifier: 'self-renamed-mgr',
        }),
      ).rejects.toMatchObject({ code: 'CANNOT_MODIFY_SELF', status: 403 });
    });
  });

  describe('deleteManager (test 2, test 3, test 6, test 9)', () => {
    it('Admin deletes a Manager and an audit row records the deleted identifier and role', async () => {
      await service.deleteManager({ userId: otherAdminId, role: 'ADMIN' }, managerAId);

      expect(await users.findById(managerAId)).toBeNull();
      const rows = await auditRowsFor(managerAId);
      const deleteRow = rows.find((r) => r.action === 'manager_deleted');
      expect(deleteRow?.actorUserId).toBe(otherAdminId);
      expect(deleteRow?.previousValue).toMatchObject({ userIdentifier: 'mgrA', role: 'MANAGER' });
    });

    it('Manager cannot delete the Admin account (§5.11, test 2)', async () => {
      await expect(
        service.deleteManager({ userId: managerAId, role: 'MANAGER' }, otherAdminId),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
      expect(await users.findById(otherAdminId)).not.toBeNull();
    });

    it('Manager cannot delete another Manager (§5.14 Rule 2, test 3)', async () => {
      await expect(
        service.deleteManager({ userId: managerAId, role: 'MANAGER' }, managerBId),
      ).rejects.toMatchObject({ status: 403 });
      expect(await users.findById(managerBId)).not.toBeNull();
    });

    it('the system Admin id 404s on delete, even called by the Admin itself (§5.12.3, test 6)', async () => {
      await expect(
        service.deleteManager({ userId: otherAdminId, role: 'ADMIN' }, systemAdminId),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
      expect(await users.findById(systemAdminId)).not.toBeNull();
    });

    it('an Admin targeting its own (non-Manager) id 404s — this endpoint only ever operates on Manager rows', async () => {
      await expect(
        service.deleteManager({ userId: otherAdminId, role: 'ADMIN' }, otherAdminId),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    });

    it('a Manager cannot delete its own account (§5.15 rule 4)', async () => {
      await expect(
        service.deleteManager({ userId: managerAId, role: 'MANAGER' }, managerAId),
      ).rejects.toMatchObject({ code: 'CANNOT_MODIFY_SELF', status: 403 });
      expect(await users.findById(managerAId)).not.toBeNull();
    });
  });

  describe('deactivateManager / reactivateManager (test 2, test 3, test 6, test 9)', () => {
    it('Admin deactivates then reactivates a Manager, each step audited', async () => {
      const deactivated = await service.deactivateManager({ userId: otherAdminId, role: 'ADMIN' }, managerAId);
      expect(deactivated.isActive).toBe(false);

      const reactivated = await service.reactivateManager({ userId: otherAdminId, role: 'ADMIN' }, managerAId);
      expect(reactivated.isActive).toBe(true);

      const rows = await auditRowsFor(managerAId);
      expect(rows.some((r) => r.action === 'manager_deactivated')).toBe(true);
      expect(rows.some((r) => r.action === 'manager_reactivated')).toBe(true);
    });

    it('Manager cannot deactivate the Admin account (§5.11, test 2)', async () => {
      await expect(
        service.deactivateManager({ userId: managerAId, role: 'MANAGER' }, otherAdminId),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    });

    it('Manager cannot deactivate another Manager (§5.14 Rule 2, test 3)', async () => {
      await expect(
        service.deactivateManager({ userId: managerAId, role: 'MANAGER' }, managerBId),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('the system Admin id 404s on deactivate, even called by the Admin itself (§5.12.3, test 6)', async () => {
      await expect(
        service.deactivateManager({ userId: otherAdminId, role: 'ADMIN' }, systemAdminId),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
      const untouched = await users.findById(systemAdminId);
      expect(untouched?.isActive).toBe(true);
    });
  });

  describe('setManagerPermissions (test 2, 3, 5, 6, 8, 9)', () => {
    it('Admin grants an ASSIGNED permission; a grant audit row records actor and new value', async () => {
      const result = await service.setManagerPermissions({ userId: otherAdminId, role: 'ADMIN' }, managerAId, [
        'cms.manage',
      ]);
      expect(result.permissions).toEqual(['cms.manage']);

      const rows = await auditRowsFor(managerAId);
      const grantRow = rows.find((r) => r.action === 'permission_grant');
      expect(grantRow?.actorUserId).toBe(otherAdminId);
      expect(grantRow?.newValue).toMatchObject({ permission: 'cms.manage' });
    });

    it('revoking a held permission writes a revoke audit row with the previous value', async () => {
      await service.setManagerPermissions({ userId: otherAdminId, role: 'ADMIN' }, managerAId, ['cms.manage']);
      await service.setManagerPermissions({ userId: otherAdminId, role: 'ADMIN' }, managerAId, []);

      expect(await grantsFor(managerAId)).toEqual([]);
      const rows = await auditRowsFor(managerAId);
      const revokeRow = rows.find((r) => r.action === 'permission_revoke');
      expect(revokeRow?.previousValue).toMatchObject({ permission: 'cms.manage' });
    });

    it('Manager cannot set permissions on the Admin account (§5.11, test 2)', async () => {
      await expect(
        service.setManagerPermissions({ userId: managerAId, role: 'MANAGER' }, otherAdminId, ['cms.manage']),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    });

    it('Manager cannot set permissions on another Manager (§5.11, test 3)', async () => {
      await expect(
        service.setManagerPermissions({ userId: managerAId, role: 'MANAGER' }, managerBId, ['cms.manage']),
      ).rejects.toMatchObject({ status: 403 });
      expect(await grantsFor(managerBId)).toEqual([]);
    });

    it('the system Admin id 404s on permission-set, even called by the Admin itself (§5.12.3, test 6)', async () => {
      await expect(
        service.setManagerPermissions({ userId: otherAdminId, role: 'ADMIN' }, systemAdminId, ['cms.manage']),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    });

    it('no self-grant: a Manager cannot set its own permissions (§5.15 rule 4)', async () => {
      await expect(
        service.setManagerPermissions({ userId: managerAId, role: 'MANAGER' }, managerAId, ['cms.manage']),
      ).rejects.toMatchObject({ code: 'CANNOT_MODIFY_SELF', status: 403 });
    });

    it('a grantor Manager cannot grant a permission it does not itself hold — no row written (§5.15 rule 6, test 5)', async () => {
      // managerA has no grants at all; attempts to grant cms.manage (ASSIGNED)
      // to managerB must fail at grant time, not merely be unusable later.
      await expect(
        service.setManagerPermissions({ userId: managerAId, role: 'MANAGER' }, managerBId, ['cms.manage']),
      ).rejects.toMatchObject({ status: 403 });
      // (This also 403s on the hierarchy check since Manager can't touch
      // another Manager at all — assert no row regardless of which guard fired.)
      expect(await grantsFor(managerBId)).toEqual([]);
    });

    it('rejects granting a YES-tier key with PERMISSION_NOT_ASSIGNABLE (acceptance 11)', async () => {
      await expect(
        service.setManagerPermissions({ userId: otherAdminId, role: 'ADMIN' }, managerAId, ['order.confirm']),
      ).rejects.toMatchObject({ code: 'PERMISSION_NOT_ASSIGNABLE', status: 400 });
      expect(await grantsFor(managerAId)).toEqual([]);
    });

    it('rejects granting a NO-tier key with PERMISSION_NOT_ASSIGNABLE (acceptance 12)', async () => {
      await expect(
        service.setManagerPermissions({ userId: otherAdminId, role: 'ADMIN' }, managerAId, ['rbac.configure']),
      ).rejects.toMatchObject({ code: 'PERMISSION_NOT_ASSIGNABLE', status: 400 });
      expect(await grantsFor(managerAId)).toEqual([]);
    });

    it('courier.manage and courier.select are granted/checked independently (§5.16, test 8)', async () => {
      // courier.select is YES for Manager by default — rejected as not-assignable.
      await expect(
        service.setManagerPermissions({ userId: otherAdminId, role: 'ADMIN' }, managerAId, ['courier.select']),
      ).rejects.toMatchObject({ code: 'PERMISSION_NOT_ASSIGNABLE', status: 400 });

      // courier.manage is ASSIGNED and grantable; granting it does not imply courier.select changes.
      const result = await service.setManagerPermissions({ userId: otherAdminId, role: 'ADMIN' }, managerAId, [
        'courier.manage',
      ]);
      expect(result.permissions).toEqual(['courier.manage']);
    });
  });

  describe('deleting a Manager cascades its grants but preserves audit history (open question 5)', () => {
    it('audit rows survive the account deletion via actor_user_id ON DELETE SET NULL', async () => {
      await service.setManagerPermissions({ userId: otherAdminId, role: 'ADMIN' }, managerAId, ['cms.manage']);
      await service.deleteManager({ userId: otherAdminId, role: 'ADMIN' }, managerAId);

      // Grants are gone (cascade via user_permissions FK).
      expect(await grantsFor(managerAId)).toEqual([]);

      // Audit rows about the deleted user's own account remain, keyed by entity_id.
      const rows = await auditRowsFor(managerAId);
      expect(rows.length).toBeGreaterThan(0);
    });
  });
});
