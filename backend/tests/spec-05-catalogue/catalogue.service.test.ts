import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.ts';
import { resetEnvCache } from '../../src/config/env.ts';

/**
 * Spec 05 — catalogue service-layer business rules (S1), tests required
 * items 6, 7, 10, 11, 12, 13.
 *
 * References: 05-admin-operations §5.1 note (Active/Inactive/Featured
 * independence, out-of-stock derivation), `seo` skill §2 (slug stability),
 * 11-security-hardening §11.6 (sanitization), §Deletion semantics (409 guards),
 * 06-rbac §5.15 rule 10 (audit on price/stock changes).
 */
const SCHEMA = 'spec05_catalogue_service';

describe.skipIf(!TEST_DATABASE_URL)('catalogue service (spec 05)', () => {
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;
  let productsService: typeof import('../../src/services/products.service.js');
  let categoriesService: typeof import('../../src/services/categories.service.js');
  let categoriesRepository: typeof import('../../src/repositories/categories.repository.js');
  let productsRepository: typeof import('../../src/repositories/products.repository.js');
  let auditRepository: typeof import('../../src/repositories/audit.repository.js');
  let usersRepository: typeof import('../../src/repositories/users.repository.js');
  let hashPassword: typeof import('../../src/lib/password.js').hashPassword;

  let adminId: string;
  let categoryId: string;
  let actor: { userId: string; role: 'ADMIN' | 'MANAGER' };

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    resetEnvCache();

    ({ resetTransactionPool } = await import('../../src/lib/transaction.js'));
    await resetTransactionPool();
    productsService = await import('../../src/services/products.service.js');
    categoriesService = await import('../../src/services/categories.service.js');
    categoriesRepository = await import('../../src/repositories/categories.repository.js');
    productsRepository = await import('../../src/repositories/products.repository.js');
    auditRepository = await import('../../src/repositories/audit.repository.js');
    usersRepository = await import('../../src/repositories/users.repository.js');
    ({ hashPassword } = await import('../../src/lib/password.js'));

    const passwordHash = await hashPassword('CatalogueTestPass12');
    adminId = (
      await usersRepository.create({
        role: 'ADMIN',
        userIdentifier: 'catalogue-service-admin',
        passwordHash,
        mustChangePassword: false,
      })
    ).id;
    actor = { userId: adminId, role: 'ADMIN' };

    const category = await categoriesRepository.create({
      name: 'Service Test Category',
      slug: 'service-test-category',
      createdBy: adminId,
    });
    categoryId = category.id;
  }, 60_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  function uniqueName(base: string): string {
    return `${base} ${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  // -------------------------------------------------------------------------
  // Test 6: out-of-stock is derived, never stored
  // -------------------------------------------------------------------------
  it('reports isOutOfStock true when all variants are at zero stock, with no status write (test 6, acceptance 6)', async () => {
    const product = await productsService.createProduct(actor, {
      categoryId,
      name: uniqueName('Zero Stock Product'),
      basePrice: 100,
      variants: [{ stockQuantity: 0, attributeValueIds: [] }],
    });

    expect(product.totalStock).toBe(0);
    expect(product.isOutOfStock).toBe(true);
    expect(product.status).toBe('INACTIVE'); // unaffected by stock — separate field
  });

  it('flips isOutOfStock to false purely from restocking one variant, with no status write (test 6, acceptance 7)', async () => {
    const product = await productsService.createProduct(actor, {
      categoryId,
      name: uniqueName('Restockable Product'),
      basePrice: 100,
      isFeatured: true,
      variants: [{ stockQuantity: 0, attributeValueIds: [] }],
    });
    expect(product.isOutOfStock).toBe(true);
    const statusBefore = product.status;
    const featuredBefore = product.isFeatured;

    const variantId = product.variants[0]!.id;
    const restocked = await productsService.adjustStock(actor, variantId, 5, 'restock test');
    expect(restocked.stockQuantity).toBe(5);

    const refreshed = await productsService.getProduct(product.id);
    expect(refreshed.isOutOfStock).toBe(false);
    expect(refreshed.totalStock).toBe(5);
    // status and isFeatured are untouched by the stock change
    expect(refreshed.status).toBe(statusBefore);
    expect(refreshed.isFeatured).toBe(featuredBefore);
  });

  // -------------------------------------------------------------------------
  // Test 7: Active/Inactive x Featured are fully independent
  // -------------------------------------------------------------------------
  it.each([
    ['ACTIVE', true],
    ['ACTIVE', false],
    ['INACTIVE', true],
    ['INACTIVE', false],
  ] as const)('stores status=%s, isFeatured=%s as an independent combination (test 7)', async (status, isFeatured) => {
    const product = await productsService.createProduct(actor, {
      categoryId,
      name: uniqueName(`Combo ${status} ${isFeatured}`),
      basePrice: 100,
      isFeatured,
      variants: [{ stockQuantity: 1, attributeValueIds: [] }],
    });

    const withStatus = await productsService.updateVisibility(actor, product.id, { status });

    expect(withStatus.status).toBe(status);
    expect(withStatus.isFeatured).toBe(isFeatured);
  });

  it('setting isFeatured: true on an INACTIVE product succeeds (acceptance 5)', async () => {
    const product = await productsService.createProduct(actor, {
      categoryId,
      name: uniqueName('Inactive Featured'),
      basePrice: 100,
      variants: [{ stockQuantity: 1, attributeValueIds: [] }],
    });
    expect(product.status).toBe('INACTIVE');

    const updated = await productsService.updateProduct(actor, product.id, { isFeatured: true });
    expect(updated.isFeatured).toBe(true);
    expect(updated.status).toBe('INACTIVE');
  });

  // -------------------------------------------------------------------------
  // Test 10: slug stability and uniqueness
  // -------------------------------------------------------------------------
  it('does not change the slug on a plain rename (test 10, seo skill §2)', async () => {
    const name = uniqueName('Stable Slug Product');
    const product = await productsService.createProduct(actor, {
      categoryId,
      name,
      basePrice: 100,
      variants: [{ stockQuantity: 1, attributeValueIds: [] }],
    });
    const originalSlug = product.slug;

    const renamed = await productsService.updateProduct(actor, product.id, {
      name: `${name} Renamed`,
    });
    expect(renamed.slug).toBe(originalSlug);
  });

  it('assigns a distinct -2 slug when two products share the same name (test 10)', async () => {
    const name = `Collision Product ${Date.now()}`;
    const first = await productsService.createProduct(actor, {
      categoryId,
      name,
      basePrice: 100,
      variants: [{ stockQuantity: 1, attributeValueIds: [] }],
    });
    const second = await productsService.createProduct(actor, {
      categoryId,
      name,
      basePrice: 100,
      variants: [{ stockQuantity: 1, attributeValueIds: [] }],
    });

    expect(second.slug).not.toBe(first.slug);
    expect(second.slug).toBe(`${first.slug}-2`);
  });

  it('resolves concurrent same-name creates to distinct slugs (test 10)', async () => {
    const name = `Concurrent Collision ${Date.now()}`;
    const attempts = Array.from({ length: 4 }, () =>
      productsService.createProduct(actor, {
        categoryId,
        name,
        basePrice: 100,
        variants: [{ stockQuantity: 1, attributeValueIds: [] }],
      }),
    );
    const results = await Promise.all(attempts);
    const slugs = results.map((r) => r.slug);
    expect(new Set(slugs).size).toBe(slugs.length); // all distinct
  });

  // -------------------------------------------------------------------------
  // Test 11: description sanitization
  // -------------------------------------------------------------------------
  it('strips <script> tags from a product description before storage (test 11, acceptance 17)', async () => {
    const product = await productsService.createProduct(actor, {
      categoryId,
      name: uniqueName('Sanitize Product'),
      description: '<p>Hello</p><script>alert(1)</script>',
      basePrice: 100,
      variants: [{ stockQuantity: 1, attributeValueIds: [] }],
    });

    expect(product.description).not.toContain('<script>');
    expect(product.description).not.toContain('alert(1)');
    expect(product.description).toContain('Hello');
  });

  it('strips event-handler attributes from a product description before storage (test 11)', async () => {
    const product = await productsService.createProduct(actor, {
      categoryId,
      name: uniqueName('Sanitize Handler Product'),
      description: '<p onclick="alert(2)">Click</p>',
      basePrice: 100,
      variants: [{ stockQuantity: 1, attributeValueIds: [] }],
    });

    expect(product.description).not.toContain('onclick');
    expect(product.description).not.toContain('alert(2)');
  });

  // Regression: categories.service.ts originally never called sanitizeHtml on
  // `description` (create or update) — only products.service.ts did. A
  // <script> payload was stored verbatim, a stored-XSS hole in the category
  // description field. Fixed by wiring the same sanitizeHtml call
  // products.service.ts already used.
  it('strips <script> tags from a category description on create (test 11, regression: category stored-XSS)', async () => {
    const category = await categoriesService.createCategory(actor, {
      name: uniqueName('Sanitize Category'),
      description: '<script>alert(3)</script><p>Safe</p>',
    });
    expect(category.description).not.toContain('<script>');
    expect(category.description).not.toContain('alert(3)');
    expect(category.description).toContain('Safe');
  });

  it('strips event-handler attributes from a category description on create (regression: category stored-XSS)', async () => {
    const category = await categoriesService.createCategory(actor, {
      name: uniqueName('Sanitize Category Handler'),
      description: '<p onclick="alert(4)">Click</p>',
    });
    expect(category.description).not.toContain('onclick');
    expect(category.description).not.toContain('alert(4)');
  });

  it('strips <script> tags from a category description on update (regression: category stored-XSS)', async () => {
    const category = await categoriesService.createCategory(actor, {
      name: uniqueName('Sanitize Category Update'),
      description: 'Original safe text',
    });

    const updated = await categoriesService.updateCategory(actor, category.id, {
      description: '<script>alert(5)</script><p>Updated</p>',
    });
    expect(updated.description).not.toContain('<script>');
    expect(updated.description).not.toContain('alert(5)');
    expect(updated.description).toContain('Updated');
  });

  // -------------------------------------------------------------------------
  // Test 12: deletion guards
  // -------------------------------------------------------------------------
  it('rejects deleting a category that contains products with 409 CATEGORY_NOT_EMPTY (test 12, acceptance 15)', async () => {
    const category = await categoriesService.createCategory(actor, {
      name: uniqueName('Non-empty Category'),
    });
    await productsService.createProduct(actor, {
      categoryId: category.id,
      name: uniqueName('Child Product'),
      basePrice: 50,
      variants: [{ stockQuantity: 1, attributeValueIds: [] }],
    });

    await expect(categoriesService.deleteCategory(actor, category.id)).rejects.toMatchObject({
      status: 409,
      code: 'CATEGORY_NOT_EMPTY',
    });
  });

  it('rejects deleting a category that has a child category with 409 CATEGORY_NOT_EMPTY (test 12)', async () => {
    const parent = await categoriesService.createCategory(actor, {
      name: uniqueName('Parent Category'),
    });
    await categoriesService.createCategory(actor, {
      name: uniqueName('Child Category'),
      parentId: parent.id,
    });

    await expect(categoriesService.deleteCategory(actor, parent.id)).rejects.toMatchObject({
      status: 409,
      code: 'CATEGORY_NOT_EMPTY',
    });
  });

  it('allows deleting an empty category', async () => {
    const category = await categoriesService.createCategory(actor, {
      name: uniqueName('Empty Category'),
    });
    await expect(categoriesService.deleteCategory(actor, category.id)).resolves.toBeUndefined();
  });

  it('two variants of one product with the same attribute-value combination is rejected with 409 (acceptance 16)', async () => {
    const productAttributesRepository = await import('../../src/repositories/productAttributes.repository.js');
    const attribute = await productAttributesRepository.create({ type: 'SIZE', name: 'Test Size' });
    const value = await productAttributesRepository.createValue({ attributeId: attribute.id, value: 'M-unique' });

    const product = await productsService.createProduct(actor, {
      categoryId,
      name: uniqueName('Combination Product'),
      basePrice: 100,
      variants: [{ stockQuantity: 1, attributeValueIds: [value.id] }],
    });

    await expect(
      productsService.createVariant(actor, product.id, { stockQuantity: 1, attributeValueIds: [value.id] }),
    ).rejects.toMatchObject({ status: 409, code: 'VARIANT_COMBINATION_EXISTS' });
  });

  // -------------------------------------------------------------------------
  // Test 13: audit on stock and price changes
  // -------------------------------------------------------------------------
  it('writes an audit row with actor, previous and new value, and reason on a manual stock adjustment (test 13, acceptance 13-adjacent)', async () => {
    const product = await productsService.createProduct(actor, {
      categoryId,
      name: uniqueName('Audit Stock Product'),
      basePrice: 100,
      variants: [{ stockQuantity: 3, attributeValueIds: [] }],
    });
    const variantId = product.variants[0]!.id;

    await productsService.adjustStock(actor, variantId, 9, 'Stock count correction');

    const { items } = await auditRepository.listForEntity('product_variant', variantId, {
      page: 1,
      pageSize: 10,
    });
    const entry = items.find((i) => i.action === 'stock_adjust');
    expect(entry).toBeDefined();
    expect(entry!.previousValue).toMatchObject({ stockQuantity: 3 });
    expect(entry!.newValue).toMatchObject({ stockQuantity: 9 });
    expect(entry!.reason).toBe('Stock count correction');
    expect(entry!.actorUserId).toBe(adminId);
  });

  it('writes an audit row with actor, previous and new value on a price change (test 13)', async () => {
    const product = await productsService.createProduct(actor, {
      categoryId,
      name: uniqueName('Audit Price Product'),
      basePrice: 100,
      compareAtPrice: 150,
      variants: [{ stockQuantity: 1, attributeValueIds: [] }],
    });

    await productsService.updatePrice(actor, product.id, { basePrice: 120, compareAtPrice: 160 });

    const { items } = await auditRepository.listForEntity('product', product.id, { page: 1, pageSize: 10 });
    const entry = items.find((i) => i.action === 'price_updated');
    expect(entry).toBeDefined();
    expect(entry!.previousValue).toMatchObject({ basePrice: 100, compareAtPrice: 150 });
    expect(entry!.newValue).toMatchObject({ basePrice: 120, compareAtPrice: 160 });
    expect(entry!.actorUserId).toBe(adminId);
  });
});
