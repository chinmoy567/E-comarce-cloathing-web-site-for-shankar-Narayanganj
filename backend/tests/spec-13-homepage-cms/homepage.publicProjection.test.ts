import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.js';
import { applyTestEnv } from '../helpers/testEnv.js';
import { resetEnvCache } from '../../src/config/env.js';
import { loginAsAdmin } from '../helpers/adminSession.js';

/** Spec 13 — the homepage's product objects match PublicProductSummary's key set exactly; no internal field leaks. */
const SCHEMA = 'spec13_public_projection';

const EXPECTED_KEYS = ['id', 'name', 'slug', 'imageUrl', 'price', 'compareAtPrice', 'isFeatured', 'outOfStock'].sort();

describe.skipIf(!TEST_DATABASE_URL)('customer-safe product projection (13-homepage-cms, plan §7)', () => {
  let app: Express;
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;
  let withTransactionFn: typeof import('../../src/lib/transaction.js').withTransaction;
  let usersRepository: typeof import('../../src/repositories/users.repository.js');
  let homepageSectionProductsRepository: typeof import('../../src/repositories/homepageSectionProducts.repository.js');
  let hashPassword: typeof import('../../src/lib/password.js').hashPassword;
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

    const passwordHash = await hashPassword('PublicProjectionPass12');
    await usersRepository.create({ role: 'ADMIN', userIdentifier: 'public-projection-admin', passwordHash, mustChangePassword: false });

    const { rows: catRows } = await withTransactionFn((client) =>
      client.query<{ id: string }>(`INSERT INTO categories (name, slug) VALUES ('Proj Cat', 'proj-cat-${Date.now()}') RETURNING id`),
    );
    const { rows: productRows } = await withTransactionFn((client) =>
      client.query<{ id: string }>(
        `INSERT INTO products (category_id, name, slug, sku, base_price, weight_grams, status)
         VALUES ($1,'Projection Product',$2,'SKU-123',100,500,'ACTIVE') RETURNING id`,
        [catRows[0]!.id, `projection-product-${Date.now()}`],
      ),
    );
    const productId = productRows[0]!.id;
    await withTransactionFn((client) => client.query(`INSERT INTO product_variants (product_id, stock_quantity, is_active) VALUES ($1,10,true)`, [productId]));

    const session = await loginAsAdmin(app, 'public-projection-admin', 'PublicProjectionPass12');
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

  it('product objects contain exactly PublicProductSummary keys — no sku, weightGrams, createdBy, etc.', async () => {
    const request = await import('supertest');
    const res = await request.default(app).get('/api/homepage');
    const section = res.body.data.sections.find((s: { id: string }) => s.id === sectionId);
    const product = section.products[0];

    expect(Object.keys(product).sort()).toEqual(EXPECTED_KEYS);
    expect(product).not.toHaveProperty('sku');
    expect(product).not.toHaveProperty('weightGrams');
    expect(product).not.toHaveProperty('createdBy');
    expect(product).not.toHaveProperty('categoryId');
  });
});
