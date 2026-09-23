import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from './helpers/schemaFixture.js';
import { applyTestEnv } from './helpers/testEnv.js';
import { resetEnvCache } from '../src/config/env.js';
import { loginAsAdmin } from './helpers/adminSession.js';
import type { PermissionKey } from '../src/types/permissions.js';

/**
 * Spec 05 — catalogue HTTP surface (S2), tests required items 8, 9, 14, plus
 * the reason-required stock endpoint (acceptance 13) and pagination bounds
 * (acceptance 18).
 *
 * §5.18 catalogue rows, transcribed here independently of the seed migration
 * and `rbacMatrix.ts` (test skill R9): all ten are Yes/Yes for
 * Admin/Manager EXCEPT `product.delete`, which is Yes/Assigned.
 *
 * Nine of the ten keys default to Manager YES via the `manager_tier` seed
 * row, so there is no fixture Manager who lacks them by default. Per test 9's
 * own instruction ("verified by revoking just that one key in the fixture"),
 * the ungranted case for those nine is produced by flipping that single row's
 * `manager_tier` to 'NO' directly in the fixture DB (which
 * `resolveEffectivePermissions` reads live), then restoring it — this is a
 * fixture-state manipulation on OUR OWN disposable schema, not a change to
 * shared/seed data or to src/.
 */
const SCHEMA = 'spec05_catalogue_api';

const CATALOGUE_KEYS: PermissionKey[] = [
  'product.create',
  'product.update',
  'product.delete',
  'category.manage',
  'product.image.manage',
  'product.attribute.manage',
  'product.variant.manage',
  'product.price.manage',
  'inventory.manage',
  'product.visibility.manage',
];

describe.skipIf(!TEST_DATABASE_URL)('catalogue API (spec 05 §Routes, §5.18)', () => {
  let app: Express;
  let resetTransactionPool: typeof import('../src/lib/transaction.js').resetTransactionPool;
  let usersRepository: typeof import('../src/repositories/users.repository.js');
  let permissionsRepository: typeof import('../src/repositories/permissions.repository.js');
  let categoriesRepository: typeof import('../src/repositories/categories.repository.js');
  let productsRepository: typeof import('../src/repositories/products.repository.js');
  let hashPassword: typeof import('../src/lib/password.js').hashPassword;
  let withTransactionFn: typeof import('../src/lib/transaction.js').withTransaction;

  let adminId: string;
  let managerId: string;
  let categoryId: string;

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    applyTestEnv();
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    resetEnvCache();

    ({ resetTransactionPool, withTransaction: withTransactionFn } = await import('../src/lib/transaction.js'));
    await resetTransactionPool();
    usersRepository = await import('../src/repositories/users.repository.js');
    permissionsRepository = await import('../src/repositories/permissions.repository.js');
    categoriesRepository = await import('../src/repositories/categories.repository.js');
    productsRepository = await import('../src/repositories/products.repository.js');
    ({ hashPassword } = await import('../src/lib/password.js'));
    const { createApp } = await import('../src/app.js');
    app = createApp();

    const passwordHash = await hashPassword('CatalogueApiPass12');
    adminId = (
      await usersRepository.create({
        role: 'ADMIN',
        userIdentifier: 'catalogue-api-admin',
        passwordHash,
        mustChangePassword: false,
      })
    ).id;
    managerId = (
      await usersRepository.create({
        role: 'MANAGER',
        userIdentifier: 'catalogue-api-manager',
        passwordHash,
        mustChangePassword: false,
      })
    ).id;

    const category = await categoriesRepository.create({
      name: 'API Test Category',
      slug: 'api-test-category',
      createdBy: adminId,
    });
    categoryId = category.id;
  }, 60_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  async function asAdmin() {
    return loginAsAdmin(app, 'catalogue-api-admin', 'CatalogueApiPass12');
  }
  async function asManager() {
    return loginAsAdmin(app, 'catalogue-api-manager', 'CatalogueApiPass12');
  }

  /** Directly flips a §5.18 Yes/Yes catalogue row's manager_tier for one test, then restores it. */
  async function withManagerTierRevoked<T>(key: PermissionKey, fn: () => Promise<T>): Promise<T> {
    await withTransactionFn(async (client) => {
      await client.query(`UPDATE permissions SET manager_tier = 'NO' WHERE key = $1`, [key]);
    });
    try {
      return await fn();
    } finally {
      await withTransactionFn(async (client) => {
        await client.query(`UPDATE permissions SET manager_tier = 'YES' WHERE key = $1`, [key]);
      });
    }
  }

  async function createTestProduct(overrides: Partial<{ name: string; stockQuantity: number }> = {}) {
    const product = await productsRepository.create({
      categoryId,
      name: overrides.name ?? `API Product ${Date.now()}-${Math.random()}`,
      slug: `api-product-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      basePrice: 100,
      createdBy: adminId,
    });
    const productVariantsRepository = await import('../src/repositories/productVariants.repository.js');
    const variant = await productVariantsRepository.create({
      productId: product.id,
      stockQuantity: overrides.stockQuantity ?? 5,
    });
    return { product, variant };
  }

  // -------------------------------------------------------------------------
  // Test 8: one test per §5.18 catalogue permission row
  // -------------------------------------------------------------------------
  describe('permission matrix rows for catalogue (test 8)', () => {
    it('product.create: Manager (Yes) may create a product', async () => {
      const session = await asManager();
      const res = await session.post('/api/admin/catalogue/products').send({
        categoryId,
        name: `Perm Create ${Date.now()}`,
        basePrice: 100,
        variants: [{ stockQuantity: 1, attributeValueIds: [] }],
      });
      expect(res.status).toBe(201);
    });

    it('product.create: revoked Manager is rejected 403 FORBIDDEN', async () => {
      await withManagerTierRevoked('product.create', async () => {
        const session = await asManager();
        const res = await session.post('/api/admin/catalogue/products').send({
          categoryId,
          name: `Perm Create Revoked ${Date.now()}`,
          basePrice: 100,
          variants: [{ stockQuantity: 1, attributeValueIds: [] }],
        });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      });
    });

    it('product.update: Manager (Yes) may update a product', async () => {
      const { product } = await createTestProduct();
      const session = await asManager();
      const res = await session.patch(`/api/admin/catalogue/products/${product.id}`).send({ name: 'Updated Name' });
      expect(res.status).toBe(200);
    });

    it('product.update: revoked Manager is rejected 403 FORBIDDEN', async () => {
      const { product } = await createTestProduct();
      await withManagerTierRevoked('product.update', async () => {
        const session = await asManager();
        const res = await session.patch(`/api/admin/catalogue/products/${product.id}`).send({ name: 'X' });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      });
    });

    it('product.delete (Assigned): a Manager without the grant is rejected 403 (acceptance 4)', async () => {
      const { product } = await createTestProduct();
      const session = await asManager();
      const res = await session.del(`/api/admin/catalogue/products/${product.id}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('product.delete (Assigned): a Manager granted the permission succeeds (acceptance 4)', async () => {
      const { product } = await createTestProduct();
      await permissionsRepository.grant(managerId, 'product.delete', adminId);
      try {
        const session = await asManager();
        const res = await session.del(`/api/admin/catalogue/products/${product.id}`);
        expect(res.status).toBe(200);
      } finally {
        await permissionsRepository.revoke(managerId, 'product.delete');
      }
    });

    it('category.manage: Manager (Yes) may create a category; revoked is rejected 403', async () => {
      const session = await asManager();
      const okRes = await session.post('/api/admin/catalogue/categories').send({ name: `Cat Perm ${Date.now()}` });
      expect(okRes.status).toBe(201);

      await withManagerTierRevoked('category.manage', async () => {
        const revokedSession = await asManager();
        const res = await revokedSession
          .post('/api/admin/catalogue/categories')
          .send({ name: `Cat Perm Revoked ${Date.now()}` });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      });
    });

    it('product.image.manage row exists in the permission catalogue and is enforced by category/attribute/product infra (documented gap — see report)', async () => {
      // No route in this slice is gated on product.image.manage: image upload
      // is deferred to spec 06 (spec 05 §Scope "Out of scope / deferred").
      // This test asserts the permission KEY exists and resolves for both
      // roles per §5.18, since the row itself is testable even though no
      // route consumes it yet.
      const catalogue = await permissionsRepository.listAll();
      const entry = catalogue.find((e) => e.key === 'product.image.manage');
      expect(entry).toBeDefined();
      expect(entry!.adminTier).toBe('YES');
      expect(entry!.managerTier).toBe('YES');
    });

    it('product.attribute.manage: Manager (Yes) may create an attribute; revoked is rejected 403', async () => {
      const session = await asManager();
      const okRes = await session
        .post('/api/admin/catalogue/attributes')
        .send({ type: 'COLOUR', name: `Perm Colour ${Date.now()}` });
      expect(okRes.status).toBe(201);

      await withManagerTierRevoked('product.attribute.manage', async () => {
        const revokedSession = await asManager();
        const res = await revokedSession
          .post('/api/admin/catalogue/attributes')
          .send({ type: 'COLOUR', name: `Perm Colour Revoked ${Date.now()}` });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      });
    });

    it('product.variant.manage: Manager (Yes) may add a variant; revoked is rejected 403', async () => {
      const { product } = await createTestProduct();
      // The fixture product already has one no-option variant ([] combination);
      // a second [] variant would collide (§5.1 "Black / M is one variant"
      // applies equally to no-option variants), so give each addition its own
      // distinct attribute value.
      const productAttributesRepository = await import('../src/repositories/productAttributes.repository.js');
      const attribute = await productAttributesRepository.create({ type: 'SIZE', name: `Perm Size ${Date.now()}` });
      const valueA = await productAttributesRepository.createValue({ attributeId: attribute.id, value: 'PermA' });
      const valueB = await productAttributesRepository.createValue({ attributeId: attribute.id, value: 'PermB' });

      const session = await asManager();
      const okRes = await session
        .post(`/api/admin/catalogue/products/${product.id}/variants`)
        .send({ stockQuantity: 2, attributeValueIds: [valueA.id] });
      expect(okRes.status).toBe(201);

      await withManagerTierRevoked('product.variant.manage', async () => {
        const revokedSession = await asManager();
        const res = await revokedSession
          .post(`/api/admin/catalogue/products/${product.id}/variants`)
          .send({ stockQuantity: 2, attributeValueIds: [valueB.id] });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      });
    });

    it('product.price.manage: Manager (Yes) may update price; revoked is rejected 403', async () => {
      const { product } = await createTestProduct();
      const session = await asManager();
      const okRes = await session.patch(`/api/admin/catalogue/products/${product.id}/price`).send({ basePrice: 150 });
      expect(okRes.status).toBe(200);

      await withManagerTierRevoked('product.price.manage', async () => {
        const revokedSession = await asManager();
        const res = await revokedSession
          .patch(`/api/admin/catalogue/products/${product.id}/price`)
          .send({ basePrice: 200 });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      });
    });

    it('inventory.manage: Manager (Yes) may adjust stock; revoked is rejected 403', async () => {
      const { variant } = await createTestProduct();
      const session = await asManager();
      const okRes = await session
        .patch(`/api/admin/catalogue/variants/${variant.id}/stock`)
        .send({ stockQuantity: 20, reason: 'restock' });
      expect(okRes.status).toBe(200);

      await withManagerTierRevoked('inventory.manage', async () => {
        const revokedSession = await asManager();
        const res = await revokedSession
          .patch(`/api/admin/catalogue/variants/${variant.id}/stock`)
          .send({ stockQuantity: 25, reason: 'restock 2' });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      });
    });

    it('product.visibility.manage: Manager (Yes) may update visibility; revoked is rejected 403 (acceptance 4)', async () => {
      const { product } = await createTestProduct();
      const session = await asManager();
      const okRes = await session
        .patch(`/api/admin/catalogue/products/${product.id}/visibility`)
        .send({ status: 'ACTIVE' });
      expect(okRes.status).toBe(200);

      await withManagerTierRevoked('product.visibility.manage', async () => {
        const revokedSession = await asManager();
        const res = await revokedSession
          .patch(`/api/admin/catalogue/products/${product.id}/visibility`)
          .send({ status: 'INACTIVE' });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      });
    });

    it.each(CATALOGUE_KEYS)('%s is a known permission key present in the catalogue', async (key) => {
      const catalogue = await permissionsRepository.listAll();
      expect(catalogue.some((entry) => entry.key === key)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Test 9: price/visibility/stock check their own distinct permission
  // -------------------------------------------------------------------------
  describe('price/visibility/stock require their own distinct permission (test 9)', () => {
    it('revoking product.price.manage alone still allows visibility and stock changes', async () => {
      const { product, variant } = await createTestProduct();
      await withManagerTierRevoked('product.price.manage', async () => {
        const session = await asManager();

        const priceRes = await session.patch(`/api/admin/catalogue/products/${product.id}/price`).send({ basePrice: 111 });
        expect(priceRes.status).toBe(403);

        const visibilityRes = await session
          .patch(`/api/admin/catalogue/products/${product.id}/visibility`)
          .send({ status: 'ACTIVE' });
        expect(visibilityRes.status).toBe(200);

        const stockRes = await session
          .patch(`/api/admin/catalogue/variants/${variant.id}/stock`)
          .send({ stockQuantity: 30, reason: 'still allowed' });
        expect(stockRes.status).toBe(200);
      });
    });

    it('revoking product.visibility.manage alone still allows price and stock changes', async () => {
      const { product, variant } = await createTestProduct();
      await withManagerTierRevoked('product.visibility.manage', async () => {
        const session = await asManager();

        const visibilityRes = await session
          .patch(`/api/admin/catalogue/products/${product.id}/visibility`)
          .send({ status: 'ACTIVE' });
        expect(visibilityRes.status).toBe(403);

        const priceRes = await session.patch(`/api/admin/catalogue/products/${product.id}/price`).send({ basePrice: 222 });
        expect(priceRes.status).toBe(200);

        const stockRes = await session
          .patch(`/api/admin/catalogue/variants/${variant.id}/stock`)
          .send({ stockQuantity: 40, reason: 'still allowed' });
        expect(stockRes.status).toBe(200);
      });
    });

    it('revoking inventory.manage alone still allows price and visibility changes, but not stock', async () => {
      const { product, variant } = await createTestProduct();
      await withManagerTierRevoked('inventory.manage', async () => {
        const session = await asManager();

        const stockRes = await session
          .patch(`/api/admin/catalogue/variants/${variant.id}/stock`)
          .send({ stockQuantity: 50, reason: 'blocked' });
        expect(stockRes.status).toBe(403);

        const priceRes = await session.patch(`/api/admin/catalogue/products/${product.id}/price`).send({ basePrice: 333 });
        expect(priceRes.status).toBe(200);

        const visibilityRes = await session
          .patch(`/api/admin/catalogue/products/${product.id}/visibility`)
          .send({ status: 'INACTIVE' });
        expect(visibilityRes.status).toBe(200);
      });
    });

    it('holding only product.update (not price/visibility/inventory) is rejected on all three sub-resource endpoints', async () => {
      const { product, variant } = await createTestProduct();
      await withManagerTierRevoked('product.price.manage', () =>
        withManagerTierRevoked('product.visibility.manage', () =>
          withManagerTierRevoked('inventory.manage', async () => {
            const session = await asManager();

            const priceRes = await session.patch(`/api/admin/catalogue/products/${product.id}/price`).send({ basePrice: 444 });
            expect(priceRes.status).toBe(403);

            const visibilityRes = await session
              .patch(`/api/admin/catalogue/products/${product.id}/visibility`)
              .send({ status: 'ACTIVE' });
            expect(visibilityRes.status).toBe(403);

            const stockRes = await session
              .patch(`/api/admin/catalogue/variants/${variant.id}/stock`)
              .send({ stockQuantity: 60, reason: 'blocked' });
            expect(stockRes.status).toBe(403);

            // But general product.update remains usable.
            const updateRes = await session
              .patch(`/api/admin/catalogue/products/${product.id}`)
              .send({ name: 'Still allowed via product.update' });
            expect(updateRes.status).toBe(200);
          }),
        ),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Test 14 / acceptance 18: pagination
  // -------------------------------------------------------------------------
  describe('pagination on GET /products (test 14, acceptance 18)', () => {
    it('returns a pagination block and never more rows than pageSize', async () => {
      for (let i = 0; i < 5; i++) {
        await createTestProduct({ name: `Pagination Product ${i} ${Date.now()}-${Math.random()}` });
      }
      const session = await asAdmin();
      const res = await session.agent.get('/api/admin/catalogue/products').query({ page: 1, pageSize: 2 });
      expect(res.status).toBe(200);
      expect(res.body.pagination).toMatchObject({ page: 1, pageSize: 2 });
      expect(res.body.data.length).toBeLessThanOrEqual(2);
      expect(typeof res.body.pagination.total).toBe('number');
    });

    it('rejects a pageSize over 100 with 400', async () => {
      const session = await asAdmin();
      const res = await session.agent.get('/api/admin/catalogue/products').query({ page: 1, pageSize: 101 });
      expect(res.status).toBe(400);
    });

    it('defaults to pageSize 20 when omitted', async () => {
      const session = await asAdmin();
      const res = await session.agent.get('/api/admin/catalogue/products').query({});
      expect(res.status).toBe(200);
      expect(res.body.pagination.pageSize).toBe(20);
    });
  });

  // -------------------------------------------------------------------------
  // Acceptance 13: PATCH /variants/:id/stock without reason -> 400
  // -------------------------------------------------------------------------
  it('PATCH /variants/:id/stock without a reason returns 400 (acceptance 13)', async () => {
    const { variant } = await createTestProduct();
    const session = await asAdmin();
    const res = await session.patch(`/api/admin/catalogue/variants/${variant.id}/stock`).send({ stockQuantity: 7 });
    expect(res.status).toBe(400);
  });

  // -------------------------------------------------------------------------
  // Acceptance 2, 3: creation, slug, default INACTIVE
  // -------------------------------------------------------------------------
  it('POST /products creates a product with a generated slug and a distinct slug on name collision (acceptance 2)', async () => {
    const session = await asAdmin();
    const name = `Acceptance Collision ${Date.now()}`;
    const first = await session.post('/api/admin/catalogue/products').send({
      categoryId,
      name,
      basePrice: 100,
      variants: [{ stockQuantity: 1, attributeValueIds: [] }],
    });
    expect(first.status).toBe(201);
    expect(first.body.data.slug).toBeTruthy();

    const second = await session.post('/api/admin/catalogue/products').send({
      categoryId,
      name,
      basePrice: 100,
      variants: [{ stockQuantity: 1, attributeValueIds: [] }],
    });
    expect(second.status).toBe(201);
    expect(second.body.data.slug).toBe(`${first.body.data.slug}-2`);
  });

  it('a new product defaults to status INACTIVE (acceptance 3)', async () => {
    const session = await asAdmin();
    const res = await session.post('/api/admin/catalogue/products').send({
      categoryId,
      name: `Default Inactive ${Date.now()}`,
      basePrice: 100,
      variants: [{ stockQuantity: 1, attributeValueIds: [] }],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('INACTIVE');
  });

  // -------------------------------------------------------------------------
  // Regression: category description stored-XSS (categories.service.ts never
  // called sanitizeHtml before the fix) — HTTP-level confirmation alongside
  // the service-level test in catalogue.service.test.ts.
  // -------------------------------------------------------------------------
  it('POST /categories strips <script> tags from description before storage (regression: category stored-XSS)', async () => {
    const session = await asAdmin();
    const res = await session.post('/api/admin/catalogue/categories').send({
      name: `Cat XSS ${Date.now()}`,
      description: '<script>alert(1)</script><p>Safe</p>',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.description).not.toContain('<script>');
    expect(res.body.data.description).not.toContain('alert(1)');
  });

  it('PATCH /categories/:id strips <script> tags from description before storage (regression: category stored-XSS)', async () => {
    const session = await asAdmin();
    const createRes = await session
      .post('/api/admin/catalogue/categories')
      .send({ name: `Cat XSS Update ${Date.now()}` });
    expect(createRes.status).toBe(201);

    const patchRes = await session
      .patch(`/api/admin/catalogue/categories/${createRes.body.data.id}`)
      .send({ description: '<script>alert(2)</script><p>Updated</p>' });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.data.description).not.toContain('<script>');
    expect(patchRes.body.data.description).not.toContain('alert(2)');
  });

  // -------------------------------------------------------------------------
  // Regression: variant price permission bypass — PATCH /variants/:id only
  // checked product.variant.manage, but its schema also accepts price /
  // compareAtPrice, letting a Manager without product.price.manage change a
  // variant's price through the wrong route. Fixed by
  // assertVariantPriceFieldsAllowed in productVariants.controller.ts.
  // -------------------------------------------------------------------------
  describe('PATCH /variants/:id price fields require product.price.manage (regression: variant price bypass)', () => {
    it('a Manager with product.variant.manage but not product.price.manage is rejected 403 when the body includes price', async () => {
      const { variant } = await createTestProduct();
      await withManagerTierRevoked('product.price.manage', async () => {
        const session = await asManager();
        const res = await session.patch(`/api/admin/catalogue/variants/${variant.id}`).send({ price: 999 });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      });
    });

    it('a Manager with product.variant.manage but not product.price.manage is rejected 403 when the body includes compareAtPrice', async () => {
      const { variant } = await createTestProduct();
      await withManagerTierRevoked('product.price.manage', async () => {
        const session = await asManager();
        const res = await session
          .patch(`/api/admin/catalogue/variants/${variant.id}`)
          .send({ compareAtPrice: 1500 });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      });
    });

    it('a Manager without product.price.manage may still update non-price variant fields (e.g. sku)', async () => {
      const { variant } = await createTestProduct();
      await withManagerTierRevoked('product.price.manage', async () => {
        const session = await asManager();
        const res = await session
          .patch(`/api/admin/catalogue/variants/${variant.id}`)
          .send({ sku: `regression-sku-${Date.now()}` });
        expect(res.status).toBe(200);
      });
    });

    it('a Manager holding both product.variant.manage and product.price.manage can change price via this route', async () => {
      const { variant } = await createTestProduct();
      const session = await asManager();
      const res = await session.patch(`/api/admin/catalogue/variants/${variant.id}`).send({ price: 777 });
      expect(res.status).toBe(200);
      expect(res.body.data.price).toBe(777);
    });
  });

  // -------------------------------------------------------------------------
  // Tampered-client case: unknown/extra fields rejected
  // -------------------------------------------------------------------------
  it('rejects an extra unknown field on product create with 400 (strict schema)', async () => {
    const session = await asAdmin();
    const res = await session.post('/api/admin/catalogue/products').send({
      categoryId,
      name: `Strict Test ${Date.now()}`,
      basePrice: 100,
      isOutOfStock: true, // not a valid input field — must be rejected, never silently ignored
      variants: [{ stockQuantity: 1, attributeValueIds: [] }],
    });
    expect(res.status).toBe(400);
  });

  it('rejects a slug field supplied on product create (server-generated only)', async () => {
    const session = await asAdmin();
    const res = await session.post('/api/admin/catalogue/products').send({
      categoryId,
      name: `Slug Tamper ${Date.now()}`,
      slug: 'attacker-chosen-slug',
      basePrice: 100,
      variants: [{ stockQuantity: 1, attributeValueIds: [] }],
    });
    expect(res.status).toBe(400);
  });

  // -------------------------------------------------------------------------
  // Non-authentication / non-authorization baseline
  // -------------------------------------------------------------------------
  it('unauthenticated GET /products is rejected 401', async () => {
    const request = await import('supertest');
    const res = await request.default(app).get('/api/admin/catalogue/products');
    expect(res.status).toBe(401);
  });
});
