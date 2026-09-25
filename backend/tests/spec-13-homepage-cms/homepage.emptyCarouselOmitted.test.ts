import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.js';
import { applyTestEnv } from '../helpers/testEnv.js';
import { resetEnvCache } from '../../src/config/env.js';
import { loginAsAdmin } from '../helpers/adminSession.js';

/** Spec 13 — a PRODUCT_CAROUSEL resolving to zero products is dropped entirely, not returned with products: [] (§13.8). */
const SCHEMA = 'spec13_empty_carousel';

describe.skipIf(!TEST_DATABASE_URL)('empty carousel omission (13-homepage-cms §13.8)', () => {
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

    const passwordHash = await hashPassword('EmptyCarouselPass12');
    await usersRepository.create({ role: 'ADMIN', userIdentifier: 'empty-carousel-admin', passwordHash, mustChangePassword: false });
  }, 60_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  async function asAdmin() {
    return loginAsAdmin(app, 'empty-carousel-admin', 'EmptyCarouselPass12');
  }

  it('a MANUAL carousel with no attached products is entirely absent from the response', async () => {
    const session = await asAdmin();
    const created = await session.post('/api/admin/homepage/sections').send({
      sectionType: 'PRODUCT_CAROUSEL',
      status: 'ACTIVE',
      contentConfig: { mode: 'MANUAL' },
    });
    expect(created.status).toBe(201);

    const request = await import('supertest');
    const res = await request.default(app).get('/api/homepage');
    expect(res.body.data.sections.some((s: { id: string }) => s.id === created.body.data.id)).toBe(false);
  });

  it('an AUTOMATIC FEATURED carousel with zero matching products is entirely absent', async () => {
    const session = await asAdmin();
    const created = await session.post('/api/admin/homepage/sections').send({
      sectionType: 'PRODUCT_CAROUSEL',
      status: 'ACTIVE',
      contentConfig: { mode: 'AUTOMATIC', rule: 'FEATURED', limit: 12 },
    });
    expect(created.status).toBe(201);

    const request = await import('supertest');
    const res = await request.default(app).get('/api/homepage');
    expect(res.body.data.sections.some((s: { id: string }) => s.id === created.body.data.id)).toBe(false);
  });
});
