import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.js';
import { applyTestEnv } from '../helpers/testEnv.js';
import { resetEnvCache } from '../../src/config/env.js';
import { loginAsAdmin } from '../helpers/adminSession.js';

/** Spec 13 — cms.manage RBAC gate on every mutating + preview endpoint (§13.14, §5.18). */
const SCHEMA = 'spec13_permissions';

describe.skipIf(!TEST_DATABASE_URL)('cms.manage permission enforcement (13-homepage-cms §13.14)', () => {
  let app: Express;
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;
  let usersRepository: typeof import('../../src/repositories/users.repository.js');
  let permissionsRepository: typeof import('../../src/repositories/permissions.repository.js');
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
    usersRepository = await import('../../src/repositories/users.repository.js');
    permissionsRepository = await import('../../src/repositories/permissions.repository.js');
    ({ hashPassword } = await import('../../src/lib/password.js'));
    const { createApp } = await import('../../src/app.js');
    app = createApp();

    const passwordHash = await hashPassword('CmsPermTestPass12');
    adminId = (await usersRepository.create({ role: 'ADMIN', userIdentifier: 'cms-perm-admin', passwordHash, mustChangePassword: false })).id;
    managerId = (
      await usersRepository.create({ role: 'MANAGER', userIdentifier: 'cms-perm-manager', passwordHash, mustChangePassword: false })
    ).id;
  }, 60_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  async function asManager() {
    return loginAsAdmin(app, 'cms-perm-manager', 'CmsPermTestPass12');
  }
  async function asAdmin() {
    return loginAsAdmin(app, 'cms-perm-admin', 'CmsPermTestPass12');
  }

  function sectionBody() {
    return { sectionType: 'CUSTOM_CONTENT', contentConfig: { body: 'x' } };
  }

  it('cms.manage is a known permission key present in the catalogue', async () => {
    const catalogue = await permissionsRepository.listAll();
    expect(catalogue.some((entry) => entry.key === 'cms.manage')).toBe(true);
  });

  it('a Manager without cms.manage gets 403 on section create, campaign create, reorder, and preview', async () => {
    const session = await asManager();

    const createSection = await session.post('/api/admin/homepage/sections').send(sectionBody());
    expect(createSection.status).toBe(403);
    expect(createSection.body.error.code).toBe('FORBIDDEN');

    const createCampaign = await session.post('/api/admin/campaigns').send({ name: 'X', slug: `x-${Date.now()}` });
    expect(createCampaign.status).toBe(403);

    const reorder = await session.post('/api/admin/homepage/sections/reorder').send({ sectionIds: [] });
    expect(reorder.status).toBe(403);

    const preview = await session.agent.get('/api/admin/homepage/preview');
    expect(preview.status).toBe(403);
  });

  it('granting cms.manage to the Manager flips access on every mutating and preview endpoint', async () => {
    await permissionsRepository.grant(managerId, 'cms.manage', adminId);
    try {
      const session = await asManager();

      const createSection = await session.post('/api/admin/homepage/sections').send(sectionBody());
      expect(createSection.status).toBe(201);

      const updateSection = await session.patch(`/api/admin/homepage/sections/${createSection.body.data.id}`).send({ title: 'Renamed' });
      expect(updateSection.status).toBe(200);

      const reorder = await session.post('/api/admin/homepage/sections/reorder').send({ sectionIds: [createSection.body.data.id] });
      expect(reorder.status).toBe(200);

      const preview = await session.agent.get('/api/admin/homepage/preview');
      expect(preview.status).toBe(200);

      const del = await session.del(`/api/admin/homepage/sections/${createSection.body.data.id}`);
      expect(del.status).toBe(200);
    } finally {
      await permissionsRepository.revoke(managerId, 'cms.manage');
    }
  });

  it('an Admin (Yes tier) can always access every endpoint', async () => {
    const session = await asAdmin();
    const created = await session.post('/api/admin/homepage/sections').send(sectionBody());
    expect(created.status).toBe(201);
    const preview = await session.agent.get('/api/admin/homepage/preview');
    expect(preview.status).toBe(200);
  });
});
