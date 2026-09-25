import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.js';
import { applyTestEnv } from '../helpers/testEnv.js';
import { resetEnvCache } from '../../src/config/env.js';

/**
 * Public storefront product browsing API (spec 02 §"Browse products by
 * category", "Search and filter products", "View detailed product
 * information", "Select product variants"). No authentication — this is the
 * customer-facing surface.
 */
const SCHEMA = 'spec05_public_products_api';

describe.skipIf(!TEST_DATABASE_URL)('public products API (spec 02, plan §10)', () => {
  let app: Express;
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;
  let withTransactionFn: typeof import('../../src/lib/transaction.js').withTransaction;

  let activeCategoryId: string;
  let activeProductId: string;
  let activeProductSlug: string;
  let inactiveProductSlug: string;
  let outOfStockProductSlug: string;

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    applyTestEnv();
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    resetEnvCache();

    ({ resetTransactionPool, withTransaction: withTransactionFn } = await import('../../src/lib/transaction.js'));
    await resetTransactionPool();
    const { createApp } = await import('../../src/app.js');
    app = createApp();

    const suffix = Date.now();

    const { rows: catRows } = await withTransactionFn((client) =>
      client.query<{ id: string }>(
        `INSERT INTO categories (name, slug, status) VALUES ('Public Cat', $1, 'ACTIVE') RETURNING id`,
        [`public-cat-${suffix}`],
      ),
    );
    activeCategoryId = catRows[0]!.id;

    // Active product with a size attribute and two variants (one in stock, one out).
    const { rows: prodRows } = await withTransactionFn((client) =>
      client.query<{ id: string }>(
        `INSERT INTO products (category_id, name, slug, sku, description, base_price, compare_at_price, status, is_featured)
         VALUES ($1, 'Public Active Shirt', $2, 'SKU-PUB-1', 'A nice shirt.', 500, 700, 'ACTIVE', true)
         RETURNING id`,
        [activeCategoryId, `public-active-shirt-${suffix}`],
      ),
    );
    activeProductId = prodRows[0]!.id;
    activeProductSlug = `public-active-shirt-${suffix}`;

    const { rows: attrRows } = await withTransactionFn((client) =>
      client.query<{ id: string }>(
        `INSERT INTO product_attributes (type, name) VALUES ('SIZE', 'Size') RETURNING id`,
      ),
    );
    const { rows: valueRows } = await withTransactionFn((client) =>
      client.query<{ id: string }>(
        `INSERT INTO product_attribute_values (attribute_id, value) VALUES ($1, 'M') RETURNING id`,
        [attrRows[0]!.id],
      ),
    );
    const { rows: variantRows } = await withTransactionFn((client) =>
      client.query<{ id: string }>(
        `INSERT INTO product_variants (product_id, price, stock_quantity, is_active)
         VALUES ($1, 550, 10, true) RETURNING id`,
        [activeProductId],
      ),
    );
    await withTransactionFn((client) =>
      client.query(`INSERT INTO product_variant_values (variant_id, attribute_value_id) VALUES ($1, $2)`, [
        variantRows[0]!.id,
        valueRows[0]!.id,
      ]),
    );

    // Inactive product — must never appear publicly.
    const { rows: inactiveRows } = await withTransactionFn((client) =>
      client.query<{ id: string }>(
        `INSERT INTO products (category_id, name, slug, base_price, status)
         VALUES ($1, 'Public Inactive Shirt', $2, 400, 'INACTIVE') RETURNING id`,
        [activeCategoryId, `public-inactive-shirt-${suffix}`],
      ),
    );
    inactiveProductSlug = `public-inactive-shirt-${suffix}`;
    await withTransactionFn((client) =>
      client.query(`INSERT INTO product_variants (product_id, stock_quantity, is_active) VALUES ($1, 5, true)`, [
        inactiveRows[0]!.id,
      ]),
    );

    // Active but fully out-of-stock product.
    const { rows: oosRows } = await withTransactionFn((client) =>
      client.query<{ id: string }>(
        `INSERT INTO products (category_id, name, slug, base_price, status)
         VALUES ($1, 'Public Out Of Stock', $2, 300, 'ACTIVE') RETURNING id`,
        [activeCategoryId, `public-oos-${suffix}`],
      ),
    );
    outOfStockProductSlug = `public-oos-${suffix}`;
    await withTransactionFn((client) =>
      client.query(`INSERT INTO product_variants (product_id, stock_quantity, is_active) VALUES ($1, 0, true)`, [
        oosRows[0]!.id,
      ]),
    );
  }, 60_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  async function get(path: string) {
    const request = await import('supertest');
    return request.default(app).get(path);
  }

  describe('GET /api/products', () => {
    it('lists only ACTIVE products, never INACTIVE ones', async () => {
      const res = await get('/api/products?pageSize=50');
      expect(res.status).toBe(200);
      const slugs = res.body.data.map((p: { slug: string }) => p.slug);
      expect(slugs).toContain(activeProductSlug);
      expect(slugs).toContain(outOfStockProductSlug);
      expect(slugs).not.toContain(inactiveProductSlug);
    });

    it('filters by categoryId', async () => {
      const res = await get(`/api/products?categoryId=${activeCategoryId}&pageSize=50`);
      expect(res.status).toBe(200);
      for (const item of res.body.data) {
        expect(item.categoryId).toBe(activeCategoryId);
      }
    });

    it('searches by name (case-insensitive substring)', async () => {
      const res = await get('/api/products?search=active shirt');
      expect(res.status).toBe(200);
      expect(res.body.data.some((p: { slug: string }) => p.slug === activeProductSlug)).toBe(true);
    });

    it('a search with no match returns an empty list, not an error', async () => {
      const res = await get('/api/products?search=zzz-no-such-product-zzz');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it('is paginated (spec 01 mandatory pagination)', async () => {
      const res = await get('/api/products?page=1&pageSize=1');
      expect(res.status).toBe(200);
      expect(res.body.pagination).toMatchObject({ page: 1, pageSize: 1 });
      expect(res.body.data.length).toBeLessThanOrEqual(1);
    });

    it('rejects page < 1 as a validation error', async () => {
      const res = await get('/api/products?page=0');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects an unknown query field (.strict())', async () => {
      const res = await get('/api/products?bogus=1');
      expect(res.status).toBe(400);
    });

    it('marks the fully out-of-stock product as outOfStock: true', async () => {
      const res = await get('/api/products?pageSize=50');
      const item = res.body.data.find((p: { slug: string }) => p.slug === outOfStockProductSlug);
      expect(item).toBeDefined();
      expect(item.outOfStock).toBe(true);
    });

    it('requires no authentication', async () => {
      const res = await get('/api/products');
      expect(res.status).not.toBe(401);
    });
  });

  describe('GET /api/products/:slug', () => {
    it('returns full detail for an active product: variants, attributes, category', async () => {
      const res = await get(`/api/products/${activeProductSlug}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        name: 'Public Active Shirt',
        slug: activeProductSlug,
        sku: 'SKU-PUB-1',
        basePrice: 500,
        compareAtPrice: 700,
        category: { id: activeCategoryId, name: 'Public Cat' },
      });
      expect(res.body.data.variants).toHaveLength(1);
      expect(res.body.data.variants[0]).toMatchObject({
        price: 550,
        stockQuantity: 10,
        inStock: true,
      });
      expect(res.body.data.variants[0].attributes).toEqual([
        expect.objectContaining({ type: 'SIZE', name: 'Size', value: 'M' }),
      ]);
    });

    it('404s for an INACTIVE product — never reachable publicly by slug', async () => {
      const res = await get(`/api/products/${inactiveProductSlug}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('404s for a slug that does not exist', async () => {
      const res = await get('/api/products/does-not-exist-at-all');
      expect(res.status).toBe(404);
    });

    it('never leaks admin-only fields (createdBy, updatedBy)', async () => {
      const res = await get(`/api/products/${activeProductSlug}`);
      expect(res.body.data).not.toHaveProperty('createdBy');
      expect(res.body.data).not.toHaveProperty('updatedBy');
    });
  });

  describe('GET /api/categories', () => {
    it('lists active categories without authentication', async () => {
      const res = await get('/api/categories');
      expect(res.status).toBe(200);
      expect(res.body.data.some((c: { id: string }) => c.id === activeCategoryId)).toBe(true);
    });
  });
});
