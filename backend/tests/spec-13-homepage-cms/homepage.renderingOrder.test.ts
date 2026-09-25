import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.js';
import { applyTestEnv } from '../helpers/testEnv.js';
import { resetEnvCache } from '../../src/config/env.js';
import { loginAsAdmin } from '../helpers/adminSession.js';

/** Spec 13 — the public response is sorted by display_order; reordering changes it (§13.8). */
const SCHEMA = 'spec13_rendering_order';

describe.skipIf(!TEST_DATABASE_URL)('homepage rendering order (13-homepage-cms §13.8)', () => {
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

    const passwordHash = await hashPassword('RenderingOrderPass12');
    await usersRepository.create({ role: 'ADMIN', userIdentifier: 'rendering-order-admin', passwordHash, mustChangePassword: false });
  }, 60_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  async function asAdmin() {
    return loginAsAdmin(app, 'rendering-order-admin', 'RenderingOrderPass12');
  }

  it('sections come back sorted ascending by display_order, and reordering changes the result', async () => {
    const session = await asAdmin();
    const a = await session.post('/api/admin/homepage/sections').send({ sectionType: 'CUSTOM_CONTENT', status: 'ACTIVE', contentConfig: { body: 'a' } });
    const b = await session.post('/api/admin/homepage/sections').send({ sectionType: 'CUSTOM_CONTENT', status: 'ACTIVE', contentConfig: { body: 'b' } });
    const c = await session.post('/api/admin/homepage/sections').send({ sectionType: 'CUSTOM_CONTENT', status: 'ACTIVE', contentConfig: { body: 'c' } });

    const request = await import('supertest');
    const before = await request.default(app).get('/api/homepage');
    const idsBefore = before.body.data.sections.map((s: { id: string }) => s.id).filter((id: string) => [a, b, c].map((r) => r.body.data.id).includes(id));
    expect(idsBefore).toEqual([a.body.data.id, b.body.data.id, c.body.data.id]);

    const reordered = [c.body.data.id, a.body.data.id, b.body.data.id];
    const reorderRes = await session.post('/api/admin/homepage/sections/reorder').send({ sectionIds: reordered });
    expect(reorderRes.status).toBe(200);

    const after = await request.default(app).get('/api/homepage');
    const idsAfter = after.body.data.sections.map((s: { id: string }) => s.id).filter((id: string) => reordered.includes(id));
    expect(idsAfter).toEqual(reordered);
  });
});
