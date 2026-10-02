import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.js';
import { applyTestEnv } from '../helpers/testEnv.js';
import { resetEnvCache } from '../../src/config/env.js';
import { loginAsAdmin } from '../helpers/adminSession.js';

/**
 * Spec 17 — homepage section cap and section-type immutability error code.
 * The cap (100) is transcribed from the spec, not imported from src. Rows are
 * seeded in bulk with raw SQL so the 101st create goes through the real route.
 */
const SCHEMA = 'spec13_section_limit';
const CAP = 100;

describe.skipIf(!TEST_DATABASE_URL)('section limit + immutable type (spec 17)', () => {
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
    await usersRepository.create({
      role: 'ADMIN',
      userIdentifier: 'section-limit-admin',
      passwordHash: await hashPassword('SectionLimitPass12'),
      mustChangePassword: false,
    });
  }, 60_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  const body = () => ({ sectionType: 'CUSTOM_CONTENT', contentConfig: { body: 'x' } });
  const count = () =>
    withTransaction(async (c) => Number((await c.query<{ n: string }>('SELECT count(*) AS n FROM homepage_sections')).rows[0]!.n));

  it('PATCH with sectionType is rejected 400 SECTION_TYPE_IMMUTABLE and the type is unchanged', async () => {
    const session = await loginAsAdmin(app, 'section-limit-admin', 'SectionLimitPass12');
    const created = await session.post('/api/admin/homepage/sections').send(body());
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    const res = await session.patch(`/api/admin/homepage/sections/${id}`).send({ sectionType: 'HERO' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SECTION_TYPE_IMMUTABLE');

    const after = await session.agent.get(`/api/admin/homepage/sections/${id}`);
    expect(after.body.data.sectionType).toBe('CUSTOM_CONTENT');
  });

  it('PATCH sectionType even equal to the current type is rejected (immutable, not merely unchanged)', async () => {
    const session = await loginAsAdmin(app, 'section-limit-admin', 'SectionLimitPass12');
    const created = await session.post('/api/admin/homepage/sections').send(body());
    const res = await session.patch(`/api/admin/homepage/sections/${created.body.data.id}`).send({ sectionType: 'CUSTOM_CONTENT', title: 'T' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SECTION_TYPE_IMMUTABLE');
  });

  it('creating the 101st section -> 409 SECTION_LIMIT_REACHED; the 100th succeeds; nothing is written by the rejected call', async () => {
    const session = await loginAsAdmin(app, 'section-limit-admin', 'SectionLimitPass12');
    const existing = await count();
    await withTransaction((c) =>
      c.query(
        `INSERT INTO homepage_sections (section_type, display_order, content_config)
         SELECT 'CUSTOM_CONTENT', 1000 + g, '{"body":"x"}'::jsonb FROM generate_series(1, $1::int) g`,
        [CAP - 1 - existing],
      ),
    );
    expect(await count()).toBe(CAP - 1);

    const hundredth = await session.post('/api/admin/homepage/sections').send(body());
    expect(hundredth.status).toBe(201);
    expect(await count()).toBe(CAP);

    const rejected = await session.post('/api/admin/homepage/sections').send(body());
    expect(rejected.status).toBe(409);
    expect(rejected.body.error.code).toBe('SECTION_LIMIT_REACHED');
    expect(await count()).toBe(CAP);
  });
});
