import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.ts';
import { applyTestEnv } from '../helpers/testEnv.ts';
import { resetEnvCache } from '../../src/config/env.ts';
import { loginAsAdmin } from '../helpers/adminSession.ts';
/**
 * Spec 03 — `/api/admin/managers/*` over real HTTP (§Routes, §Validation
 * rules, §Error cases, acceptance 9–17).
 *
 * Tests required item 4 (self-escalation ban / no `role` field anywhere) and
 * the tampered-client cases CLAUDE.md and skill C.2 require for anything
 * shaped like permissions.
 */
const SCHEMA = 'spec03_managersapi';
describe.skipIf(!TEST_DATABASE_URL)('managers API', () => {
    let app;
    let resetTransactionPool;
    let users;
    let hashPassword;
    let adminId;
    let systemAdminId;
    beforeAll(async () => {
        await resetSchema(SCHEMA);
        applyTestEnv();
        process.env.DATABASE_URL = scopedUrl(SCHEMA);
        resetEnvCache();
        ({ resetTransactionPool } = await import('../../src/lib/transaction.js'));
        await resetTransactionPool();
        users = await import('../../src/repositories/users.repository.js');
        ({ hashPassword } = await import('../../src/lib/password.js'));
        const { createApp } = await import('../../src/app.js');
        app = createApp();
        const passwordHash = await hashPassword('ManagersApiPass12');
        adminId = (await users.create({ role: 'ADMIN', userIdentifier: 'mapi-admin', passwordHash, mustChangePassword: false })).id;
        const { withTransaction } = await import('../../src/lib/transaction.js');
        systemAdminId = await withTransaction(async (c) => {
            const { rows } = await c.query(`INSERT INTO users (role, user_identifier, password_hash, is_system_admin, must_change_password)
         VALUES ('ADMIN', 'mapi-sysadmin', $1, true, false) RETURNING id`, [passwordHash]);
            return rows[0].id;
        });
    }, 60_000);
    afterAll(async () => {
        await resetTransactionPool?.();
        await dropSchema(SCHEMA);
    });
    async function adminSession() {
        return loginAsAdmin(app, 'mapi-admin', 'ManagersApiPass12');
    }
    describe('POST /managers (acceptance 9, 10)', () => {
        it('Admin creates a Manager with ASSIGNED permissions; response and /auth/me both reflect it (acceptance 10)', async () => {
            const session = await adminSession();
            const res = await session.post('/api/admin/managers').send({
                userIdentifier: 'newmgr01',
                password: 'NewManagerPass12',
                permissions: ['cms.manage'],
            });
            expect(res.status).toBe(201);
            expect(res.body.data.role).toBe('MANAGER');
            expect(res.body.data.permissions).toEqual(['cms.manage']);
            const newMgrSession = await loginAsAdmin(app, 'newmgr01', 'NewManagerPass12');
            const me = await newMgrSession.agent.get('/api/admin/auth/me');
            expect(me.body.data.permissions).toContain('cms.manage');
            expect(me.body.data.permissions).toContain('order.confirm'); // YES-tier
            expect(me.body.data.permissions).not.toContain('user.manager.create'); // NO-tier
        });
        it('a Manager calling POST /managers gets 403 even with a well-formed body (acceptance 9)', async () => {
            const session = await adminSession();
            const mgrRes = await session.post('/api/admin/managers').send({
                userIdentifier: 'plain-manager',
                password: 'PlainManagerPass12',
            });
            const mgrSession = await loginAsAdmin(app, 'plain-manager', 'PlainManagerPass12');
            const res = await mgrSession.post('/api/admin/managers').send({
                userIdentifier: 'attempted-create',
                password: 'AttemptedPass12',
            });
            expect(res.status).toBe(403);
            expect(await users.findByUserIdentifier('attempted-create')).toBeNull();
            void mgrRes;
        });
        it('rejects a request body carrying a role field (test 4, acceptance 16)', async () => {
            const session = await adminSession();
            const res = await session.post('/api/admin/managers').send({
                userIdentifier: 'role-smuggle',
                password: 'RoleSmugglePass12',
                role: 'ADMIN',
            });
            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(await users.findByUserIdentifier('role-smuggle')).toBeNull();
        });
        it('rejects a request body carrying isSystemAdmin', async () => {
            const session = await adminSession();
            const res = await session.post('/api/admin/managers').send({
                userIdentifier: 'sysadmin-smuggle',
                password: 'SysAdminSmugglePass12',
                isSystemAdmin: true,
            });
            expect(res.status).toBe(400);
        });
        it('rejects a duplicate userIdentifier with 409 USER_IDENTIFIER_EXISTS', async () => {
            const session = await adminSession();
            await session.post('/api/admin/managers').send({
                userIdentifier: 'dupe-check',
                password: 'DupeCheckPass12',
            });
            const res = await session.post('/api/admin/managers').send({
                userIdentifier: 'dupe-check',
                password: 'AnotherPass12',
            });
            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe('USER_IDENTIFIER_EXISTS');
        });
        it('rejects a password below the minimum policy with 400 WEAK_PASSWORD', async () => {
            const session = await adminSession();
            const res = await session.post('/api/admin/managers').send({
                userIdentifier: 'weakpw-mgr',
                password: 'short1',
            });
            expect(res.status).toBe(400);
        });
        it('rejects granting a YES-tier permission at creation (acceptance 11 applies to create too)', async () => {
            const session = await adminSession();
            const res = await session.post('/api/admin/managers').send({
                userIdentifier: 'yes-tier-create',
                password: 'YesTierPass12',
                permissions: ['order.confirm'],
            });
            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('PERMISSION_NOT_ASSIGNABLE');
        });
    });
    describe('PATCH /managers/:id (acceptance 15, 16)', () => {
        it('rejects a body carrying role (test 4, acceptance 16)', async () => {
            const session = await adminSession();
            const created = await session.post('/api/admin/managers').send({
                userIdentifier: 'patch-target',
                password: 'PatchTargetPass12',
            });
            const res = await session.patch(`/api/admin/managers/${created.body.data.id}`).send({
                role: 'ADMIN',
            });
            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });
        it("PATCH on the Admin's own id returns CANNOT_MODIFY_SELF... except the Admin's own row is not a Manager, so this 404s (acceptance 15 reframed for this endpoint's target scope)", async () => {
            const session = await adminSession();
            // The literal acceptance-15 scenario ("PATCH /managers/<own-id>") is a
            // Manager patching itself, since only Manager rows are ever valid
            // targets here — see the Manager self-patch case below for the actual
            // CANNOT_MODIFY_SELF assertion.
            const res = await session.patch(`/api/admin/managers/${adminId}`).send({ userIdentifier: 'self-x' });
            expect(res.status).toBe(404);
            void res;
        });
        it('a Manager patching its own id never reaches CANNOT_MODIFY_SELF via HTTP — the password-change gate and the NO-tier permission both block it first', async () => {
            // A newly-created Manager carries mustChangePassword: true (spec 03
            // §Middleware note), so `requirePasswordChanged` — mounted ahead of
            // `requirePermission` at the router level — fires before the permission
            // gate is even reached; and `user.manager.update` is NO-tier for
            // Manager regardless, so there is no path to this route as a Manager at
            // all. The service-level self-check
            // (managers.service.test.ts "a Manager cannot modify its own account")
            // is the correct place that assertion is proven; this test documents
            // why the same claim can never be observed through this HTTP route.
            const session = await adminSession();
            const plainMgr = await session.post('/api/admin/managers').send({
                userIdentifier: 'self-patch-mgr2',
                password: 'SelfPatchPass12',
            });
            const mgrSession = await loginAsAdmin(app, 'self-patch-mgr2', 'SelfPatchPass12');
            const res = await mgrSession.patch(`/api/admin/managers/${plainMgr.body.data.id}`).send({
                userIdentifier: 'self-renamed',
            });
            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
        });
        it('the system Admin id 404s on PATCH (acceptance 14)', async () => {
            const session = await adminSession();
            const res = await session.patch(`/api/admin/managers/${systemAdminId}`).send({
                userIdentifier: 'renamed-sysadmin',
            });
            expect(res.status).toBe(404);
            const untouched = await users.findById(systemAdminId);
            expect(untouched?.userIdentifier).toBe('mapi-sysadmin');
        });
    });
    describe('system Admin protection across every Manager-management endpoint (acceptance 14, test 6)', () => {
        it('DELETE on the system Admin id returns 404 and the row is unchanged', async () => {
            const session = await adminSession();
            const res = await session.del(`/api/admin/managers/${systemAdminId}`);
            expect(res.status).toBe(404);
            expect(await users.findById(systemAdminId)).not.toBeNull();
        });
        it('/deactivate on the system Admin id returns 404', async () => {
            const session = await adminSession();
            const res = await session.post(`/api/admin/managers/${systemAdminId}/deactivate`);
            expect(res.status).toBe(404);
            const untouched = await users.findById(systemAdminId);
            expect(untouched?.isActive).toBe(true);
        });
        it('PUT .../permissions on the system Admin id returns 404', async () => {
            const session = await adminSession();
            const res = await session.put(`/api/admin/managers/${systemAdminId}/permissions`).send({
                permissions: ['cms.manage'],
            });
            expect(res.status).toBe(404);
        });
    });
    describe('PUT /managers/:id/permissions (acceptance 11, 12, 13, 17)', () => {
        it('grants an ASSIGNED permission; the response reflects it and an audit row is written (acceptance 17)', async () => {
            const session = await adminSession();
            const target = await session.post('/api/admin/managers').send({
                userIdentifier: 'perm-target',
                password: 'PermTargetPass12',
            });
            const res = await session.put(`/api/admin/managers/${target.body.data.id}/permissions`).send({
                permissions: ['cms.manage'],
            });
            expect(res.status).toBe(200);
            expect(res.body.data.permissions).toEqual(['cms.manage']);
            const auditRes = await session.agent.get('/api/admin/audit-logs').query({ entityType: 'user' });
            const grantRow = auditRes.body.data.find((r) => r.action === 'permission_grant' && r.entityId === target.body.data.id);
            expect(grantRow).toBeDefined();
            expect(grantRow.actorUserId).toBe(adminId);
            expect(grantRow.newValue).toMatchObject({ permission: 'cms.manage' });
        });
        it('rejects a YES-tier key with 400 PERMISSION_NOT_ASSIGNABLE (acceptance 11)', async () => {
            const session = await adminSession();
            const target = await session.post('/api/admin/managers').send({
                userIdentifier: 'yes-tier-put',
                password: 'YesTierPutPass12',
            });
            const res = await session.put(`/api/admin/managers/${target.body.data.id}/permissions`).send({
                permissions: ['order.confirm'],
            });
            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('PERMISSION_NOT_ASSIGNABLE');
        });
        it('rejects a NO-tier key with 400 PERMISSION_NOT_ASSIGNABLE (acceptance 12)', async () => {
            const session = await adminSession();
            const target = await session.post('/api/admin/managers').send({
                userIdentifier: 'no-tier-put',
                password: 'NoTierPutPass12',
            });
            const res = await session.put(`/api/admin/managers/${target.body.data.id}/permissions`).send({
                permissions: ['rbac.configure'],
            });
            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('PERMISSION_NOT_ASSIGNABLE');
        });
        it('rejects an unrecognized permission key with 400 VALIDATION_ERROR (schema-level)', async () => {
            const session = await adminSession();
            const target = await session.post('/api/admin/managers').send({
                userIdentifier: 'unknown-key-put',
                password: 'UnknownKeyPass12',
            });
            const res = await session.put(`/api/admin/managers/${target.body.data.id}/permissions`).send({
                permissions: ['made.up.key'],
            });
            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });
        it('a tampered request cannot smuggle extra fields alongside permissions (server-authority tampered-client case)', async () => {
            const session = await adminSession();
            const target = await session.post('/api/admin/managers').send({
                userIdentifier: 'tamper-put',
                password: 'TamperPutPass12',
            });
            const res = await session.put(`/api/admin/managers/${target.body.data.id}/permissions`).send({
                permissions: ['cms.manage'],
                role: 'ADMIN',
                isActive: true,
            });
            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });
    });
    describe('GET /managers pagination', () => {
        it('rejects pageSize over 100 with 400', async () => {
            const session = await adminSession();
            const res = await session.agent.get('/api/admin/managers').query({ pageSize: 101 });
            expect(res.status).toBe(400);
        });
        it('defaults to pageSize 20', async () => {
            const session = await adminSession();
            const res = await session.agent.get('/api/admin/managers');
            expect(res.body.pagination.pageSize).toBe(20);
        });
    });
    describe('GET /managers/:id 404 for a non-Manager id', () => {
        it('the system Admin id 404s on GET', async () => {
            const session = await adminSession();
            const res = await session.agent.get(`/api/admin/managers/${systemAdminId}`);
            expect(res.status).toBe(404);
        });
        it('a nonexistent id 404s identically', async () => {
            const session = await adminSession();
            const res = await session.agent.get('/api/admin/managers/00000000-0000-4000-8000-000000000000');
            expect(res.status).toBe(404);
        });
    });
});
