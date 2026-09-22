import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from './helpers/schemaFixture.js';
import { applyTestEnv } from './helpers/testEnv.js';
import { resetEnvCache } from '../src/config/env.js';
import { loginAsAdmin } from './helpers/adminSession.js';

/**
 * Spec 03 — `GET /api/admin/audit-logs` (§Routes, acceptance 17, test 9).
 * `audit.view` is ASSIGNED for Manager.
 */
const SCHEMA = 'spec03_auditapi';

describe.skipIf(!TEST_DATABASE_URL)('audit logs API', () => {
  let app: Express;
  let resetTransactionPool: typeof import('../src/lib/transaction.js').resetTransactionPool;
  let users: typeof import('../src/repositories/users.repository.js');
  let permissionsRepo: typeof import('../src/repositories/permissions.repository.js');
  let hashPassword: typeof import('../src/lib/password.js').hashPassword;

  let adminId: string;

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

    const passwordHash = await hashPassword('AuditApiPass12');
    adminId = (
      await users.create({ role: 'ADMIN', userIdentifier: 'audit-admin', passwordHash, mustChangePassword: false })
    ).id;
  }, 60_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  it('Admin (YES) can list audit logs', async () => {
    const session = await loginAsAdmin(app, 'audit-admin', 'AuditApiPass12');
    const res = await session.agent.get('/api/admin/audit-logs');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('an ungranted Manager (ASSIGNED, ungranted) gets 403 FORBIDDEN', async () => {
    const session = await loginAsAdmin(app, 'audit-admin', 'AuditApiPass12');
    const passwordHash = await hashPassword('AuditMgrPass12');
    const mgr = await users.create({
      role: 'MANAGER',
      userIdentifier: 'audit-mgr-plain',
      passwordHash,
      mustChangePassword: false,
    });
    const mgrSession = await loginAsAdmin(app, 'audit-mgr-plain', 'AuditMgrPass12');
    const res = await mgrSession.agent.get('/api/admin/audit-logs');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    void session;
  });

  it('a Manager granted audit.view can list audit logs', async () => {
    const passwordHash = await hashPassword('AuditMgrGrantedPass12');
    const mgr = await users.create({
      role: 'MANAGER',
      userIdentifier: 'audit-mgr-granted',
      passwordHash,
      mustChangePassword: false,
    });
    await permissionsRepo.grant(mgr.id, 'audit.view', adminId);

    const mgrSession = await loginAsAdmin(app, 'audit-mgr-granted', 'AuditMgrGrantedPass12');
    const res = await mgrSession.agent.get('/api/admin/audit-logs');
    expect(res.status).toBe(200);
  });

  it('shows a matching row after a manager_created action, with actor, action, and timestamp (acceptance 17)', async () => {
    const session = await loginAsAdmin(app, 'audit-admin', 'AuditApiPass12');
    const created = await session.post('/api/admin/managers').send({
      userIdentifier: 'audit-trace-target',
      password: 'AuditTraceTargetPass12',
    });

    const res = await session.agent.get('/api/admin/audit-logs').query({ entityType: 'user' });
    const row = res.body.data.find(
      (r: { entityId: string; action: string }) => r.entityId === created.body.data.id && r.action === 'manager_created',
    );
    expect(row).toBeDefined();
    expect(row.actorUserId).toBe(adminId);
    expect(row.actorType).toBe('USER');
    expect(typeof row.createdAt).toBe('string');
  });

  it('filters by entityType', async () => {
    const session = await loginAsAdmin(app, 'audit-admin', 'AuditApiPass12');
    const res = await session.agent.get('/api/admin/audit-logs').query({ entityType: 'user' });
    expect(res.status).toBe(200);
    expect(res.body.data.every((r: { entityType: string }) => r.entityType === 'user')).toBe(true);
  });

  it('rejects pageSize over 100 with 400', async () => {
    const session = await loginAsAdmin(app, 'audit-admin', 'AuditApiPass12');
    const res = await session.agent.get('/api/admin/audit-logs').query({ pageSize: 500 });
    expect(res.status).toBe(400);
  });

  it('an unauthenticated request is rejected with 401', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/admin/audit-logs');
    expect(res.status).toBe(401);
  });
});
