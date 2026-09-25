import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.js';
import { applyTestEnv } from '../helpers/testEnv.js';
import { resetEnvCache } from '../../src/config/env.js';
import { loginAsAdmin } from '../helpers/adminSession.js';

/** Spec 13 — scheduling is server-evaluated only; no request accepts a client-supplied "as of" timestamp (§13.7a). */
const SCHEMA = 'spec13_server_time_only';

describe.skipIf(!TEST_DATABASE_URL)('server-time-only scheduling (13-homepage-cms §13.7a)', () => {
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

    const passwordHash = await hashPassword('ServerTimeOnlyPass12');
    await usersRepository.create({ role: 'ADMIN', userIdentifier: 'server-time-admin', passwordHash, mustChangePassword: false });
  }, 60_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  async function asAdmin() {
    return loginAsAdmin(app, 'server-time-admin', 'ServerTimeOnlyPass12');
  }

  it('a scheduled (future startsAt) section stays hidden regardless of a client-supplied "now"/"asOf" query param', async () => {
    const session = await asAdmin();
    const created = await session.post('/api/admin/homepage/sections').send({
      sectionType: 'CUSTOM_CONTENT',
      status: 'ACTIVE',
      startsAt: '2099-01-01T00:00:00.000Z',
      contentConfig: { body: 'future content' },
    });
    expect(created.status).toBe(201);

    const request = await import('supertest');
    const attempts = await Promise.all([
      request.default(app).get('/api/homepage').query({ now: '2099-06-01T00:00:00.000Z' }),
      request.default(app).get('/api/homepage').query({ asOf: '2099-06-01T00:00:00.000Z' }),
      request.default(app).get('/api/homepage'),
    ]);

    for (const res of attempts) {
      expect(res.status).toBe(200);
      expect(res.body.data.sections.some((s: { id: string }) => s.id === created.body.data.id)).toBe(false);
    }
  });

  it('the create/update schemas have no field for a caller-supplied evaluation timestamp', async () => {
    const session = await asAdmin();
    const res = await session.post('/api/admin/homepage/sections').send({
      sectionType: 'CUSTOM_CONTENT',
      contentConfig: { body: 'x' },
      now: '2020-01-01T00:00:00.000Z',
    });
    // .strict() rejects the unrecognized "now" field outright.
    expect(res.status).toBe(400);
  });
});
