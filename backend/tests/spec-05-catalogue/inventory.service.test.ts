import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from './helpers/schemaFixture.js';
import { resetEnvCache } from '../src/config/env.js';

/**
 * Spec 05 — inventory primitives (`services/inventory.service.ts`), tests
 * required items 1, 2, 3, 4, 15 (05-admin-operations §5.1 "Stock decrement
 * concurrency" / "Stock restoration rule").
 *
 * These are the items the spec 05 implementation plan §10 flags as needing a
 * real database: the atomic check-and-decrement, the deadlock-free lock
 * ordering, and the all-or-nothing multi-line behaviour cannot be observed
 * against a mocked data layer — the claim IS what Postgres does under
 * concurrent conditional UPDATEs.
 */
const SCHEMA = 'spec05_inventory';

describe.skipIf(!TEST_DATABASE_URL)('inventory.service (05-admin-operations §5.1)', () => {
  let withTransaction: typeof import('../src/lib/transaction.js').withTransaction;
  let resetTransactionPool: typeof import('../src/lib/transaction.js').resetTransactionPool;
  let inventoryService: typeof import('../src/services/inventory.service.js');
  let categoriesRepository: typeof import('../src/repositories/categories.repository.js');
  let productsRepository: typeof import('../src/repositories/products.repository.js');
  let productVariantsRepository: typeof import('../src/repositories/productVariants.repository.js');
  let auditRepository: typeof import('../src/repositories/audit.repository.js');
  let usersRepository: typeof import('../src/repositories/users.repository.js');
  let hashPassword: typeof import('../src/lib/password.js').hashPassword;

  let adminId: string;
  let categoryId: string;

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    resetEnvCache();

    ({ withTransaction, resetTransactionPool } = await import('../src/lib/transaction.js'));
    await resetTransactionPool();
    inventoryService = await import('../src/services/inventory.service.js');
    categoriesRepository = await import('../src/repositories/categories.repository.js');
    productsRepository = await import('../src/repositories/products.repository.js');
    productVariantsRepository = await import('../src/repositories/productVariants.repository.js');
    auditRepository = await import('../src/repositories/audit.repository.js');
    usersRepository = await import('../src/repositories/users.repository.js');
    ({ hashPassword } = await import('../src/lib/password.js'));

    const passwordHash = await hashPassword('InventoryTestPass12');
    adminId = (
      await usersRepository.create({
        role: 'ADMIN',
        userIdentifier: 'inventory-admin',
        passwordHash,
        mustChangePassword: false,
      })
    ).id;

    const category = await categoriesRepository.create({
      name: 'Inventory Test Category',
      slug: 'inventory-test-category',
      createdBy: adminId,
    });
    categoryId = category.id;
  }, 60_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  /** Fresh product with N variants at the given starting stock quantities. */
  async function createVariants(stockQuantities: number[]): Promise<string[]> {
    const product = await productsRepository.create({
      categoryId,
      name: `Variant Fixture ${Date.now()}-${Math.random()}`,
      slug: `variant-fixture-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      basePrice: 500,
      createdBy: adminId,
    });
    const ids: string[] = [];
    for (const stockQuantity of stockQuantities) {
      const variant = await productVariantsRepository.create({
        productId: product.id,
        stockQuantity,
      });
      ids.push(variant.id);
    }
    return ids;
  }

  async function getStock(variantId: string): Promise<number> {
    const variant = await productVariantsRepository.findById(variantId);
    return variant!.stockQuantity;
  }

  // -------------------------------------------------------------------------
  // Test 1: atomic decrement under concurrency
  // -------------------------------------------------------------------------
  it('exactly one of two concurrent decrements of the last unit succeeds, and stock never goes negative (test 1)', async () => {
    const [variantId] = await createVariants([1]);

    const attempt = () =>
      withTransaction((client) =>
        inventoryService.decrementStock(client, [{ variantId: variantId!, quantity: 1 }], {
          orderId: `order-${Math.random()}`,
          actorUserId: adminId,
        }),
      );

    const [resultA, resultB] = await Promise.all([attempt(), attempt()]);
    const results = [resultA, resultB];

    const successes = results.filter((r) => r.ok);
    const failures = results.filter((r) => !r.ok);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    const finalStock = await getStock(variantId!);
    expect(finalStock).toBe(0);
    expect(finalStock).toBeGreaterThanOrEqual(0);
  });

  // -------------------------------------------------------------------------
  // Test 2: insufficient stock fails cleanly
  // -------------------------------------------------------------------------
  it('reports the shortfall and writes nothing when stock is insufficient (test 2)', async () => {
    const [variantId] = await createVariants([2]);

    const result = await withTransaction((client) =>
      inventoryService.decrementStock(client, [{ variantId: variantId!, quantity: 3 }], {
        orderId: 'order-insufficient',
        actorUserId: adminId,
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.insufficient).toEqual([{ variantId, available: 2, requested: 3 }]);
    }

    const finalStock = await getStock(variantId!);
    expect(finalStock).toBe(2); // unchanged
  });

  // -------------------------------------------------------------------------
  // Test 3: multi-line all-or-nothing
  // -------------------------------------------------------------------------
  it('a partially-satisfiable multi-line decrement leaves both quantities unchanged (test 3)', async () => {
    const [variantA, variantB] = await createVariants([10, 1]);

    // Per spec 05 §Stock primitives: decrementStock never opens or rolls back
    // its own transaction ("Both functions must be called INSIDE a
    // caller-provided transaction; they never open their own"). On `ok:
    // false` it is the CALLER's job to abort the enclosing transaction — the
    // contract this test exercises, exactly as spec 12's real caller must.
    let result: Awaited<ReturnType<typeof inventoryService.decrementStock>> | undefined;
    await expect(
      withTransaction(async (client) => {
        result = await inventoryService.decrementStock(
          client,
          [
            { variantId: variantA!, quantity: 3 },
            { variantId: variantB!, quantity: 5 }, // only 1 available
          ],
          { orderId: 'order-multiline', actorUserId: adminId },
        );
        if (!result.ok) {
          throw new Error('insufficient stock — caller aborts the transaction');
        }
      }),
    ).rejects.toThrow('insufficient stock');

    expect(result!.ok).toBe(false);

    const stockA = await getStock(variantA!);
    const stockB = await getStock(variantB!);
    expect(stockA).toBe(10); // unchanged — line A must not partially decrement
    expect(stockB).toBe(1); // unchanged
  });

  // -------------------------------------------------------------------------
  // Test 4: restore round-trips exactly, and audits
  // -------------------------------------------------------------------------
  it('restoreStock round-trips a prior decrement back to the original quantity, with an audit row (test 4, test 13 restore half)', async () => {
    const [variantId] = await createVariants([5]);

    await withTransaction((client) =>
      inventoryService.decrementStock(client, [{ variantId: variantId!, quantity: 3 }], {
        orderId: 'order-roundtrip',
        actorUserId: adminId,
      }),
    );
    expect(await getStock(variantId!)).toBe(2);

    await withTransaction((client) =>
      inventoryService.restoreStock(client, [{ variantId: variantId!, quantity: 3 }], {
        orderId: 'order-roundtrip',
        reason: 'order cancelled',
        actorUserId: adminId,
      }),
    );
    expect(await getStock(variantId!)).toBe(5); // back to original

    const { items } = await auditRepository.listForEntity('product_variant', variantId!, {
      page: 1,
      pageSize: 20,
    });
    const restoreEntry = items.find((entry) => entry.action === 'stock_restore');
    expect(restoreEntry).toBeDefined();
    expect(restoreEntry!.previousValue).toMatchObject({ stockQuantity: 2 });
    expect(restoreEntry!.newValue).toMatchObject({ stockQuantity: 5 });
    expect(restoreEntry!.reason).toBe('order cancelled');

    const decrementEntry = items.find((entry) => entry.action === 'stock_decrement');
    expect(decrementEntry).toBeDefined();
    expect(decrementEntry!.previousValue).toMatchObject({ stockQuantity: 5 });
    expect(decrementEntry!.newValue).toMatchObject({ stockQuantity: 2 });
  });

  // -------------------------------------------------------------------------
  // Test 15: deadlock-free lock ordering
  // -------------------------------------------------------------------------
  it('two concurrent decrementStock calls on the same two variants in opposite order complete with no SQLSTATE 40P01 (test 15)', async () => {
    const [variantLow, variantHigh] = (await createVariants([50, 50])).sort();
    // sort() above guarantees variantLow < variantHigh lexically, matching the
    // service's own sortedByVariantId — but we deliberately pass items to the
    // SERVICE in opposite order per call, which is the scenario that would
    // deadlock if the internal sort were ever removed.

    const callA = () =>
      withTransaction((client) =>
        inventoryService.decrementStock(
          client,
          [
            { variantId: variantLow!, quantity: 1 },
            { variantId: variantHigh!, quantity: 1 },
          ],
          { orderId: 'order-deadlock-a', actorUserId: adminId },
        ),
      );
    const callB = () =>
      withTransaction((client) =>
        inventoryService.decrementStock(
          client,
          [
            { variantId: variantHigh!, quantity: 1 },
            { variantId: variantLow!, quantity: 1 },
          ],
          { orderId: 'order-deadlock-b', actorUserId: adminId },
        ),
      );

    // Fire many repetitions concurrently to make a deadlock likely to surface
    // if lock ordering were broken — a single pair can succeed by luck.
    const rounds = 8;
    const outcomes = await Promise.all(
      Array.from({ length: rounds }, () => Promise.all([callA(), callB()])),
    );

    for (const [resultA, resultB] of outcomes) {
      // Neither call may reject (a deadlock, if it escaped the retry, throws).
      expect(resultA).toBeDefined();
      expect(resultB).toBeDefined();
    }

    const finalLow = await getStock(variantLow!);
    const finalHigh = await getStock(variantHigh!);
    expect(finalLow).toBe(50 - rounds * 2);
    expect(finalHigh).toBe(50 - rounds * 2);
    expect(finalLow).toBeGreaterThanOrEqual(0);
    expect(finalHigh).toBeGreaterThanOrEqual(0);
  }, 30_000);
});
