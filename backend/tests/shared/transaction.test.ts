import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.ts';
import { resetEnvCache } from '../../src/config/env.ts';

/**
 * Spec 02 acceptance 12, test 10 — `withTransaction` rolls back completely.
 *
 * Every later atomic rule depends on this one helper — order creation, stock
 * decrement, coupon usage, the shipment/order cascade — so it is tested once
 * here rather than re-proved per feature.
 *
 * The helper builds its pool from `getEnv().DATABASE_URL`, so the env is
 * pointed at the disposable schema BEFORE the module is imported.
 */
const SCHEMA = 'spec02_transaction';

describe.skipIf(!TEST_DATABASE_URL)('withTransaction (acceptance 12)', () => {
  let withTransaction: typeof import('../../src/lib/transaction.js').withTransaction;
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;

  beforeAll(async () => {
    await resetSchema(SCHEMA);

    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    resetEnvCache();

    const mod = await import('../../src/lib/transaction.js');
    withTransaction = mod.withTransaction;
    resetTransactionPool = mod.resetTransactionPool;
    await resetTransactionPool();
  }, 60_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  const countCustomers = async (): Promise<number> =>
    withTransaction(async (c) => {
      const { rows } = await c.query<{ n: string }>('SELECT count(*)::text AS n FROM customers');
      return Number(rows[0]!.n);
    });

  const insertCustomer = async (client: import('pg').PoolClient, phone: string): Promise<void> => {
    await client.query(
      `INSERT INTO customers (
         full_name, phone_number, division, district,
         area_unit_type, area_unit_name, ward_unit_type, ward_unit_name, detailed_address
       ) VALUES ('Rollback Test', $1, 'Dhaka','Dhaka','THANA','Gulshan','WARD','Ward 19','House 1')`,
      [phone],
    );
  };

  it('commits when the callback resolves', async () => {
    const before = await countCustomers();
    await withTransaction(async (c) => insertCustomer(c, '01711111111'));
    expect(await countCustomers()).toBe(before + 1);
  });

  it('rolls back every statement when the callback throws', async () => {
    const before = await countCustomers();

    await expect(
      withTransaction(async (c) => {
        await insertCustomer(c, '01722222222');
        throw new Error('deliberate failure');
      }),
    ).rejects.toThrow('deliberate failure');

    expect(await countCustomers()).toBe(before);
  });

  it('rolls back ALL statements, not only the one that failed', async () => {
    const before = await countCustomers();

    await expect(
      withTransaction(async (c) => {
        await insertCustomer(c, '01733333333');
        await insertCustomer(c, '01744444444');
        // Duplicate — the database rejects it and the whole unit unwinds.
        await insertCustomer(c, '01733333333');
      }),
    ).rejects.toThrow(/customers_phone_number_key/);

    expect(await countCustomers()).toBe(before);
  });

  it('rethrows the original error rather than a rollback failure', async () => {
    const sentinel = new Error('caller error survives');
    await expect(
      withTransaction(async () => {
        throw sentinel;
      }),
    ).rejects.toBe(sentinel);
  });

  it('returns the callback result to the caller', async () => {
    await expect(withTransaction(async () => 'result')).resolves.toBe('result');
  });

  it('releases the connection, so the pool is not exhausted by repeated failures', async () => {
    // More iterations than PG_POOL_MAX: a leaked connection would hang here.
    for (let i = 0; i < 15; i += 1) {
      await expect(
        withTransaction(async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
    }
    await expect(countCustomers()).resolves.toBeGreaterThanOrEqual(0);
  }, 30_000);
});
