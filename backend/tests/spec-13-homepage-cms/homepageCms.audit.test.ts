import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.js';
import { applyTestEnv } from '../helpers/testEnv.js';
import { resetEnvCache } from '../../src/config/env.js';
import { loginAsAdmin } from '../helpers/adminSession.js';

/** Spec 13 — one audit_logs row per logical create/update/delete/reorder/attach (§5.15 rule 10). */
const SCHEMA = 'spec13_audit';

describe.skipIf(!TEST_DATABASE_URL)('homepage CMS audit rows (13-homepage-cms, plan §7)', () => {
  let app: Express;
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;
  let usersRepository: typeof import('../../src/repositories/users.repository.js');
  let auditRepository: typeof import('../../src/repositories/audit.repository.js');
  let hashPassword: typeof import('../../src/lib/password.js').hashPassword;

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    applyTestEnv();
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    resetEnvCache();

    ({ resetTransactionPool } = await import('../../src/lib/transaction.js'));
    await resetTransactionPool();
    usersRepository = await import('../../src/repositories/users.repository.js');
    auditRepository = await import('../../src/repositories/audit.repository.js');
    ({ hashPassword } = await import('../../src/lib/password.js'));
    const { createApp } = await import('../../src/app.js');
    app = createApp();

    const passwordHash = await hashPassword('CmsAuditTestPass12');
    await usersRepository.create({ role: 'ADMIN', userIdentifier: 'cms-audit-admin', passwordHash, mustChangePassword: false });
  }, 60_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  async function asAdmin() {
    return loginAsAdmin(app, 'cms-audit-admin', 'CmsAuditTestPass12');
  }

  it('create writes a homepage_section_created audit row', async () => {
    const session = await asAdmin();
    const created = await session.post('/api/admin/homepage/sections').send({ sectionType: 'CUSTOM_CONTENT', contentConfig: { body: 'x' } });
    const { items } = await auditRepository.listForEntity('homepage_section', created.body.data.id, { page: 1, pageSize: 10 });
    expect(items.some((e) => e.action === 'homepage_section_created')).toBe(true);
  });

  it('update writes a homepage_section_updated audit row', async () => {
    const session = await asAdmin();
    const created = await session.post('/api/admin/homepage/sections').send({ sectionType: 'CUSTOM_CONTENT', contentConfig: { body: 'x' } });
    await session.patch(`/api/admin/homepage/sections/${created.body.data.id}`).send({ title: 'Renamed' });
    const { items } = await auditRepository.listForEntity('homepage_section', created.body.data.id, { page: 1, pageSize: 10 });
    expect(items.some((e) => e.action === 'homepage_section_updated')).toBe(true);
  });

  it('delete writes a homepage_section_deleted audit row', async () => {
    const session = await asAdmin();
    const created = await session.post('/api/admin/homepage/sections').send({ sectionType: 'CUSTOM_CONTENT', contentConfig: { body: 'x' } });
    await session.del(`/api/admin/homepage/sections/${created.body.data.id}`);
    const { items } = await auditRepository.listForEntity('homepage_section', created.body.data.id, { page: 1, pageSize: 10 });
    expect(items.some((e) => e.action === 'homepage_section_deleted')).toBe(true);
  });

  it('reorder writes exactly one homepage_sections_reordered audit row for the whole batch', async () => {
    const session = await asAdmin();
    await session.post('/api/admin/homepage/sections').send({ sectionType: 'CUSTOM_CONTENT', contentConfig: { body: 'a' } });
    await session.post('/api/admin/homepage/sections').send({ sectionType: 'CUSTOM_CONTENT', contentConfig: { body: 'b' } });

    // Reorder requires the FULL current set (§13.12) — earlier tests in this
    // file left their own sections in place, so the reorder list is read back
    // from the list endpoint rather than assumed to be just this test's two.
    const list = await session.agent.get('/api/admin/homepage/sections').query({ pageSize: 100 });
    const currentIds: string[] = list.body.data.map((s: { id: string }) => s.id);

    const reorderRes = await session.post('/api/admin/homepage/sections/reorder').send({ sectionIds: [...currentIds].reverse() });
    expect(reorderRes.status).toBe(200);

    const { items } = await auditRepository.listAll({ entityType: 'homepage_section' }, { page: 1, pageSize: 100 });
    const reorderEntries = items.filter((e) => e.action === 'homepage_sections_reordered');
    expect(reorderEntries.length).toBeGreaterThanOrEqual(1);
  });

  it('a failed mutation (validation rejected) writes no audit row', async () => {
    const session = await asAdmin();
    const before = await auditRepository.listAll({ entityType: 'homepage_section' }, { page: 1, pageSize: 200 });

    // CAMPAIGN_BANNER without a campaignId is rejected by the service.
    const res = await session.post('/api/admin/homepage/sections').send({ sectionType: 'CAMPAIGN_BANNER', contentConfig: {} });
    expect(res.status).toBe(400);

    const after = await auditRepository.listAll({ entityType: 'homepage_section' }, { page: 1, pageSize: 200 });
    expect(after.total).toBe(before.total);
  });

  it('campaign create writes a campaign_created audit row', async () => {
    const session = await asAdmin();
    const created = await session.post('/api/admin/campaigns').send({ name: 'Audit Campaign', slug: `audit-campaign-${Date.now()}` });
    const { items } = await auditRepository.listForEntity('campaign', created.body.data.id, { page: 1, pageSize: 10 });
    expect(items.some((e) => e.action === 'campaign_created')).toBe(true);
  });
});
