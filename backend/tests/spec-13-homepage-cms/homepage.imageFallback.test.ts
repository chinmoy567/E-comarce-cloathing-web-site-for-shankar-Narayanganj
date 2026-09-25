import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.js';
import { applyTestEnv } from '../helpers/testEnv.js';
import { resetEnvCache } from '../../src/config/env.js';
import { loginAsAdmin } from '../helpers/adminSession.js';

/** Spec 13 — a section with only one of desktop/mobile image resolves both at the response level; frontend fallback rendering is a component-level concern (§13.11). */
const SCHEMA = 'spec13_image_fallback';

describe.skipIf(!TEST_DATABASE_URL)('image fallback at the response level (13-homepage-cms §13.11)', () => {
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

    const passwordHash = await hashPassword('ImageFallbackPass12');
    await usersRepository.create({ role: 'ADMIN', userIdentifier: 'image-fallback-admin', passwordHash, mustChangePassword: false });
  }, 60_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  async function asAdmin() {
    return loginAsAdmin(app, 'image-fallback-admin', 'ImageFallbackPass12');
  }

  it('a desktop-only section still returns both fields, with mobileImageUrl null for the frontend to fall back on', async () => {
    const session = await asAdmin();
    const created = await session.post('/api/admin/homepage/sections').send({
      sectionType: 'HERO',
      status: 'ACTIVE',
      desktopImageUrl: 'https://fabrillke.com/images/desktop-hero.jpg',
      contentConfig: {},
    });
    expect(created.status).toBe(201);

    const request = await import('supertest');
    const res = await request.default(app).get('/api/homepage');
    const section = res.body.data.sections.find((s: { id: string }) => s.id === created.body.data.id);
    expect(section.desktopImageUrl).toBe('https://fabrillke.com/images/desktop-hero.jpg');
    expect(section.mobileImageUrl).toBeNull();
  });

  it('a mobile-only section still returns both fields, with desktopImageUrl null', async () => {
    const session = await asAdmin();
    const created = await session.post('/api/admin/homepage/sections').send({
      sectionType: 'HERO',
      status: 'ACTIVE',
      mobileImageUrl: 'https://fabrillke.com/images/mobile-hero.jpg',
      contentConfig: {},
    });
    expect(created.status).toBe(201);

    const request = await import('supertest');
    const res = await request.default(app).get('/api/homepage');
    const section = res.body.data.sections.find((s: { id: string }) => s.id === created.body.data.id);
    expect(section.mobileImageUrl).toBe('https://fabrillke.com/images/mobile-hero.jpg');
    expect(section.desktopImageUrl).toBeNull();
  });
});
