import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.js';

/** Spec 13 — manual product selection (§13.6): order respected, Inactive excluded, out-of-stock included with the badge, any Featured status selectable. */
const SCHEMA = 'spec13_manual_selection';

describe.skipIf(!TEST_DATABASE_URL)('resolveManualProducts (13-homepage-cms §13.6)', () => {
  let resolveManualProducts: typeof import('../../src/services/homepageCms/productResolution.js').resolveManualProducts;
  let homepageSectionsRepository: typeof import('../../src/repositories/homepageSections.repository.js');
  let homepageSectionProductsRepository: typeof import('../../src/repositories/homepageSectionProducts.repository.js');
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;
  let withTransactionFn: typeof import('../../src/lib/transaction.js').withTransaction;
  let usersRepository: typeof import('../../src/repositories/users.repository.js');
  let hashPassword: typeof import('../../src/lib/password.js').hashPassword;
  let categoryId: string;
  let adminId: string;
  let sectionId: string;

  async function insertProduct(overrides: {
    name: string;
    status: 'ACTIVE' | 'INACTIVE';
    isFeatured?: boolean;
    stockQuantity?: number;
  }): Promise<string> {
    return withTransactionFn(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO products (category_id, name, slug, base_price, status, is_featured)
         VALUES ($1,$2,$3,100,$4,$5) RETURNING id`,
        [
          categoryId,
          overrides.name,
          `${overrides.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
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
    ({ resolveManualProducts } = await import('../../src/services/homepageCms/productResolution.js'));
    homepageSectionsRepository = await import('../../src/repositories/homepageSections.repository.js');
    homepageSectionProductsRepository = await import('../../src/repositories/homepageSectionProducts.repository.js');
    usersRepository = await import('../../src/repositories/users.repository.js');
    ({ hashPassword } = await import('../../src/lib/password.js'));

    const passwordHash = await hashPassword('ManualSelectPass12');
    adminId = (
      await usersRepository.create({ role: 'ADMIN', userIdentifier: 'manual-select-admin', passwordHash, mustChangePassword: false })
    ).id;

    const { rows } = await withTransactionFn((client) =>
      client.query<{ id: string }>(`INSERT INTO categories (name, slug) VALUES ('Manual Cat', 'manual-cat-${Date.now()}') RETURNING id`),
    );
    categoryId = rows[0]!.id;

    const section = await homepageSectionsRepository.create({
      sectionType: 'PRODUCT_CAROUSEL',
      contentConfig: { mode: 'MANUAL' },
      displayOrder: 0,
      createdBy: adminId,
    });
    sectionId = section.id;
  }, 60_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  it('respects the join table order, excludes Inactive, includes out-of-stock with the badge, and includes non-Featured products', async () => {
    const first = await insertProduct({ name: 'Manual First', status: 'ACTIVE', isFeatured: false });
    const second = await insertProduct({ name: 'Manual Second Out Of Stock', status: 'ACTIVE', stockQuantity: 0 });
    const inactive = await insertProduct({ name: 'Manual Inactive', status: 'INACTIVE' });

    await withTransactionFn((client) => homepageSectionProductsRepository.replaceAll(sectionId, [first, second, inactive], client));

    const result = await resolveManualProducts(sectionId);
    const ids = result.map((p) => p.id);

    expect(ids).toEqual([first, second]);
    expect(ids).not.toContain(inactive);

    const outOfStockEntry = result.find((p) => p.id === second);
    expect(outOfStockEntry?.outOfStock).toBe(true);
  });
});
