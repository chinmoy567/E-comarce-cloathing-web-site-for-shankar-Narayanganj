import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.js';

/**
 * Spec 13 — ON_SALE resolution (§13.5, plan §3.4a): union of (A) a visible
 * compare_at_price markdown and (B) an ACTIVE, in-schedule, product-/
 * category-restricted coupon; ALL_PRODUCTS-eligibility coupons excluded;
 * a product matching both sources appears exactly once.
 */
const SCHEMA = 'spec13_on_sale';

describe.skipIf(!TEST_DATABASE_URL)('resolveAutomaticProducts ON_SALE (13-homepage-cms §13.5)', () => {
  let resolveAutomaticProducts: typeof import('../../src/services/homepageCms/productResolution.js').resolveAutomaticProducts;
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;
  let withTransactionFn: typeof import('../../src/lib/transaction.js').withTransaction;
  let categoryId: string;

  async function insertProduct(overrides: {
    name: string;
    basePrice?: number;
    compareAtPrice?: number | null;
    categoryId?: string;
  }): Promise<string> {
    return withTransactionFn(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO products (category_id, name, slug, base_price, compare_at_price, status)
         VALUES ($1,$2,$3,$4,$5,'ACTIVE') RETURNING id`,
        [
          overrides.categoryId ?? categoryId,
          overrides.name,
          `${overrides.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
          overrides.basePrice ?? 100,
          overrides.compareAtPrice ?? null,
        ],
      );
      const productId = rows[0]!.id;
      await client.query(`INSERT INTO product_variants (product_id, stock_quantity, is_active) VALUES ($1,10,true)`, [productId]);
      return productId;
    });
  }

  async function insertCoupon(overrides: { productEligibility: 'ALL_PRODUCTS' | 'SPECIFIC_PRODUCTS' | 'SPECIFIC_CATEGORIES' }): Promise<string> {
    return withTransactionFn(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO coupons (code, name, discount_type, discount_value, starts_at, expires_at, status, product_eligibility)
         VALUES ($1,'Test','PERCENTAGE',10,'2020-01-01','2099-01-01','ACTIVE',$2) RETURNING id`,
        [`ONSALE${Date.now()}${Math.floor(Math.random() * 100000)}`, overrides.productEligibility],
      );
      return rows[0]!.id;
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

    const { rows } = await withTransactionFn((client) =>
      client.query<{ id: string }>(`INSERT INTO categories (name, slug) VALUES ('OnSale Cat', 'on-sale-cat-${Date.now()}') RETURNING id`),
    );
    categoryId = rows[0]!.id;
  }, 60_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  it('Source A: a product with compare_at_price > base_price is selected', async () => {
    const markedDown = await insertProduct({ name: 'Marked Down', basePrice: 100, compareAtPrice: 150 });
    const result = await resolveAutomaticProducts({ rule: 'ON_SALE', limit: 50 });
    expect(result.map((p) => p.id)).toContain(markedDown);
  });

  it('a product with compare_at_price IS NULL is not selected by Source A alone', async () => {
    const notMarkedDown = await insertProduct({ name: 'Not Marked Down', basePrice: 100, compareAtPrice: null });
    const result = await resolveAutomaticProducts({ rule: 'ON_SALE', limit: 50 });
    expect(result.map((p) => p.id)).not.toContain(notMarkedDown);
  });

  it('an ALL_PRODUCTS-eligibility coupon selects nothing via Source B', async () => {
    const plain = await insertProduct({ name: 'Plain Product', basePrice: 100, compareAtPrice: null });
    await insertCoupon({ productEligibility: 'ALL_PRODUCTS' });
    const result = await resolveAutomaticProducts({ rule: 'ON_SALE', limit: 50 });
    expect(result.map((p) => p.id)).not.toContain(plain);
  });

  it('a SPECIFIC_PRODUCTS-restricted active coupon selects its linked product via Source B', async () => {
    const linked = await insertProduct({ name: 'Coupon Linked', basePrice: 100, compareAtPrice: null });
    const couponId = await insertCoupon({ productEligibility: 'SPECIFIC_PRODUCTS' });
    await withTransactionFn((client) => client.query(`INSERT INTO coupon_products (coupon_id, product_id) VALUES ($1,$2)`, [couponId, linked]));

    const result = await resolveAutomaticProducts({ rule: 'ON_SALE', limit: 50 });
    expect(result.map((p) => p.id)).toContain(linked);
  });

  it('a SPECIFIC_CATEGORIES-restricted active coupon selects products in its linked category via Source B', async () => {
    const inCategory = await insertProduct({ name: 'Category Linked', basePrice: 100, compareAtPrice: null });
    const couponId = await insertCoupon({ productEligibility: 'SPECIFIC_CATEGORIES' });
    await withTransactionFn((client) =>
      client.query(`INSERT INTO coupon_categories (coupon_id, category_id) VALUES ($1,$2)`, [couponId, categoryId]),
    );

    const result = await resolveAutomaticProducts({ rule: 'ON_SALE', limit: 50 });
    expect(result.map((p) => p.id)).toContain(inCategory);
  });

  it('a product matching both Source A and Source B appears exactly once', async () => {
    const both = await insertProduct({ name: 'Both Sources', basePrice: 100, compareAtPrice: 150 });
    const couponId = await insertCoupon({ productEligibility: 'SPECIFIC_PRODUCTS' });
    await withTransactionFn((client) => client.query(`INSERT INTO coupon_products (coupon_id, product_id) VALUES ($1,$2)`, [couponId, both]));

    const result = await resolveAutomaticProducts({ rule: 'ON_SALE', limit: 50 });
    expect(result.filter((p) => p.id === both)).toHaveLength(1);
  });
});
