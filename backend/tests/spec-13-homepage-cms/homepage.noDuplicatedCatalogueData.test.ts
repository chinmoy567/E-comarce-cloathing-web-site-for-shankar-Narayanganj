import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.js';
import { applyTestEnv } from '../helpers/testEnv.js';
import { resetEnvCache } from '../../src/config/env.js';
import { loginAsAdmin } from '../helpers/adminSession.js';

/** Spec 13 — no product data is duplicated into the CMS; a catalogue rename is reflected with zero CMS writes (§13.1). */
const SCHEMA = 'spec13_no_duplicated_data';

describe.skipIf(!TEST_DATABASE_URL)('no duplicated catalogue data (13-homepage-cms §13.1)', () => {
  let app: Express;
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;
  let withTransactionFn: typeof import('../../src/lib/transaction.js').withTransaction;
  let usersRepository: typeof import('../../src/repositories/users.repository.js');
  let homepageSectionProductsRepository: typeof import('../../src/repositories/homepageSectionProducts.repository.js');
  let hashPassword: typeof import('../../src/lib/password.js').hashPassword;
  let categoryId: string;
  let productId: string;
  let sectionId: string;

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    applyTestEnv();
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    resetEnvCache();

    ({ resetTransactionPool, withTransaction: withTransactionFn } = await import('../../src/lib/transaction.js'));
    await resetTransactionPool();
    usersRepository = await import('../../src/repositories/users.repository.js');
    homepageSectionProductsRepository = await import('../../src/repositories/homepageSectionProducts.repository.js');
    ({ hashPassword } = await import('../../src/lib/password.js'));
    const { createApp } = await import('../../src/app.js');
    app = createApp();

    const passwordHash = await hashPassword('NoDupDataPass12');
    await usersRepository.create({ role: 'ADMIN', userIdentifier: 'no-dup-data-admin', passwordHash, mustChangePassword: false });

    const { rows: catRows } = await withTransactionFn((client) =>
      client.query<{ id: string }>(`INSERT INTO categories (name, slug) VALUES ('Dup Cat', 'dup-cat-${Date.now()}') RETURNING id`),
    );
    categoryId = catRows[0]!.id;

    const { rows: productRows } = await withTransactionFn((client) =>
      client.query<{ id: string }>(
        `INSERT INTO products (category_id, name, slug, base_price, status) VALUES ($1,'Original Name',$2,100,'ACTIVE') RETURNING id`,
        [categoryId, `original-name-${Date.now()}`],
      ),
    );
    productId = productRows[0]!.id;
    await withTransactionFn((client) => client.query(`INSERT INTO product_variants (product_id, stock_quantity, is_active) VALUES ($1,10,true)`, [productId]));

    const session = await loginAsAdmin(app, 'no-dup-data-admin', 'NoDupDataPass12');
    const created = await session.post('/api/admin/homepage/sections').send({
      sectionType: 'PRODUCT_CAROUSEL',
      status: 'ACTIVE',
      contentConfig: { mode: 'MANUAL' },
    });
    sectionId = created.body.data.id;
    await withTransactionFn((client) => homepageSectionProductsRepository.replaceAll(sectionId, [productId], client));
  }, 60_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  it('renaming the product changes the homepage response with zero CMS writes', async () => {
    const request = await import('supertest');

    const before = await request.default(app).get('/api/homepage');
    const beforeSection = before.body.data.sections.find((s: { id: string }) => s.id === sectionId);
    expect(beforeSection.products[0].name).toBe('Original Name');

    await withTransactionFn((client) => client.query(`UPDATE products SET name = 'Renamed Product' WHERE id = $1`, [productId]));

    const after = await request.default(app).get('/api/homepage');
    const afterSection = after.body.data.sections.find((s: { id: string }) => s.id === sectionId);
    expect(afterSection.products[0].name).toBe('Renamed Product');
  });
});
