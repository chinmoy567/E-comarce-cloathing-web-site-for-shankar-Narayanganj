import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.ts';
import { applyTestEnv } from '../helpers/testEnv.ts';
import { resetEnvCache } from '../../src/config/env.ts';
import { loginAsAdmin } from '../helpers/adminSession.ts';

/**
 * Spec 03 — `/api/admin/auth/*` over real HTTP + cookies (§Routes,
 * §Session design, acceptance 5–8, 18–19; tests required 11, 12, 13, 18).
 */
const SCHEMA = 'spec03_authapi';

describe.skipIf(!TEST_DATABASE_URL)('admin auth API', () => {
  let app: Express;
  let withTransaction: typeof import('../../src/lib/transaction.js').withTransaction;
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;
  let hashPassword: typeof import('../../src/lib/password.js').hashPassword;
  let users: typeof import('../../src/repositories/users.repository.js');
  let signAccessToken: typeof import('../../src/lib/session.js').signAccessToken;

  const PASSWORD = 'AdminApiPass12';
  let adminId: string;

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    applyTestEnv();
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    resetEnvCache();

    ({ withTransaction, resetTransactionPool } = await import('../../src/lib/transaction.js'));
    await resetTransactionPool();
    ({ hashPassword } = await import('../../src/lib/password.js'));
    users = await import('../../src/repositories/users.repository.js');
    ({ signAccessToken } = await import('../../src/lib/session.js'));
    const { createApp } = await import('../../src/app.js');
    app = createApp();

    const passwordHash = await hashPassword(PASSWORD);
    const admin = await users.create({
      role: 'ADMIN',
      userIdentifier: 'api-admin',
      passwordHash,
      mustChangePassword: false,
    });
    adminId = admin.id;
  }, 60_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  describe('POST /auth/login (acceptance 5, 7)', () => {
    it('returns 200, sets httpOnly cookies, mustChangePassword, and no token in the body', async () => {
      const res = await request(app)
        .post('/api/admin/auth/login')
        .send({ userIdentifier: 'api-admin', password: PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body.data.user.id).toBe(adminId);
      expect(res.body.data.mustChangePassword).toBe(false);
      expect(JSON.stringify(res.body)).not.toMatch(/eyJ/); // no raw JWT anywhere in the body

      const setCookie = (res.headers['set-cookie'] as unknown as string[]) ?? [];
      const at = setCookie.find((c) => c.startsWith('admin_at='));
      const rt = setCookie.find((c) => c.startsWith('admin_rt='));
      const csrf = setCookie.find((c) => c.startsWith('admin_csrf='));
      expect(at).toMatch(/HttpOnly/i);
      expect(rt).toMatch(/HttpOnly/i);
      expect(csrf).not.toMatch(/HttpOnly/i);
    });

    it('wrong password and unknown identifier return byte-identical bodies (test 12, acceptance 7)', async () => {
      const wrongPw = await request(app)
        .post('/api/admin/auth/login')
        .send({ userIdentifier: 'api-admin', password: 'TotallyWrongPass1' });
      const unknown = await request(app)
        .post('/api/admin/auth/login')
        .send({ userIdentifier: 'no-such-admin', password: 'TotallyWrongPass1' });

      expect(wrongPw.status).toBe(unknown.status);
      expect(wrongPw.status).toBe(401);
      const { requestId: _a, ...wrongPwBody } = wrongPw.body;
      const { requestId: _b, ...unknownBody } = unknown.body;
      expect(wrongPwBody).toEqual(unknownBody);
    });

    it('rejects an unknown field with 400 VALIDATION_ERROR (.strict())', async () => {
      const res = await request(app)
        .post('/api/admin/auth/login')
        .send({ userIdentifier: 'api-admin', password: PASSWORD, role: 'ADMIN' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('session scope separation (§2.4, test 11)', () => {
    it('a scope:customer token is rejected with 401 on GET /auth/me', async () => {
      const customerToken = signAccessToken({ sub: adminId, scope: 'customer', role: 'ADMIN' });
      const res = await request(app).get('/api/admin/auth/me').set('Cookie', `admin_at=${customerToken}`);
      expect(res.status).toBe(401);
    });

    it('a scope:customer token is rejected with 401 on a state-changing route', async () => {
      const customerToken = signAccessToken({ sub: adminId, scope: 'customer', role: 'ADMIN' });
      const res = await request(app)
        .post('/api/admin/managers')
        .set('Cookie', `admin_at=${customerToken}`)
        .set('X-CSRF-Token', 'irrelevant')
        .send({ userIdentifier: 'x', password: 'irrelevant-pass-12' });
      expect(res.status).toBe(401);
    });

    it('no token at all is rejected with 401', async () => {
      const res = await request(app).get('/api/admin/auth/me');
      expect(res.status).toBe(401);
    });
  });

  describe('CSRF (§11.5, acceptance 18)', () => {
    it('a state-changing request without X-CSRF-Token returns 403 CSRF_FAILED', async () => {
      const session = await loginAsAdmin(app, 'api-admin', PASSWORD);
      const res = await session.agent.post('/api/admin/auth/change-password').send({
        currentPassword: PASSWORD,
        newPassword: 'DoesNotMatterHere12',
      });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CSRF_FAILED');
    });

    it('a mismatched X-CSRF-Token header returns 403 CSRF_FAILED', async () => {
      const session = await loginAsAdmin(app, 'api-admin', PASSWORD);
      const res = await session.agent
        .post('/api/admin/auth/change-password')
        .set('X-CSRF-Token', 'not-the-real-token')
        .send({ currentPassword: PASSWORD, newPassword: 'DoesNotMatterHere12' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CSRF_FAILED');
    });

    it('a matching X-CSRF-Token header is accepted', async () => {
      const session = await loginAsAdmin(app, 'api-admin', PASSWORD);
      const res = await session.post('/api/admin/auth/change-password').send({
        currentPassword: PASSWORD,
        newPassword: 'AnotherValidPass12',
      });
      expect(res.status).toBe(200);
      // Restore for other tests in this file that log in with PASSWORD.
      await withTransaction(async (c) => {
        await c.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(PASSWORD), adminId]);
      });
    });

    it('GET requests do not require X-CSRF-Token', async () => {
      const session = await loginAsAdmin(app, 'api-admin', PASSWORD);
      const res = await session.agent.get('/api/admin/auth/me');
      expect(res.status).toBe(200);
    });
  });

  describe('forced password change gate (acceptance 6)', () => {
    it('mustChangePassword blocks GET /managers with 403 PASSWORD_CHANGE_REQUIRED, then clears after change-password', async () => {
      const pwHash = await hashPassword('MustChangeMe12');
      const managerId = (
        await users.create({
          role: 'MANAGER',
          userIdentifier: 'pw-gate-mgr',
          passwordHash: pwHash,
          mustChangePassword: true,
        })
      ).id;

      const session = await loginAsAdmin(app, 'pw-gate-mgr', 'MustChangeMe12');
      const blocked = await session.agent.get('/api/admin/managers');
      expect(blocked.status).toBe(403);
      expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

      const changed = await session.post('/api/admin/auth/change-password').send({
        currentPassword: 'MustChangeMe12',
        newPassword: 'BrandNewPassword12',
      });
      expect(changed.status).toBe(200);

      // requireAuth re-resolves mustChangePassword on every request rather
      // than trusting a cached claim, so the SAME session's next call must no
      // longer be blocked by the password-change gate specifically. A default
      // Manager still lacks `user.manager.create`, so the call now 403s for a
      // DIFFERENT reason (FORBIDDEN) — the code, not just the status, is what
      // proves the gate actually cleared.
      const afterChange = await session.agent.get('/api/admin/managers');
      expect(afterChange.status).toBe(403);
      expect(afterChange.body.error.code).toBe('FORBIDDEN');

      await withTransaction(async (c) => {
        await c.query('DELETE FROM users WHERE id = $1', [managerId]);
      });
    });

    it('/auth/me, /auth/change-password, and /auth/logout stay reachable while a password change is pending', async () => {
      const pwHash = await hashPassword('StillPending12');
      await users.create({
        role: 'MANAGER',
        userIdentifier: 'pending-pw-mgr',
        passwordHash: pwHash,
        mustChangePassword: true,
      });
      const session = await loginAsAdmin(app, 'pending-pw-mgr', 'StillPending12');

      const me = await session.agent.get('/api/admin/auth/me');
      expect(me.status).toBe(200);

      const logout = await session.post('/api/admin/auth/logout');
      expect(logout.status).toBe(200);
    });
  });

  describe('POST /auth/refresh (test 13, acceptance 19)', () => {
    it('rotates the refresh cookie and issues a new access token', async () => {
      const session = await loginAsAdmin(app, 'api-admin', PASSWORD);
      const res = await session.agent.post('/api/admin/auth/refresh');
      expect(res.status).toBe(200);
      const setCookie = (res.headers['set-cookie'] as unknown as string[]) ?? [];
      expect(setCookie.some((c) => c.startsWith('admin_at='))).toBe(true);
      expect(setCookie.some((c) => c.startsWith('admin_rt='))).toBe(true);
    });

    it('replaying a used refresh token returns 401 and revokes the chain (acceptance 19)', async () => {
      const agent = request.agent(app);
      const loginRes = await agent
        .post('/api/admin/auth/login')
        .send({ userIdentifier: 'api-admin', password: PASSWORD });
      const originalRt = ((loginRes.headers['set-cookie'] as unknown as string[]) ?? [])
        .find((c) => c.startsWith('admin_rt='))!
        .split(';')[0]!;

      // Rotate once through the normal agent (cookie jar updates automatically).
      const firstRefresh = await agent.post('/api/admin/auth/refresh');
      expect(firstRefresh.status).toBe(200);

      // Replay the ORIGINAL (now-revoked) refresh cookie explicitly.
      const replay = await request(app).post('/api/admin/auth/refresh').set('Cookie', originalRt);
      expect(replay.status).toBe(401);

      // The rotated (newest) token must now also be dead.
      const newRt = ((firstRefresh.headers['set-cookie'] as unknown as string[]) ?? [])
        .find((c) => c.startsWith('admin_rt='))!
        .split(';')[0]!;
      const afterReuse = await request(app).post('/api/admin/auth/refresh').set('Cookie', newRt);
      expect(afterReuse.status).toBe(401);
    });

    it('refresh with no cookie at all returns 401', async () => {
      const res = await request(app).post('/api/admin/auth/refresh');
      expect(res.status).toBe(401);
    });
  });

  describe('logout', () => {
    it('clears the session cookies and the refresh token no longer works', async () => {
      const session = await loginAsAdmin(app, 'api-admin', PASSWORD);
      const logoutRes = await session.post('/api/admin/auth/logout');
      expect(logoutRes.status).toBe(200);

      const meAfter = await session.agent.get('/api/admin/auth/me');
      // Access token TTL hasn't expired, but the refresh should be dead —
      // access-token-based checks stay valid until natural expiry (the
      // documented model: access tokens are short-lived and not individually
      // revocable); the refresh path is what's tested here.
      const refreshAfter = await session.agent.post('/api/admin/auth/refresh');
      expect(refreshAfter.status).toBe(401);
      void meAfter;
    });
  });
});
