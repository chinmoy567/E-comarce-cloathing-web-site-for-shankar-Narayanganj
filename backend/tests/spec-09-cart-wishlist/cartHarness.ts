import type { Express } from 'express';
import { dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.js';
import { applyTestEnv } from '../helpers/testEnv.js';
import { resetEnvCache } from '../../src/config/env.js';

/** Shared setup for the spec 09 suites: a disposable migrated schema, the app, and a seeded catalogue. */
export type CartHarness = {
  app: Express;
  withTransaction: typeof import('../../src/lib/transaction.js').withTransaction;
  resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;
  catalogue: { productId: string; variantId: string; variantNoPriceId: string; categoryId: string };
  teardown: () => Promise<void>;
};

export async function setupCartHarness(schema: string): Promise<CartHarness> {
  await resetSchema(schema);
  applyTestEnv();
  process.env.DATABASE_URL = scopedUrl(schema);
  process.env.RL_PUBLIC_CEILING_MAX = '100000';
  process.env.RL_AUTHENTICATED_CEILING_MAX = '100000';
  process.env.RL_REGISTRATION_MAX = '100000';
  process.env.RL_CUSTOMER_LOGIN_MAX = '100000';
  resetEnvCache();

  const { withTransaction, resetTransactionPool } = await import('../../src/lib/transaction.js');
  await resetTransactionPool();
  const { createApp } = await import('../../src/app.js');
  const app = createApp();

  const catalogue = await withTransaction(async (client) => {
    const cat = await client.query<{ id: string }>(
      `INSERT INTO categories (name, slug, status) VALUES ('Cart Cat','cart-cat','ACTIVE') RETURNING id`,
    );
    const prod = await client.query<{ id: string }>(
      `INSERT INTO products (category_id, name, slug, base_price, status)
       VALUES ($1, 'Cart Product', 'cart-product', 100.10, 'ACTIVE') RETURNING id`,
      [cat.rows[0]!.id],
    );
    // Own price (decimal that rounds badly in floats) and a variant that falls back to base_price.
    const v1 = await client.query<{ id: string }>(
      `INSERT INTO product_variants (product_id, sku, price, stock_quantity, is_active)
       VALUES ($1, 'CART-V1', 33.33, 50, true) RETURNING id`,
      [prod.rows[0]!.id],
    );
    const v2 = await client.query<{ id: string }>(
      `INSERT INTO product_variants (product_id, sku, price, stock_quantity, is_active)
       VALUES ($1, 'CART-V2', NULL, 1, true) RETURNING id`,
      [prod.rows[0]!.id],
    );
    return {
      categoryId: cat.rows[0]!.id,
      productId: prod.rows[0]!.id,
      variantId: v1.rows[0]!.id,
      variantNoPriceId: v2.rows[0]!.id,
    };
  });

  return {
    app,
    withTransaction,
    resetTransactionPool,
    catalogue,
    teardown: async () => {
      await resetTransactionPool();
      await dropSchema(schema);
    },
  };
}

let phoneCounter = 0;
export function nextPhone(): string {
  phoneCounter += 1;
  return `0171${String(5000000 + phoneCounter + Math.floor(Math.random() * 1000) * 1000)}`.slice(0, 11);
}
