import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.js';
import { applyTestEnv } from '../helpers/testEnv.js';
import { resetEnvCache } from '../../src/config/env.js';
import { loginAsAdmin } from '../helpers/adminSession.js';

/** Spec 13 — CUSTOM_CONTENT.body is sanitized server-side before storage (§13.13). Asserts the stored row, not just the response. */
const SCHEMA = 'spec13_rich_text_sanitization';

describe.skipIf(!TEST_DATABASE_URL)('CUSTOM_CONTENT sanitization (13-homepage-cms §13.13)', () => {
  let app: Express;
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;
  let usersRepository: typeof import('../../src/repositories/users.repository.js');
  let homepageSectionsRepository: typeof import('../../src/repositories/homepageSections.repository.js');
  let hashPassword: typeof import('../../src/lib/password.js').hashPassword;

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    applyTestEnv();
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    resetEnvCache();

    ({ resetTransactionPool } = await import('../../src/lib/transaction.js'));
    await resetTransactionPool();
    usersRepository = await import('../../src/repositories/users.repository.js');
    homepageSectionsRepository = await import('../../src/repositories/homepageSections.repository.js');
    ({ hashPassword } = await import('../../src/lib/password.js'));
    const { createApp } = await import('../../src/app.js');
    app = createApp();

    const passwordHash = await hashPassword('RichTextSanitizePass12');
    await usersRepository.create({ role: 'ADMIN', userIdentifier: 'rich-text-admin', passwordHash, mustChangePassword: false });
  }, 60_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  async function asAdmin() {
    return loginAsAdmin(app, 'rich-text-admin', 'RichTextSanitizePass12');
  }

  it('a <script> tag is stripped from the stored body', async () => {
    const session = await asAdmin();
    const created = await session.post('/api/admin/homepage/sections').send({
      sectionType: 'CUSTOM_CONTENT',
      contentConfig: { body: '<p>Hello</p><script>alert(1)</script>' },
    });
    expect(created.status).toBe(201);

    const stored = await homepageSectionsRepository.findById(created.body.data.id);
    const body = (stored!.contentConfig as { body: string }).body;
    expect(body).not.toContain('<script>');
    expect(body).toContain('Hello');
  });

  it('an onclick event-handler attribute is stripped', async () => {
    const session = await asAdmin();
    const created = await session.post('/api/admin/homepage/sections').send({
      sectionType: 'CUSTOM_CONTENT',
      contentConfig: { body: '<p onclick="alert(1)">Click me</p>' },
    });
    expect(created.status).toBe(201);

    const stored = await homepageSectionsRepository.findById(created.body.data.id);
    const body = (stored!.contentConfig as { body: string }).body;
    expect(body).not.toContain('onclick');
  });
});
