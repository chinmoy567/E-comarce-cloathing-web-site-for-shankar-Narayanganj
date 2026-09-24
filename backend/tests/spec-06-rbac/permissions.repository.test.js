import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl, } from '../helpers/schemaFixture.ts';
import { resetEnvCache } from '../../src/config/env.ts';
/**
 * Spec 02 — permission catalogue reads and ASSIGNED-tier grants (06-rbac §5.16,
 * §5.18, error table row 3).
 *
 * This layer only stores grants; "may this user do X?" is spec 03's service.
 * What must hold here is that a grant is idempotent by construction (the unique
 * constraint, not a check-then-insert), that an unknown key cannot be granted,
 * and that a deleted account takes its grants with it.
 */
const SCHEMA = 'spec02_permissions_repo';
describe.skipIf(!TEST_DATABASE_URL)('permissions repository', () => {
    let repo;
    let users;
    let withTransaction;
    let resetTransactionPool;
    let managerId;
    let adminId;
    beforeAll(async () => {
        await resetSchema(SCHEMA);
        process.env.DATABASE_URL = scopedUrl(SCHEMA);
        resetEnvCache();
        ({ withTransaction, resetTransactionPool } = await import('../../src/lib/transaction.js'));
        await resetTransactionPool();
        repo = await import('../../src/repositories/permissions.repository.js');
        users = await import('../../src/repositories/users.repository.js');
    }, 60_000);
    afterAll(async () => {
        await resetTransactionPool?.();
        await dropSchema(SCHEMA);
    });
    beforeEach(async () => {
        await withTransaction(async (c) => {
            await c.query('DELETE FROM user_permissions');
            await c.query('DELETE FROM users');
        });
        const admin = await users.create({
            role: 'ADMIN',
            userIdentifier: 'admin01',
            passwordHash: 'hash',
        });
        adminId = admin.id;
        const manager = await users.create({
            role: 'MANAGER',
            userIdentifier: 'mgr01',
            passwordHash: 'hash',
            createdBy: adminId,
        });
        managerId = manager.id;
    });
    describe('listAll (§5.18)', () => {
        it('returns the whole seeded catalogue in key order', async () => {
            const all = await repo.listAll();
            expect(all).toHaveLength(47);
            const keys = all.map((p) => p.key);
            expect(keys).toEqual([...keys].sort());
        });
        it('carries the tiers and the administrative flag through unchanged', async () => {
            const all = await repo.listAll();
            const byKey = new Map(all.map((p) => [p.key, p]));
            // Every Admin row in the §5.18 matrix is YES.
            expect(all.every((p) => p.adminTier === 'YES')).toBe(true);
            expect(byKey.get('order.confirm')?.managerTier).toBe('YES');
            expect(byKey.get('cms.manage')?.managerTier).toBe('ASSIGNED');
            expect(byKey.get('user.manager.create')?.managerTier).toBe('NO');
            // §5.17 — administrative vs operational.
            expect(byKey.get('user.manager.create')?.isAdministrative).toBe(true);
            expect(byKey.get('order.confirm')?.isAdministrative).toBe(false);
            expect(byKey.get('cms.manage')?.label).toBe('CMS Management');
        });
    });
    describe('grant (error table: UNKNOWN_PERMISSION)', () => {
        it('records a grant that listGrantsForUser reads back', async () => {
            await repo.grant(managerId, 'order.cancel', adminId);
            expect(await repo.listGrantsForUser(managerId)).toEqual(['order.cancel']);
        });
        it('is idempotent: re-granting adds no second row', async () => {
            await repo.grant(managerId, 'order.cancel', adminId);
            await repo.grant(managerId, 'order.cancel', adminId);
            expect(await repo.listGrantsForUser(managerId)).toEqual(['order.cancel']);
            const { count } = await withTransaction(async (c) => {
                const { rows } = await c.query('SELECT count(*)::text AS count FROM user_permissions WHERE user_id = $1', [managerId]);
                return { count: rows[0].count };
            });
            expect(count).toBe('1');
        });
        it('survives concurrent grants of the same key without a duplicate', async () => {
            // The unique constraint, not a check-then-insert, is what makes this safe.
            await Promise.all([
                repo.grant(managerId, 'analytics.view', adminId),
                repo.grant(managerId, 'analytics.view', adminId),
                repo.grant(managerId, 'analytics.view', adminId),
            ]);
            expect(await repo.listGrantsForUser(managerId)).toEqual(['analytics.view']);
        });
        it('rejects a key that is not in the catalogue', async () => {
            await expect(
            // @ts-expect-error — PermissionKey must not admit an invented key.
            repo.grant(managerId, 'orders.delete.everything', adminId)).rejects.toMatchObject({ code: 'UNKNOWN_PERMISSION', status: 400 });
        });
        it('rejects a grant to a user that does not exist', async () => {
            await expect(repo.grant('00000000-0000-0000-0000-000000000000', 'order.cancel', adminId)).rejects.toThrow();
        });
    });
    describe('listGrantsForUser', () => {
        it('returns an empty list for an account with no grants', async () => {
            expect(await repo.listGrantsForUser(managerId)).toEqual([]);
        });
        it('returns grants in key order and does not leak another user’s', async () => {
            const other = await users.create({
                role: 'MANAGER',
                userIdentifier: 'mgr02',
                passwordHash: 'hash',
                createdBy: adminId,
            });
            await repo.grant(managerId, 'order.cancel', adminId);
            await repo.grant(managerId, 'analytics.view', adminId);
            await repo.grant(other.id, 'coupon.create', adminId);
            expect(await repo.listGrantsForUser(managerId)).toEqual(['analytics.view', 'order.cancel']);
            expect(await repo.listGrantsForUser(other.id)).toEqual(['coupon.create']);
        });
    });
    describe('revoke', () => {
        it('removes the grant', async () => {
            await repo.grant(managerId, 'order.cancel', adminId);
            await repo.revoke(managerId, 'order.cancel');
            expect(await repo.listGrantsForUser(managerId)).toEqual([]);
        });
        it('revoking a permission that is not held is a no-op, not an error', async () => {
            await expect(repo.revoke(managerId, 'order.cancel')).resolves.toBeUndefined();
        });
    });
    describe('referential integrity', () => {
        it('deleting an account cascades its grants away', async () => {
            await repo.grant(managerId, 'order.cancel', adminId);
            await withTransaction(async (c) => {
                await c.query('DELETE FROM users WHERE id = $1', [managerId]);
            });
            expect(await repo.listGrantsForUser(managerId)).toEqual([]);
        });
        it('a catalogue row cannot be deleted while it is granted (ON DELETE RESTRICT)', async () => {
            await repo.grant(managerId, 'order.cancel', adminId);
            await expect(withTransaction(async (c) => {
                await c.query(`DELETE FROM permissions WHERE key = 'order.cancel'`);
            })).rejects.toThrow();
        });
    });
});
