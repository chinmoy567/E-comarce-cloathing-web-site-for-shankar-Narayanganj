import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SAMPLE_CUSTOMER, TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.ts';
import { resetEnvCache } from '../../src/config/env.ts';
/**
 * Spec 03 — effective-permission resolution (§Middleware, 06-rbac §5.18).
 *
 * Tests required item 14: a `manager_tier = 'NO'` permission inserted directly
 * into `user_permissions` at the data layer must still be excluded from
 * resolution, since the grant endpoint's own guard (assertAssignableTier) is
 * bypassed by writing the row directly rather than through the service.
 */
const SCHEMA = 'spec03_permsvc';
describe.skipIf(!TEST_DATABASE_URL)('permissions.service resolveEffectivePermissions', () => {
    let service;
    let users;
    let withTransaction;
    let resetTransactionPool;
    let adminId;
    let managerId;
    beforeAll(async () => {
        await resetSchema(SCHEMA);
        process.env.DATABASE_URL = scopedUrl(SCHEMA);
        resetEnvCache();
        ({ withTransaction, resetTransactionPool } = await import('../../src/lib/transaction.js'));
        await resetTransactionPool();
        service = await import('../../src/services/permissions.service.js');
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
        const admin = await users.create({ role: 'ADMIN', userIdentifier: 'admin01', passwordHash: 'hash' });
        adminId = admin.id;
        const manager = await users.create({
            role: 'MANAGER',
            userIdentifier: 'mgr01',
            passwordHash: 'hash',
            createdBy: adminId,
        });
        managerId = manager.id;
    });
    it('ADMIN resolves to every admin_tier=YES key (47 rows, all YES for Admin)', async () => {
        const permissions = await service.resolveEffectivePermissions(adminId, 'ADMIN');
        expect(permissions).toHaveLength(47);
        expect(permissions).toContain('rbac.configure');
        expect(permissions).toContain('user.manager.create');
    });
    it('MANAGER with no grants resolves to exactly the manager_tier=YES keys', async () => {
        const permissions = await service.resolveEffectivePermissions(managerId, 'MANAGER');
        expect(permissions).toContain('order.confirm'); // YES
        expect(permissions).not.toContain('cms.manage'); // ASSIGNED, ungranted
        expect(permissions).not.toContain('user.manager.create'); // NO
    });
    it('MANAGER with an ASSIGNED grant gains exactly that key', async () => {
        await withTransaction(async (c) => {
            await c.query(`INSERT INTO user_permissions (user_id, permission_key, granted_by) VALUES ($1, 'cms.manage', $2)`, [managerId, adminId]);
        });
        const permissions = await service.resolveEffectivePermissions(managerId, 'MANAGER');
        expect(permissions).toContain('cms.manage');
    });
    it('a stray manager_tier=NO grant row is ignored by resolution (spec 03 test 14)', async () => {
        // Written directly at the data layer, bypassing the grant endpoint's own
        // assertAssignableTier guard entirely.
        await withTransaction(async (c) => {
            await c.query(`INSERT INTO user_permissions (user_id, permission_key, granted_by) VALUES ($1, 'user.manager.create', $2)`, [managerId, adminId]);
        });
        const permissions = await service.resolveEffectivePermissions(managerId, 'MANAGER');
        expect(permissions).not.toContain('user.manager.create');
    });
    it('CUSTOMER role resolves to no permissions', async () => {
        // `users_role_shape` (spec 02 migration) requires a CUSTOMER row to carry
        // a `customer_id` FK — insert a minimal customers row first.
        const customerId = await withTransaction(async (c) => {
            const { rows } = await c.query(`INSERT INTO customers (
           account_type, full_name, phone_number, email, division, district,
           area_unit_type, area_unit_name, ward_unit_type, ward_unit_name,
           detailed_address, postal_code
         ) VALUES ('REGISTERED', $1, '01712340001', $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`, [
                SAMPLE_CUSTOMER.fullName,
                SAMPLE_CUSTOMER.email,
                SAMPLE_CUSTOMER.address.division,
                SAMPLE_CUSTOMER.address.district,
                SAMPLE_CUSTOMER.address.areaUnitType,
                SAMPLE_CUSTOMER.address.areaUnitName,
                SAMPLE_CUSTOMER.address.wardUnitType,
                SAMPLE_CUSTOMER.address.wardUnitName,
                SAMPLE_CUSTOMER.address.detailedAddress,
                SAMPLE_CUSTOMER.address.postalCode,
            ]);
            return rows[0].id;
        });
        const customer = await users.create({
            role: 'CUSTOMER',
            phoneNumber: '01712340001',
            passwordHash: 'hash',
            customerId,
        });
        const permissions = await service.resolveEffectivePermissions(customer.id, 'CUSTOMER');
        expect(permissions).toEqual([]);
    });
    it('courier.manage and courier.select resolve independently for a default Manager (test 8)', async () => {
        const permissions = await service.resolveEffectivePermissions(managerId, 'MANAGER');
        expect(permissions).toContain('courier.select'); // YES
        expect(permissions).not.toContain('courier.manage'); // ASSIGNED, ungranted
        await withTransaction(async (c) => {
            await c.query(`INSERT INTO user_permissions (user_id, permission_key, granted_by) VALUES ($1, 'courier.manage', $2)`, [managerId, adminId]);
        });
        const afterGrant = await service.resolveEffectivePermissions(managerId, 'MANAGER');
        expect(afterGrant).toContain('courier.manage');
        expect(afterGrant).toContain('courier.select');
    });
});
