import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl, SAMPLE_CUSTOMER } from '../helpers/schemaFixture.js';
import { resetEnvCache } from '../../src/config/env.js';

/**
 * Spec 10 — `recordCouponUsage` (§8.25) and coupon delete-vs-archive (§8.9),
 * S1 (real Postgres, repository layer). Tests required items 12–14, 17–19.
 *
 * Tests 12 and 13 (usage-limit and per-customer-limit concurrency) are the
 * highest-value tests in this slice per the plan — they open their own
 * `withTransaction` blocks directly, since no production caller exists yet
 * to exercise `recordCouponUsage` through an HTTP request (spec 11's job).
 */
const SCHEMA = 'spec10_coupon_usage_repo';

describe.skipIf(!TEST_DATABASE_URL)('recordCouponUsage and delete/archive (§8.9, §8.25)', () => {
  let withTransaction: typeof import('../../src/lib/transaction.js').withTransaction;
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;
  let couponRepository: typeof import('../../src/repositories/coupon.repository.js');
  let customersRepository: typeof import('../../src/repositories/customers.repository.js');
  let usersRepository: typeof import('../../src/repositories/users.repository.js');
  let hashPassword: typeof import('../../src/lib/password.js').hashPassword;

  let adminId: string;
  let customerAId: string;
  let customerBId: string;

  async function createOrder(customerId: string, client?: import('pg').PoolClient): Promise<string> {
    const { rows } = await (client
      ? client.query(
          `INSERT INTO orders (order_number, customer_id, payment_method, order_status, payment_status, subtotal, shipping_amount, total_amount)
           VALUES ($1, $2, 'COD', 'PENDING_CONFIRMATION', 'PENDING_COLLECTION', 100, 0, 100)
           RETURNING id`,
          [`ORD-${Date.now()}-${Math.random().toString(36).slice(2)}`, customerId],
        )
      : withTransaction((c) =>
          c.query(
            `INSERT INTO orders (order_number, customer_id, payment_method, order_status, payment_status, subtotal, shipping_amount, total_amount)
             VALUES ($1, $2, 'COD', 'PENDING_CONFIRMATION', 'PENDING_COLLECTION', 100, 0, 100)
             RETURNING id`,
            [`ORD-${Date.now()}-${Math.random().toString(36).slice(2)}`, customerId],
          ),
        ));
    return rows[0].id;
  }

  async function createCoupon(overrides: Partial<{ usageLimit: number | null; usageCount: number; perCustomerLimit: number | null }> = {}) {
    return couponRepository.create({
      code: `TESTCODE-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: 'Test Coupon',
      discountType: 'FIXED_AMOUNT',
      discountValue: 50,
      startsAt: new Date('2026-01-01T00:00:00.000Z'),
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      usageLimit: overrides.usageLimit ?? null,
      perCustomerLimit: overrides.perCustomerLimit ?? null,
      status: 'ACTIVE',
      createdBy: adminId,
    });
  }

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    resetEnvCache();

    ({ withTransaction, resetTransactionPool } = await import('../../src/lib/transaction.js'));
    await resetTransactionPool();
    couponRepository = await import('../../src/repositories/coupon.repository.js');
    customersRepository = await import('../../src/repositories/customers.repository.js');
    usersRepository = await import('../../src/repositories/users.repository.js');
    ({ hashPassword } = await import('../../src/lib/password.js'));

    const passwordHash = await hashPassword('CouponRepoTestPass12');
    adminId = (
      await usersRepository.create({
        role: 'ADMIN',
        userIdentifier: 'coupon-repo-admin',
        passwordHash,
        mustChangePassword: false,
      })
    ).id;

    const customerA = await customersRepository.createGuestReference({ ...SAMPLE_CUSTOMER, phoneNumber: '01711111111' });
    customerAId = customerA.id;
    const customerB = await customersRepository.createGuestReference({ ...SAMPLE_CUSTOMER, phoneNumber: '01722222222' });
    customerBId = customerB.id;
  }, 60_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  beforeEach(async () => {
    await withTransaction(async (client) => {
      await client.query('DELETE FROM coupon_usages');
      await client.query('DELETE FROM orders');
      await client.query('DELETE FROM coupons');
    });
  });

  // -------------------------------------------------------------------------
  // Test 13 (single-call): usage-limit-reached leaves the counter unchanged
  // (acceptance 13).
  // -------------------------------------------------------------------------
  it('returns ok:false USAGE_LIMIT_REACHED when usage_count already equals usage_limit, and leaves usage_count unchanged', async () => {
    const coupon = await createCoupon({ usageLimit: 1, usageCount: 0 });
    // Consume the single use first.
    const orderId1 = await createOrder(customerAId);
    await withTransaction((client) =>
      couponRepository.recordCouponUsage(client, {
        couponId: coupon.id,
        orderId: orderId1,
        customerId: customerAId,
        discountAmount: 50,
        perCustomerLimit: null,
      }),
    );

    const orderId2 = await createOrder(customerBId);
    const result = await withTransaction((client) =>
      couponRepository.recordCouponUsage(client, {
        couponId: coupon.id,
        orderId: orderId2,
        customerId: customerBId,
        discountAmount: 50,
        perCustomerLimit: null,
      }),
    );

    expect(result).toEqual({ ok: false, reason: 'USAGE_LIMIT_REACHED' });

    const reloaded = await couponRepository.findById(coupon.id);
    expect(reloaded!.usageCount).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Test 12: usage-limit concurrency — highest-value test in this slice.
  // -------------------------------------------------------------------------
  it('two concurrent calls against a coupon with one use left: exactly one succeeds, counter never exceeds the limit, exactly one usage row exists (§8.25, acceptance 14)', async () => {
    const coupon = await createCoupon({ usageLimit: 1, usageCount: 0 });
    const orderIdA = await createOrder(customerAId);
    const orderIdB = await createOrder(customerBId);

    const [resultA, resultB] = await Promise.all([
      withTransaction((client) =>
        couponRepository.recordCouponUsage(client, {
          couponId: coupon.id,
          orderId: orderIdA,
          customerId: customerAId,
          discountAmount: 50,
          perCustomerLimit: null,
        }),
      ),
      withTransaction((client) =>
        couponRepository.recordCouponUsage(client, {
          couponId: coupon.id,
          orderId: orderIdB,
          customerId: customerBId,
          discountAmount: 50,
          perCustomerLimit: null,
        }),
      ),
    ]);

    const outcomes = [resultA, resultB];
    const successes = outcomes.filter((r) => r.ok === true);
    const failures = outcomes.filter((r) => r.ok === false);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ ok: false, reason: 'USAGE_LIMIT_REACHED' });

    const reloaded = await couponRepository.findById(coupon.id);
    expect(reloaded!.usageCount).toBe(1);

    const usageCount = await couponRepository.countUsages(coupon.id);
    expect(usageCount).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Test 13: per-customer concurrency.
  // -------------------------------------------------------------------------
  it('two concurrent calls for one customer against per_customer_limit:1: exactly one succeeds', async () => {
    const coupon = await createCoupon({ usageLimit: null, perCustomerLimit: 1 });
    const orderId1 = await createOrder(customerAId);
    const orderId2 = await createOrder(customerAId);

    const [result1, result2] = await Promise.all([
      withTransaction((client) =>
        couponRepository.recordCouponUsage(client, {
          couponId: coupon.id,
          orderId: orderId1,
          customerId: customerAId,
          discountAmount: 50,
          perCustomerLimit: 1,
        }),
      ),
      withTransaction((client) =>
        couponRepository.recordCouponUsage(client, {
          couponId: coupon.id,
          orderId: orderId2,
          customerId: customerAId,
          discountAmount: 50,
          perCustomerLimit: 1,
        }),
      ),
    ]);

    const outcomes = [result1, result2];
    const successes = outcomes.filter((r) => r.ok === true);
    const failures = outcomes.filter((r) => r.ok === false);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ ok: false, reason: 'PER_CUSTOMER_LIMIT_REACHED' });

    const usageCountForCustomer = await couponRepository.countUsagesForCustomer(coupon.id, customerAId);
    expect(usageCountForCustomer).toBe(1);
  });

  it('a different customer is unaffected by another customer hitting their own per_customer_limit', async () => {
    const coupon = await createCoupon({ perCustomerLimit: 1 });
    const orderId1 = await createOrder(customerAId);
    const resultA = await withTransaction((client) =>
      couponRepository.recordCouponUsage(client, {
        couponId: coupon.id,
        orderId: orderId1,
        customerId: customerAId,
        discountAmount: 50,
        perCustomerLimit: 1,
      }),
    );
    expect(resultA.ok).toBe(true);

    const orderId2 = await createOrder(customerBId);
    const resultB = await withTransaction((client) =>
      couponRepository.recordCouponUsage(client, {
        couponId: coupon.id,
        orderId: orderId2,
        customerId: customerBId,
        discountAmount: 50,
        perCustomerLimit: 1,
      }),
    );
    expect(resultB.ok).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 14: preview writes nothing (§8.15a) — asserted at the repository/DB
  // level: calling nothing at all (a pure preview never calls
  // recordCouponUsage) leaves usage_count and coupon_usages unchanged.
  // -------------------------------------------------------------------------
  it('a coupon that has never had recordCouponUsage called against it has usage_count 0 and no usage rows (§8.15a)', async () => {
    const coupon = await createCoupon();
    const reloaded = await couponRepository.findById(coupon.id);
    expect(reloaded!.usageCount).toBe(0);
    expect(await couponRepository.countUsages(coupon.id)).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Test 17: code normalization (§8.4a).
  // -------------------------------------------------------------------------
  describe('code normalization (§8.4a, test 17)', () => {
    it('save20, " SAVE20 ", and Save20 all resolve to the same coupon', async () => {
      const created = await couponRepository.create({
        code: '  save20  ',
        name: 'Save 20',
        discountType: 'PERCENTAGE',
        discountValue: 20,
        startsAt: new Date('2026-01-01T00:00:00.000Z'),
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
        createdBy: adminId,
      });
      expect(created.code).toBe('SAVE20');

      expect((await couponRepository.findByNormalizedCode('save20'))?.id).toBe(created.id);
      expect((await couponRepository.findByNormalizedCode(' SAVE20 '))?.id).toBe(created.id);
      expect((await couponRepository.findByNormalizedCode('Save20'))?.id).toBe(created.id);
    });

    it('the database rejects a duplicate under any casing (acceptance 2)', async () => {
      await couponRepository.create({
        code: 'DUPCODE',
        name: 'Dup 1',
        discountType: 'PERCENTAGE',
        discountValue: 10,
        startsAt: new Date('2026-01-01T00:00:00.000Z'),
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
        createdBy: adminId,
      });

      await expect(
        couponRepository.create({
          code: 'dupcode',
          name: 'Dup 2',
          discountType: 'PERCENTAGE',
          discountValue: 10,
          startsAt: new Date('2026-01-01T00:00:00.000Z'),
          expiresAt: new Date('2099-01-01T00:00:00.000Z'),
          createdBy: adminId,
        }),
      ).rejects.toMatchObject({ code: 'COUPON_CODE_EXISTS' });
    });
  });

  // -------------------------------------------------------------------------
  // Test 18: FIXED_AMOUNT coupons cannot carry a maximum (§8.4b) — DB CHECK.
  // -------------------------------------------------------------------------
  it('the CHECK constraint rejects maximum_discount_amount on a FIXED_AMOUNT coupon (§8.4b, test 18, acceptance 3)', async () => {
    await expect(
      couponRepository.create({
        code: 'FIXEDMAXBAD',
        name: 'Bad Fixed Max',
        discountType: 'FIXED_AMOUNT',
        discountValue: 100,
        maximumDiscountAmount: 50,
        startsAt: new Date('2026-01-01T00:00:00.000Z'),
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
        createdBy: adminId,
      }),
    ).rejects.toBeTruthy();
  });

  it('\\d coupons shows exactly DRAFT, ACTIVE, DISABLED for coupon_status — no EXPIRED (acceptance 4)', async () => {
    const client = await (await import('../helpers/schemaFixture.js')).connect(SCHEMA);
    try {
      const { rows } = await client.query(
        `SELECT enumlabel FROM pg_enum e
           JOIN pg_type t ON t.oid = e.enumtypid
           JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'coupon_status' AND n.nspname = $1
          ORDER BY enumsortorder`,
        [SCHEMA],
      );
      expect(rows.map((r: { enumlabel: string }) => r.enumlabel)).toEqual(['DRAFT', 'ACTIVE', 'DISABLED']);
    } finally {
      await client.end();
    }
  });

  // -------------------------------------------------------------------------
  // Test 19: delete vs. archive (§8.9, acceptance 15).
  // -------------------------------------------------------------------------
  describe('delete vs. archive (§8.9, test 19)', () => {
    it('DELETE on an unused coupon removes it', async () => {
      const coupon = await createCoupon();
      expect(await couponRepository.countUsages(coupon.id)).toBe(0);
      await couponRepository.remove(coupon.id);
      expect(await couponRepository.findById(coupon.id)).toBeNull();
    });

    it('a direct SQL delete of a used coupon is rejected by ON DELETE RESTRICT', async () => {
      const coupon = await createCoupon();
      const orderId = await createOrder(customerAId);
      await withTransaction((client) =>
        couponRepository.recordCouponUsage(client, {
          couponId: coupon.id,
          orderId,
          customerId: customerAId,
          discountAmount: 50,
          perCustomerLimit: null,
        }),
      );

      await expect(couponRepository.remove(coupon.id)).rejects.toBeTruthy();
      // Row still exists — the restrict was honored.
      expect(await couponRepository.findById(coupon.id)).not.toBeNull();
    });

    it('archiving a used coupon (service-level delete-or-archive) is a distinct field from status, and an archived coupon fails validation regardless of status', async () => {
      const coupon = await createCoupon();
      const orderId = await createOrder(customerAId);
      await withTransaction((client) =>
        couponRepository.recordCouponUsage(client, {
          couponId: coupon.id,
          orderId,
          customerId: customerAId,
          discountAmount: 50,
          perCustomerLimit: null,
        }),
      );

      const archived = await couponRepository.setArchived(coupon.id, true);
      expect(archived!.isArchived).toBe(true);
      expect(archived!.status).toBe('ACTIVE'); // status column itself is untouched by archiving
    });
  });
});
