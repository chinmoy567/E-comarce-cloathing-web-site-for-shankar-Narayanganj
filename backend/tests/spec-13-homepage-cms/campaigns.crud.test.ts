import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.js';
import { applyTestEnv } from '../helpers/testEnv.js';
import { resetEnvCache } from '../../src/config/env.js';
import { loginAsAdmin } from '../helpers/adminSession.js';

/** Spec 13 — campaign CRUD, slug uniqueness, and the "delete nulls linked sections" guarantee (§13.7, §13.4). */
const SCHEMA = 'spec13_campaigns_crud';

describe.skipIf(!TEST_DATABASE_URL)('campaigns CRUD (13-homepage-cms §13.7)', () => {
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

    const passwordHash = await hashPassword('CampaignCrudTestPass12');
    await usersRepository.create({ role: 'ADMIN', userIdentifier: 'campaign-crud-admin', passwordHash, mustChangePassword: false });
  }, 60_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  async function asAdmin() {
    return loginAsAdmin(app, 'campaign-crud-admin', 'CampaignCrudTestPass12');
  }

  it('creates a campaign with status defaulting to ACTIVE', async () => {
    const session = await asAdmin();
    const res = await session.post('/api/admin/campaigns').send({ name: 'Eid Sale', slug: `eid-sale-${Date.now()}` });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('ACTIVE');
  });

  it('rejects a duplicate slug with 409', async () => {
    const session = await asAdmin();
    const slug = `duplicate-slug-${Date.now()}`;
    const first = await session.post('/api/admin/campaigns').send({ name: 'First', slug });
    expect(first.status).toBe(201);

    const second = await session.post('/api/admin/campaigns').send({ name: 'Second', slug });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('CAMPAIGN_SLUG_EXISTS');
  });

  it('updates a campaign', async () => {
    const session = await asAdmin();
    const created = await session.post('/api/admin/campaigns').send({ name: 'To Rename', slug: `to-rename-${Date.now()}` });
    const updated = await session.patch(`/api/admin/campaigns/${created.body.data.id}`).send({ name: 'Renamed Campaign' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.name).toBe('Renamed Campaign');
  });

  it('deleting a campaign sets linked sections campaignId to null rather than deleting them', async () => {
    const session = await asAdmin();
    const campaign = await session.post('/api/admin/campaigns').send({ name: 'To Delete', slug: `to-delete-${Date.now()}` });
    const section = await session.post('/api/admin/homepage/sections').send({
      sectionType: 'CAMPAIGN_BANNER',
      campaignId: campaign.body.data.id,
      contentConfig: {},
    });
    expect(section.status).toBe(201);

    const del = await session.del(`/api/admin/campaigns/${campaign.body.data.id}`);
    expect(del.status).toBe(200);

    const sectionAfter = await session.agent.get(`/api/admin/homepage/sections/${section.body.data.id}`);
    expect(sectionAfter.status).toBe(200);
    expect(sectionAfter.body.data.campaignId).toBeNull();
  });

  it('endsAt before startsAt is rejected with 400', async () => {
    const session = await asAdmin();
    const res = await session.post('/api/admin/campaigns').send({
      name: 'Bad Dates',
      slug: `bad-dates-${Date.now()}`,
      startsAt: '2026-10-15T00:00:00.000Z',
      endsAt: '2026-10-01T00:00:00.000Z',
    });
    expect(res.status).toBe(400);
  });

  it('an unrecognized field is rejected (.strict())', async () => {
    const session = await asAdmin();
    const res = await session.post('/api/admin/campaigns').send({
      name: 'Strict Test',
      slug: `strict-test-${Date.now()}`,
      unknownField: 'x',
    });
    expect(res.status).toBe(400);
  });
});
