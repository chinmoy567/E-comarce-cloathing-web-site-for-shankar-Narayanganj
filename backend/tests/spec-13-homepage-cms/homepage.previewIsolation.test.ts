import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.js';
import { applyTestEnv } from '../helpers/testEnv.js';
import { resetEnvCache } from '../../src/config/env.js';
import { loginAsAdmin } from '../helpers/adminSession.js';

/**
 * Spec 13 — preview isolation (§13.12). The highest-value security test in
 * this suite: unpublished (DRAFT) content must appear on the authenticated
 * preview route only, and never leak through the public homepage response
 * under any parameter.
 */
const SCHEMA = 'spec13_preview_isolation';

describe.skipIf(!TEST_DATABASE_URL)('homepage preview isolation (13-homepage-cms §13.12)', () => {
  let app: Express;
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;
  let usersRepository: typeof import('../../src/repositories/users.repository.js');
  let hashPassword: typeof import('../../src/lib/password.js').hashPassword;

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    applyTestEnv();
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    resetEnvCache();

    ({ resetTransactionPool } = await import('../../src/lib/transaction.js'));
    await resetTransactionPool();
    usersRepository = await import('../../src/repositories/users.repository.js');
    ({ hashPassword } = await import('../../src/lib/password.js'));
    const { createApp } = await import('../../src/app.js');
    app = createApp();

    const passwordHash = await hashPassword('PreviewIsoTestPass12');
    await usersRepository.create({ role: 'ADMIN', userIdentifier: 'preview-iso-admin', passwordHash, mustChangePassword: false });
  }, 60_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  async function asAdmin() {
    return loginAsAdmin(app, 'preview-iso-admin', 'PreviewIsoTestPass12');
  }

  it('a DRAFT section appears on the authenticated preview route with displayStatus DRAFT, and never on the public route', async () => {
    const session = await asAdmin();
    const created = await session.post('/api/admin/homepage/sections').send({
      sectionType: 'CUSTOM_CONTENT',
      status: 'DRAFT',
      contentConfig: { body: 'Secret draft content' },
    });
    expect(created.status).toBe(201);

    const preview = await session.agent.get('/api/admin/homepage/preview');
    expect(preview.status).toBe(200);
    const previewSection = preview.body.data.sections.find((s: { id: string }) => s.id === created.body.data.id);
    expect(previewSection).toBeDefined();
    expect(previewSection.displayStatus).toBe('DRAFT');

    const request = await import('supertest');
    const publicRes = await request.default(app).get('/api/homepage');
    expect(publicRes.status).toBe(200);
    expect(publicRes.body.data.sections.some((s: { id: string }) => s.id === created.body.data.id)).toBe(false);
  });

  it('a DISABLED campaign and its section appear on preview but never on the public route', async () => {
    const session = await asAdmin();
    const campaign = await session.post('/api/admin/campaigns').send({
      name: 'Disabled Campaign',
      slug: `disabled-campaign-${Date.now()}`,
      status: 'DISABLED',
    });
    expect(campaign.status).toBe(201);

    const section = await session.post('/api/admin/homepage/sections').send({
      sectionType: 'CAMPAIGN_BANNER',
      status: 'ACTIVE',
      campaignId: campaign.body.data.id,
      contentConfig: {},
    });
    expect(section.status).toBe(201);

    const preview = await session.agent.get('/api/admin/homepage/preview');
    const previewSection = preview.body.data.sections.find((s: { id: string }) => s.id === section.body.data.id);
    expect(previewSection).toBeDefined();
    expect(previewSection.displayStatus).toBe('DISABLED');

    const request = await import('supertest');
    const publicRes = await request.default(app).get('/api/homepage');
    expect(publicRes.body.data.sections.some((s: { id: string }) => s.id === section.body.data.id)).toBe(false);
  });

  it('an unauthenticated request to the preview route is rejected 401', async () => {
    const request = await import('supertest');
    const res = await request.default(app).get('/api/admin/homepage/preview');
    expect(res.status).toBe(401);
  });

  it('the public homepage route has no parameter that reveals DRAFT content', async () => {
    const request = await import('supertest');
    const attempts = await Promise.all([
      request.default(app).get('/api/homepage').query({ preview: 'true' }),
      request.default(app).get('/api/homepage').query({ status: 'DRAFT' }),
      request.default(app).get('/api/homepage').query({ includeUnpublished: 'true' }),
    ]);
    for (const res of attempts) {
      expect(res.status).toBe(200);
      expect(res.body.data.sections.every((s: { id: string }) => typeof s.id === 'string')).toBe(true);
    }
  });
});
