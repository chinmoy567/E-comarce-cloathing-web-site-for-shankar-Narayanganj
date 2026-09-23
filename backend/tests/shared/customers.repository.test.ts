import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  SAMPLE_CUSTOMER,
  TEST_DATABASE_URL,
  dropSchema,
  resetSchema,
  scopedUrl,
} from '../helpers/schemaFixture.ts';
import { resetEnvCache } from '../../src/config/env.ts';

/**
 * Spec 02 acceptance 10, test 3 — one customer record per phone number.
 *
 * This is the rule that makes guest order history, risk-check caching, and
 * per-customer coupon limits coherent: if two concurrent guest checkouts from
 * one number could create two rows, all three features would silently split
 * one person into two identities. A mock cannot test it — the guarantee is the
 * unique constraint plus a real upsert, under real concurrency.
 */
const SCHEMA = 'spec02_customers_repo';

describe.skipIf(!TEST_DATABASE_URL)('customers repository', () => {
  let repo: typeof import('../../src/repositories/customers.repository.js');
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    resetEnvCache();

    ({ resetTransactionPool } = await import('../../src/lib/transaction.js'));
    await resetTransactionPool();
    repo = await import('../../src/repositories/customers.repository.js');
  }, 60_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  beforeEach(async () => {
    const { withTransaction } = await import('../../src/lib/transaction.js');
    await withTransaction(async (c) => {
      await c.query('DELETE FROM customers');
    });
  });

  describe('upsertByPhoneNumber (acceptance 10)', () => {
    it('creates exactly one row under concurrent calls with the same number', async () => {
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          repo.upsertByPhoneNumber({ ...SAMPLE_CUSTOMER, fullName: `Caller ${i}` }),
        ),
      );

      const ids = new Set(results.map((r) => r.id));
      expect(ids.size).toBe(1);

      const { items, total } = await repo.list({ page: 1, pageSize: 20 });
      expect(total).toBe(1);
      expect(items).toHaveLength(1);
    }, 30_000);

    it('reuses the row regardless of which phone format the caller passes', async () => {
      const a = await repo.upsertByPhoneNumber(SAMPLE_CUSTOMER);
      const b = await repo.upsertByPhoneNumber({
        ...SAMPLE_CUSTOMER,
        phoneNumber: '+8801712345678',
      });
      const c = await repo.upsertByPhoneNumber({
        ...SAMPLE_CUSTOMER,
        phoneNumber: '8801712345678',
      });

      expect(b.id).toBe(a.id);
      expect(c.id).toBe(a.id);
      expect(a.phoneNumber).toBe('01712345678');
    });

    it('refreshes the stored details on reuse', async () => {
      await repo.upsertByPhoneNumber(SAMPLE_CUSTOMER);
      const updated = await repo.upsertByPhoneNumber({
        ...SAMPLE_CUSTOMER,
        fullName: 'New Name',
        address: { ...SAMPLE_CUSTOMER.address, detailedAddress: 'House 9, Road 4' },
      });

      expect(updated.fullName).toBe('New Name');
      expect(updated.address.detailedAddress).toBe('House 9, Road 4');
    });

    it('never downgrades a REGISTERED record to GUEST', async () => {
      const created = await repo.upsertByPhoneNumber(SAMPLE_CUSTOMER, 'REGISTERED');
      expect(created.accountType).toBe('REGISTERED');

      // The same person later checks out as a guest.
      const afterGuestCheckout = await repo.upsertByPhoneNumber(SAMPLE_CUSTOMER, 'GUEST');
      expect(afterGuestCheckout.accountType).toBe('REGISTERED');
      expect(afterGuestCheckout.id).toBe(created.id);
    });
  });

  describe('lookups', () => {
    it('finds a record by any accepted phone format', async () => {
      const created = await repo.upsertByPhoneNumber(SAMPLE_CUSTOMER);
      await expect(repo.findByPhoneNumber('+8801712345678')).resolves.toMatchObject({
        id: created.id,
      });
      await expect(repo.findById(created.id)).resolves.toMatchObject({ id: created.id });
    });

    it('returns null for an unknown number', async () => {
      await expect(repo.findByPhoneNumber('01999999999')).resolves.toBeNull();
    });
  });

  describe('createGuestReference', () => {
    it('conflicts with CUSTOMER_PHONE_EXISTS on a known number', async () => {
      await repo.createGuestReference(SAMPLE_CUSTOMER);
      await expect(repo.createGuestReference(SAMPLE_CUSTOMER)).rejects.toMatchObject({
        code: 'CUSTOMER_PHONE_EXISTS',
        status: 409,
      });
    });
  });

  describe('address round-trip (test 8)', () => {
    it('preserves both naming conventions exactly as stored', async () => {
      const urban = await repo.upsertByPhoneNumber(SAMPLE_CUSTOMER);
      expect(urban.address.areaUnitType).toBe('THANA');
      expect(urban.address.wardUnitType).toBe('WARD');

      const rural = await repo.upsertByPhoneNumber({
        fullName: 'Rural Customer',
        phoneNumber: '01912345678',
        address: {
          division: 'Khulna',
          district: 'Jessore',
          areaUnitType: 'UPAZILA',
          areaUnitName: 'Abhaynagar',
          wardUnitType: 'UNION',
          wardUnitName: 'Prembag',
          detailedAddress: 'Village road',
          postalCode: null,
        },
      });
      expect(rural.address.areaUnitType).toBe('UPAZILA');
      expect(rural.address.wardUnitType).toBe('UNION');
      expect(rural.address.postalCode).toBeNull();
    });
  });

  describe('promoteToRegistered (§2.9.8)', () => {
    it('flips the account type in place, keeping the same row', async () => {
      const guest = await repo.upsertByPhoneNumber(SAMPLE_CUSTOMER);
      expect(guest.accountType).toBe('GUEST');

      const promoted = await repo.promoteToRegistered(guest.id);
      expect(promoted).toMatchObject({ id: guest.id, accountType: 'REGISTERED' });
    });
  });
});
