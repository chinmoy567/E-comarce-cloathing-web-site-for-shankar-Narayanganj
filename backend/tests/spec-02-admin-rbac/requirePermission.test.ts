import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from './helpers/schemaFixture.js';
import { applyTestEnv } from './helpers/testEnv.js';
import { resetEnvCache } from '../src/config/env.js';
import { loginAsAdmin } from './helpers/adminSession.js';

/**
 * Spec 03 — `requirePermission` middleware in isolation (§Middleware, error
 * table row "Authenticated but lacking the permission").
 *
 * Exercised through `GET /api/admin/managers`, gated on `user.manager.create`
 * (spec 03 open question 3) — the simplest ASSIGNED-vs-YES/NO example. A
 * denial must be denied for the right reason (`FORBIDDEN`, not
 * `PASSWORD_CHANGE_REQUIRED` or `CSRF_FAILED`).
 */
const SCHEMA = 'spec03_requireperm';

describe.skipIf(!TEST_DATABASE_URL)('requirePermission middleware', () => {
  let app: Express;
  let resetTransactionPool: typeof import('../src/lib/transaction.js').resetTransactionPool;
  let users: typeof import('../src/repositories/users.repository.js');
  let permissionsRepo: typeof import('../src/repositories/permissions.repository.js');
  let hashPassword: typeof import('../src/lib/password.js').hashPassword;

  let adminId: string;
  let managerId: string;

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    applyTestEnv();
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    resetEnvCache();

    ({ resetTransactionPool } = await import('../src/lib/transaction.js'));
    await resetTransactionPool();
    users = await import('../src/repositories/users.repository.js');
    permissionsRepo = await import('../src/repositories/permissions.repository.js');
    ({ hashPassword } = await import('../src/lib/password.js'));
    const { createApp } = await import('../src/app.js');
    app = createApp();

    const passwordHash = await hashPassword('RequirePermPass12');
    adminId = (
      await users.create({ role: 'ADMIN', userIdentifier: 'rp-admin', passwordHash, mustChangePassword: false })
    ).id;
    managerId = (
      await users.create({
        role: 'MANAGER',
        userIdentifier: 'rp-manager',
        passwordHash,
        mustChangePassword: false,
      })
    ).id;
  }, 60_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  it('Admin (YES) passes the gate', async () => {
    const session = await loginAsAdmin(app, 'rp-admin', 'RequirePermPass12');
    const res = await session.agent.get('/api/admin/managers');
    expect(res.status).toBe(200);
  });

  it('Manager without the grant (this key is NO for Manager) gets 403 FORBIDDEN', async () => {
    const session = await loginAsAdmin(app, 'rp-manager', 'RequirePermPass12');
    const res = await session.agent.get('/api/admin/managers');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects a route wired without requireAuth ahead of it with 500 InternalError (route-wiring guard)', async () => {
    // requirePermission on its own, unreachable without requireAuth having
    // populated req.actor — this proves the middleware's own defensive check
    // rather than assuming route wiring is always correct.
    const { default: express } = await import('express');
    const { requirePermission } = await import('../src/middleware/requirePermission.js');
    const { errorHandler } = await import('../src/middleware/errorHandler.js');
    const { requestId } = await import('../src/middleware/requestId.js');

    const probe = express();
    probe.use(requestId);
    probe.get('/probe', requirePermission('dashboard.view'), (_req, res) => res.json({ data: 'ok' }));
    probe.use(errorHandler);

    const res = await request(probe).get('/probe');
    expect(res.status).toBe(500);
  });
});
