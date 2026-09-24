import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.ts';
import { applyTestEnv } from '../helpers/testEnv.ts';
import { resetEnvCache } from '../../src/config/env.ts';
/**
 * Spec 03 — `requireAuth` middleware in isolation (§Middleware, error table).
 *
 * Exercised through `GET /api/admin/auth/me`, the simplest route behind
 * `requireAuth('admin')` alone (no `requirePermission`, no
 * `requirePasswordChanged`), so each failure mode is attributable to
 * `requireAuth` specifically.
 */
const SCHEMA = 'spec03_requireauth';
describe.skipIf(!TEST_DATABASE_URL)('requireAuth middleware', () => {
    let app;
    let resetTransactionPool;
    let users;
    let hashPassword;
    let signAccessToken;
    let activeAdminId;
    let inactiveAdminId;
    beforeAll(async () => {
        await resetSchema(SCHEMA);
        applyTestEnv();
        process.env.DATABASE_URL = scopedUrl(SCHEMA);
        resetEnvCache();
        ({ resetTransactionPool } = await import('../../src/lib/transaction.js'));
        await resetTransactionPool();
        users = await import('../../src/repositories/users.repository.js');
        ({ hashPassword } = await import('../../src/lib/password.js'));
        ({ signAccessToken } = await import('../../src/lib/session.js'));
        const { createApp } = await import('../../src/app.js');
        app = createApp();
        const passwordHash = await hashPassword('RequireAuthPass12');
        activeAdminId = (await users.create({ role: 'ADMIN', userIdentifier: 'ra-active', passwordHash, mustChangePassword: false })).id;
        const inactive = await users.create({
            role: 'ADMIN',
            userIdentifier: 'ra-inactive',
            passwordHash,
            mustChangePassword: false,
        });
        inactiveAdminId = inactive.id;
        await users.update(inactiveAdminId, { isActive: false });
    }, 60_000);
    afterAll(async () => {
        await resetTransactionPool?.();
        await dropSchema(SCHEMA);
    });
    it('rejects with 401 when no admin_at cookie is present', async () => {
        const res = await request(app).get('/api/admin/auth/me');
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
    it('rejects with 401 for a malformed token', async () => {
        const res = await request(app).get('/api/admin/auth/me').set('Cookie', 'admin_at=not-a-jwt');
        expect(res.status).toBe(401);
    });
    it('rejects with 401 for a token signed with the wrong secret', async () => {
        // Hand-signed with a different key — verifyAccessToken must reject the signature.
        const jwt = (await import('jsonwebtoken')).default;
        const bogus = jwt.sign({ sub: activeAdminId, scope: 'admin', role: 'ADMIN' }, 'a-completely-different-secret', {
            expiresIn: '15m',
        });
        const res = await request(app).get('/api/admin/auth/me').set('Cookie', `admin_at=${bogus}`);
        expect(res.status).toBe(401);
    });
    it('rejects with 401 for an expired token', async () => {
        const jwt = (await import('jsonwebtoken')).default;
        const { getEnv } = await import('../../src/config/env.js');
        const expired = jwt.sign({ sub: activeAdminId, scope: 'admin', role: 'ADMIN' }, getEnv().JWT_ACCESS_SECRET, { expiresIn: '-1s' });
        const res = await request(app).get('/api/admin/auth/me').set('Cookie', `admin_at=${expired}`);
        expect(res.status).toBe(401);
    });
    it('rejects a customer-scope token with 401 (test 11)', async () => {
        const token = signAccessToken({ sub: activeAdminId, scope: 'customer', role: 'ADMIN' });
        const res = await request(app).get('/api/admin/auth/me').set('Cookie', `admin_at=${token}`);
        expect(res.status).toBe(401);
    });
    it('rejects a token for a deactivated user with 401', async () => {
        const token = signAccessToken({ sub: inactiveAdminId, scope: 'admin', role: 'ADMIN' });
        const res = await request(app).get('/api/admin/auth/me').set('Cookie', `admin_at=${token}`);
        expect(res.status).toBe(401);
    });
    it('rejects a token for a deleted user id with 401', async () => {
        const token = signAccessToken({ sub: '00000000-0000-4000-8000-000000000000', scope: 'admin', role: 'ADMIN' });
        const res = await request(app).get('/api/admin/auth/me').set('Cookie', `admin_at=${token}`);
        expect(res.status).toBe(401);
    });
    it('accepts a valid admin-scope token for an active user', async () => {
        const token = signAccessToken({ sub: activeAdminId, scope: 'admin', role: 'ADMIN' });
        const res = await request(app).get('/api/admin/auth/me').set('Cookie', `admin_at=${token}`);
        expect(res.status).toBe(200);
        expect(res.body.data.id).toBe(activeAdminId);
    });
    it('re-resolves permissions per request rather than trusting the token (§11.7)', async () => {
        const managerHash = await hashPassword('RequireAuthPass12');
        const manager = await users.create({
            role: 'MANAGER',
            userIdentifier: 'ra-live-grant',
            passwordHash: managerHash,
            mustChangePassword: false,
        });
        const token = signAccessToken({ sub: manager.id, scope: 'admin', role: 'MANAGER' });
        const before = await request(app).get('/api/admin/auth/me').set('Cookie', `admin_at=${token}`);
        expect(before.body.data.permissions).not.toContain('cms.manage');
        const permissionsRepo = await import('../../src/repositories/permissions.repository.js');
        await permissionsRepo.grant(manager.id, 'cms.manage', activeAdminId);
        const after = await request(app).get('/api/admin/auth/me').set('Cookie', `admin_at=${token}`);
        expect(after.body.data.permissions).toContain('cms.manage');
    });
});
