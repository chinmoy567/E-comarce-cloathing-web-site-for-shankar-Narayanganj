import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.js';
import { applyTestEnv } from '../helpers/testEnv.js';
import { resetEnvCache } from '../../src/config/env.js';
import { loginAsAdmin } from '../helpers/adminSession.js';

/** Spec 13 — a section is hidden when its linked campaign is not visible, in each non-visible campaign state (§13.4, §13.7a). */
const SCHEMA = 'spec13_campaign_interaction';

describe.skipIf(!TEST_DATABASE_URL)('section visibility depends on its campaign (13-homepage-cms §13.4)', () => {
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

    const passwordHash = await hashPassword('CampaignInteractionPass12');
    await usersRepository.create({ role: 'ADMIN', userIdentifier: 'campaign-interaction-admin', passwordHash, mustChangePassword: false });
  }, 60_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  async function asAdmin() {
    return loginAsAdmin(app, 'campaign-interaction-admin', 'CampaignInteractionPass12');
  }

  async function createCampaignAndSection(campaignOverrides: Record<string, unknown>) {
    const session = await asAdmin();
    const campaign = await session.post('/api/admin/campaigns').send({
      name: 'Interaction Campaign',
      slug: `interaction-campaign-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      status: 'ACTIVE',
      ...campaignOverrides,
    });
    expect(campaign.status).toBe(201);

    const section = await session.post('/api/admin/homepage/sections').send({
      sectionType: 'CAMPAIGN_BANNER',
      status: 'ACTIVE',
      campaignId: campaign.body.data.id,
      contentConfig: {},
    });
    expect(section.status).toBe(201);

    return { campaignId: campaign.body.data.id, sectionId: section.body.data.id };
  }

  it('a section is hidden when its campaign is DISABLED, even with its own window open', async () => {
    const { sectionId } = await createCampaignAndSection({ status: 'DISABLED' });
    const request = await import('supertest');
    const res = await request.default(app).get('/api/homepage');
    expect(res.body.data.sections.some((s: { id: string }) => s.id === sectionId)).toBe(false);
  });

  it('a section is hidden when its campaign is SCHEDULED (future startsAt)', async () => {
    const { sectionId } = await createCampaignAndSection({ startsAt: '2099-01-01T00:00:00.000Z' });
    const request = await import('supertest');
    const res = await request.default(app).get('/api/homepage');
    expect(res.body.data.sections.some((s: { id: string }) => s.id === sectionId)).toBe(false);
  });

  it('a section is hidden when its campaign is EXPIRED (past endsAt)', async () => {
    const { sectionId } = await createCampaignAndSection({
      startsAt: '2020-01-01T00:00:00.000Z',
      endsAt: '2020-02-01T00:00:00.000Z',
    });
    const request = await import('supertest');
    const res = await request.default(app).get('/api/homepage');
    expect(res.body.data.sections.some((s: { id: string }) => s.id === sectionId)).toBe(false);
  });

  it('a section is visible when its campaign is ACTIVE and in-window (or unscheduled)', async () => {
    const { sectionId } = await createCampaignAndSection({});
    const request = await import('supertest');
    const res = await request.default(app).get('/api/homepage');
    expect(res.body.data.sections.some((s: { id: string }) => s.id === sectionId)).toBe(true);
  });
});
