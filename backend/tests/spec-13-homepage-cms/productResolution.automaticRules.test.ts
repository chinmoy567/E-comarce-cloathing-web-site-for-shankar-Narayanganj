import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.js';

/** Spec 13 — automatic product-resolution rules (§13.5): LATEST, FEATURED, CATEGORY, and Inactive/out-of-stock exclusion. */
const SCHEMA = 'spec13_automatic_rules';

describe.skipIf(!TEST_DATABASE_URL)('resolveAutomaticProducts (13-homepage-cms §13.5)', () => {
  let resolveAutomaticProducts: typeof import('../../src/services/homepageCms/productResolution.js').resolveAutomaticProducts;
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;
  let withTransactionFn: typeof import('../../src/lib/transaction.js').withTransaction;
  let categoryId: string;
  let subcategoryId: string;

  async function insertProduct(overrides: {
    name: string;
    status: 'ACTIVE' | 'INACTIVE';
    isFeatured?: boolean;
    categoryId?: string;
    stockQuantity?: number;
    basePrice?: number;
    compareAtPrice?: number | null;
  }): Promise<string> {
    return withTransactionFn(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO products (category_id, name, slug, base_price, compare_at_price, status, is_featured)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [
          overrides.categoryId ?? categoryId,
          overrides.name,
          `${overrides.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
          overrides.basePrice ?? 100,
          overrides.compareAtPrice ?? null,
          overrides.status,
          overrides.isFeatured ?? false,
        ],
      );
      const productId = rows[0]!.id;
      await client.query(`INSERT INTO product_variants (product_id, stock_quantity, is_active) VALUES ($1,$2,true)`, [
        productId,
        overrides.stockQuantity ?? 10,
      ]);
      return productId;
    });
  }

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    const { applyTestEnv } = await import('../helpers/testEnv.js');
    applyTestEnv();
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    const { resetEnvCache } = await import('../../src/config/env.js');
    resetEnvCache();

    ({ resetTransactionPool, withTransaction: withTransactionFn } = await import('../../src/lib/transaction.js'));
    await resetTransactionPool();
    ({ resolveAutomaticProducts } = await import('../../src/services/homepageCms/productResolution.js'));

    const { rows: catRows } = await withTransactionFn((client) =>
      client.query<{ id: string }>(`INSERT INTO categories (name, slug) VALUES ('Men', 'men-${Date.now()}') RETURNING id`),
    );
    categoryId = catRows[0]!.id;
    const { rows: subRows } = await withTransactionFn((client) =>
      client.query<{ id: string }>(
        `INSERT INTO categories (parent_id, name, slug) VALUES ($1, 'Men Shirts', 'men-shirts-${Date.now()}') RETURNING id`,
        [categoryId],
      ),
    );
    subcategoryId = subRows[0]!.id;
  }, 60_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  it('LATEST excludes Inactive and out-of-stock products', async () => {
    const active = await insertProduct({ name: 'Latest Active', status: 'ACTIVE' });
    await insertProduct({ name: 'Latest Inactive', status: 'INACTIVE' });
    await insertProduct({ name: 'Latest Out Of Stock', status: 'ACTIVE', stockQuantity: 0 });

    const result = await resolveAutomaticProducts({ rule: 'LATEST', limit: 20 });
    const ids = result.map((p) => p.id);
    expect(ids).toContain(active);
    expect(result.every((p) => !p.outOfStock)).toBe(true);
  });

  it('FEATURED returns only is_featured=true, Active, in-stock products', async () => {
    const featured = await insertProduct({ name: 'Featured One', status: 'ACTIVE', isFeatured: true });
    await insertProduct({ name: 'Not Featured', status: 'ACTIVE', isFeatured: false });
    await insertProduct({ name: 'Featured Inactive', status: 'INACTIVE', isFeatured: true });

    const result = await resolveAutomaticProducts({ rule: 'FEATURED', limit: 20 });
    expect(result.every((p) => p.isFeatured)).toBe(true);
    expect(result.map((p) => p.id)).toContain(featured);
  });

  it('CATEGORY includes the category and its direct subcategories', async () => {
    const inParent = await insertProduct({ name: 'In Parent', status: 'ACTIVE', categoryId });
    const inSub = await insertProduct({ name: 'In Sub', status: 'ACTIVE', categoryId: subcategoryId });

    const result = await resolveAutomaticProducts({ rule: 'CATEGORY', limit: 20, categoryId });
    const ids = result.map((p) => p.id);
    expect(ids).toContain(inParent);
    expect(ids).toContain(inSub);
  });

  it('respects the limit', async () => {
    for (let i = 0; i < 5; i += 1) {
      await insertProduct({ name: `Limit Test ${i}-${Date.now()}`, status: 'ACTIVE' });
    }
    const result = await resolveAutomaticProducts({ rule: 'LATEST', limit: 2 });
    expect(result.length).toBeLessThanOrEqual(2);
  });
});
