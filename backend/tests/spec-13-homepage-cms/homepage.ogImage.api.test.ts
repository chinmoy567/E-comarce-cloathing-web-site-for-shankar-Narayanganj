import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.js';
import { applyTestEnv } from '../helpers/testEnv.js';
import { resetEnvCache } from '../../src/config/env.js';
import { loginAsAdmin } from '../helpers/adminSession.js';

/**
 * Spec 17 — homepage metadata.ogImageUrl: absolute https URL taken from the
 * visible campaign's heroContent image, otherwise null. Also covers the
 * heroContent title/subtitle length caps (<=120 / <=200) at the API.
 */
const SCHEMA = 'spec13_og_image';
const PW = 'OgImagePass12';

describe.skipIf(!TEST_DATABASE_URL)('homepage ogImageUrl + heroContent caps (spec 17)', () => {
  let app: Express;
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;
  let withTransaction: typeof import('../../src/lib/transaction.js').withTransaction;

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    applyTestEnv();
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    resetEnvCache();

    ({ resetTransactionPool, withTransaction } = await import('../../src/lib/transaction.js'));
    await resetTransactionPool();
    const usersRepository = await import('../../src/repositories/users.repository.js');
    const { hashPassword } = await import('../../src/lib/password.js');
    const { createApp } = await import('../../src/app.js');
    app = createApp();
    await usersRepository.create({ role: 'ADMIN', userIdentifier: 'og-admin', passwordHash: await hashPassword(PW), mustChangePassword: false });
  }, 60_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  const admin = () => loginAsAdmin(app, 'og-admin', PW);
  const clean = () =>
    withTransaction(async (c) => {
      await c.query('DELETE FROM homepage_sections');
      await c.query('DELETE FROM campaigns');
    });

  async function liveBanner(heroContent: unknown) {
    const s = await admin();
    const camp = await s.post('/api/admin/campaigns').send({ name: 'Og', slug: `og-${Date.now()}`, heroContent });
    expect(camp.status).toBe(201);
    const sec = await s.post('/api/admin/homepage/sections').send({
      sectionType: 'CAMPAIGN_BANNER',
      status: 'ACTIVE',
      campaignId: camp.body.data.id,
      contentConfig: {},
    });
    expect(sec.status).toBe(201);
    return camp.body.data.id as string;
  }

  const metadata = async () => (await request(app).get('/api/homepage')).body.data.metadata;

  it('uses the campaign hero desktop image as an absolute https URL', async () => {
    await clean();
    const url = `${process.env.SUPABASE_URL}/storage/v1/object/public/homepage/hero.jpg`;
    await liveBanner({ title: 'Eid', subtitle: 'Sale', desktopImageUrl: url });
    const m = await metadata();
    expect(m.ogImageUrl).toBe(url);
    expect(m.ogImageUrl.startsWith('https://')).toBe(true);
    expect(m.title).toBe('Eid');
  });

  it('falls back to the mobile image when no desktop image', async () => {
    await clean();
    const url = `${process.env.SUPABASE_URL}/storage/v1/object/public/homepage/m.jpg`;
    await liveBanner({ title: 'Eid', mobileImageUrl: url });
    expect((await metadata()).ogImageUrl).toBe(url);
  });

  it('is null when the campaign hero has no image', async () => {
    await clean();
    await liveBanner({ title: 'No image' });
    const m = await metadata();
    expect(m.title).toBe('No image');
    expect(m.ogImageUrl).toBeNull();
  });

  it('is null when the stored image is not https (never leaks a relative or http URL)', async () => {
    await clean();
    const id = await liveBanner({ title: 'Legacy' });
    for (const bad of ['http://example.com/a.jpg', '/uploads/a.jpg']) {
      await withTransaction((c) =>
        c.query(`UPDATE campaigns SET hero_content = jsonb_build_object('title','Legacy','desktopImageUrl',$2::text) WHERE id = $1`, [id, bad]),
      );
      expect((await metadata()).ogImageUrl).toBeNull();
    }
  });

  it('is null with no campaign at all (default metadata)', async () => {
    await clean();
    expect((await metadata()).ogImageUrl).toBeNull();
  });

  it.each([
    ['title', 120, true],
    ['title', 121, false],
    ['subtitle', 200, true],
    ['subtitle', 201, false],
  ] as const)('heroContent %s of %i chars -> accepted=%s', async (field, len, ok) => {
    const s = await admin();
    const res = await s.post('/api/admin/campaigns').send({
      name: 'Len',
      slug: `len-${field}-${len}-${Date.now()}`,
      heroContent: { [field]: 'a'.repeat(len) },
    });
    expect(res.status).toBe(ok ? 201 : 400);
  });
});
