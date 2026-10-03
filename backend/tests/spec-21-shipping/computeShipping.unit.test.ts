import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.js';
import { applyTestEnv } from '../helpers/testEnv.js';
import { resetEnvCache } from '../../src/config/env.js';

/**
 * Spec 21 — computeShipping() against the real seeded zone/rate tables (migration 0018).
 * Tests required: 1 (zone resolution), 2 (strategies + exact threshold boundary), 7 (determinism),
 * 10 (a second default zone is structurally impossible); plus the append-only rate history,
 * the unmatched-district tally, and the schema CHECKs.
 */
const SCHEMA = 'spec21_shipping_unit';

describe.skipIf(!TEST_DATABASE_URL)('computeShipping (spec 21)', () => {
  let withTransaction: typeof import('../../src/lib/transaction.js').withTransaction;
  let resetTransactionPool: typeof import('../../src/lib/transaction.js').resetTransactionPool;
  let computeShipping: typeof import('../../src/services/shipping/computeShipping.js').computeShipping;
  let shippingRepository: typeof import('../../src/repositories/shipping.repository.js');

  // A "now" safely after every rate this file inserts (rates default effective_from to the DB's now()).
  const later = () => new Date(Date.now() + 60_000);

  const quote = (district: string, isMetropolitan: boolean, merchandiseSubtotal = 1000, opts: { record?: boolean } = {}) =>
    withTransaction((client) =>
      computeShipping(
        {
          address: { division: 'Dhaka', district, isMetropolitan },
          merchandiseSubtotal,
          now: later(),
          recordUnmatched: opts.record ?? false,
        },
        client,
      ),
    );

  async function setRate(
    zoneCode: string,
    strategy: 'FLAT' | 'FREE' | 'FREE_OVER_THRESHOLD',
    flat: number,
    freeOver: number | null = null,
    effectiveFrom = 'now()',
  ) {
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO shipping_rates (zone_id, strategy, flat_amount, free_over_amount, effective_from)
         SELECT id, $2, $3, $4, ${effectiveFrom} FROM shipping_zones WHERE code = $1`,
        [zoneCode, strategy, flat, freeOver],
      );
    });
  }

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    applyTestEnv();
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    resetEnvCache();
    ({ withTransaction, resetTransactionPool } = await import('../../src/lib/transaction.js'));
    await resetTransactionPool();
    ({ computeShipping } = await import('../../src/services/shipping/computeShipping.js'));
    shippingRepository = await import('../../src/repositories/shipping.repository.js');
  }, 60_000);

  afterAll(async () => {
    await resetTransactionPool?.();
    await dropSchema(SCHEMA);
  });

  describe('zone resolution (test 1)', () => {
    it('charges the INSIDE_DHAKA rate to a metropolitan Dhaka address', async () => {
      const q = await quote('Dhaka', true);
      expect(q).toMatchObject({ zoneCode: 'INSIDE_DHAKA', amount: 60, freeShippingApplied: false });
    });

    it('charges the DHAKA_SUBURB rate to the same district when non-metropolitan', async () => {
      expect(await quote('Dhaka', false)).toMatchObject({ zoneCode: 'DHAKA_SUBURB', amount: 100 });
    });

    it('falls through from the metro rule to the non-metro rule for a district with only a non-metro mapping', async () => {
      expect(await quote('Gazipur', true)).toMatchObject({ zoneCode: 'DHAKA_SUBURB', amount: 100 });
      expect(await quote('Narayanganj', false)).toMatchObject({ zoneCode: 'DHAKA_SUBURB', amount: 100 });
    });

    it('matches the district case-insensitively and ignores surrounding whitespace', async () => {
      expect(await quote('  dHaKa ', true)).toMatchObject({ zoneCode: 'INSIDE_DHAKA' });
      expect(await quote('GAZIPUR', false)).toMatchObject({ zoneCode: 'DHAKA_SUBURB' });
    });

    it('resolves an unmapped district to the default zone — never an error, never zero', async () => {
      const q = await quote('Sylhet', false);
      expect(q).toMatchObject({ zoneCode: 'OUTSIDE_DHAKA', amount: 120 });
      expect(q.amount).toBeGreaterThan(0);
    });
  });

  describe('strategies (test 2)', () => {
    it('FLAT returns the flat amount regardless of subtotal', async () => {
      expect((await quote('Sylhet', false, 1)).amount).toBe(120);
      expect((await quote('Sylhet', false, 1_000_000)).amount).toBe(120);
    });

    it('FREE returns 0 and flags free shipping', async () => {
      await setRate('OUTSIDE_DHAKA', 'FREE', 0);
      expect(await quote('Sylhet', false)).toMatchObject({ amount: 0, freeShippingApplied: true, freeShippingRemaining: null });
      await setRate('OUTSIDE_DHAKA', 'FLAT', 120);
    });

    it('FREE_OVER_THRESHOLD ships free at exactly the threshold and charges flat one taka below', async () => {
      await setRate('OUTSIDE_DHAKA', 'FREE_OVER_THRESHOLD', 120, 2000);

      const at = await quote('Sylhet', false, 2000);
      expect(at).toMatchObject({ amount: 0, freeShippingApplied: true, freeShippingRemaining: null });

      const above = await quote('Sylhet', false, 2000.01);
      expect(above.amount).toBe(0);

      const below = await quote('Sylhet', false, 1999);
      expect(below).toMatchObject({ amount: 120, freeShippingApplied: false, freeShippingRemaining: 1 });

      const far = await quote('Sylhet', false, 500);
      expect(far.freeShippingRemaining).toBe(1500);

      await setRate('OUTSIDE_DHAKA', 'FLAT', 120);
    });

    it('returns amounts with at most 2 decimal places (exact poisha arithmetic)', async () => {
      await setRate('OUTSIDE_DHAKA', 'FREE_OVER_THRESHOLD', 120.1, 1000.1);
      const q = await quote('Sylhet', false, 999.99);
      expect(q.amount).toBe(120.1);
      expect(q.freeShippingRemaining).toBe(0.11);
      await setRate('OUTSIDE_DHAKA', 'FLAT', 120);
    });
  });

  describe('rate history', () => {
    it('uses the newest rate whose effective_from has passed and ignores a future-dated one', async () => {
      await setRate('INSIDE_DHAKA', 'FLAT', 75);
      expect((await quote('Dhaka', true)).amount).toBe(75);

      await setRate('INSIDE_DHAKA', 'FLAT', 999, null, `now() + interval '1 day'`);
      expect((await quote('Dhaka', true)).amount).toBe(75);

      // Earlier history is retained (append-only), not overwritten.
      const count = await withTransaction(async (client) => {
        const { rows } = await client.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM shipping_rates r JOIN shipping_zones z ON z.id = r.zone_id WHERE z.code = 'INSIDE_DHAKA'`,
        );
        return Number(rows[0]!.n);
      });
      expect(count).toBeGreaterThanOrEqual(3);
      await setRate('INSIDE_DHAKA', 'FLAT', 60);
    });
  });

  it('is deterministic: two calls in one transaction agree (test 7)', async () => {
    const [a, b] = await withTransaction(async (client) => {
      const input = {
        address: { division: 'Dhaka', district: 'Dhaka', isMetropolitan: true },
        merchandiseSubtotal: 1234.56,
        now: later(),
      };
      return [await computeShipping(input, client), await computeShipping(input, client)];
    });
    expect(a).toEqual(b);
  });

  describe('unmatched districts', () => {
    it('does NOT tally a district when recordUnmatched is off (public advisory paths)', async () => {
      await quote('Atlantis', false, 100, { record: false });
      const { total } = await withTransaction((c) =>
        shippingRepository.listUnmatchedDistricts({ page: 1, pageSize: 50 }, c),
      );
      expect(total).toBe(0);
    });

    it('tallies it at order time, counts repeats, and clears once a mapping exists', async () => {
      await quote('Atlantis', false, 100, { record: true });
      await quote(' atlantis ', false, 100, { record: true });

      const listed = await withTransaction((c) => shippingRepository.listUnmatchedDistricts({ page: 1, pageSize: 50 }, c));
      expect(listed.items).toHaveLength(1);
      expect(listed.items[0]).toMatchObject({ district: 'Atlantis', occurrences: 2 });

      await withTransaction(async (client) => {
        const zone = await shippingRepository.findDefaultZone(client);
        await shippingRepository.replaceDistricts(zone!.id, [{ district: 'Atlantis', metroOnly: false }], client);
      });
      const after = await withTransaction((c) => shippingRepository.listUnmatchedDistricts({ page: 1, pageSize: 50 }, c));
      expect(after.total).toBe(0);

      // Mapping the district to the default zone resolves it as matched now — no further tally.
      await quote('Atlantis', false, 100, { record: true });
      expect((await withTransaction((c) => shippingRepository.listUnmatchedDistricts({ page: 1, pageSize: 50 }, c))).total).toBe(0);
    });
  });

  describe('schema guarantees', () => {
    it('a second default zone cannot exist (test 10)', async () => {
      await expect(
        withTransaction((client) =>
          client.query(`INSERT INTO shipping_zones (code, name, is_default) VALUES ('SECOND_DEFAULT', 'Second', true)`),
        ),
      ).rejects.toMatchObject({ code: '23505' });
    });

    it('rejects a threshold on a non-threshold strategy and a missing threshold', async () => {
      await expect(
        withTransaction((client) =>
          client.query(
            `INSERT INTO shipping_rates (zone_id, strategy, flat_amount, free_over_amount)
             SELECT id, 'FLAT', 10, 500 FROM shipping_zones WHERE code = 'INSIDE_DHAKA'`,
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        withTransaction((client) =>
          client.query(
            `INSERT INTO shipping_rates (zone_id, strategy, flat_amount)
             SELECT id, 'FREE_OVER_THRESHOLD', 10 FROM shipping_zones WHERE code = 'INSIDE_DHAKA'`,
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('rejects a negative amount and an unknown strategy', async () => {
      await expect(
        withTransaction((client) =>
          client.query(
            `INSERT INTO shipping_rates (zone_id, strategy, flat_amount)
             SELECT id, 'FLAT', -1 FROM shipping_zones WHERE code = 'INSIDE_DHAKA'`,
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        withTransaction((client) =>
          client.query(
            `INSERT INTO shipping_rates (zone_id, strategy, flat_amount)
             SELECT id, 'PER_KG', 10 FROM shipping_zones WHERE code = 'INSIDE_DHAKA'`,
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('maps one district to one zone per metro flag, case-insensitively', async () => {
      await expect(
        withTransaction((client) =>
          client.query(
            `INSERT INTO shipping_zone_districts (zone_id, district, metro_only)
             SELECT id, 'DHAKA', true FROM shipping_zones WHERE code = 'DHAKA_SUBURB'`,
          ),
        ),
      ).rejects.toMatchObject({ code: '23505' });
    });
  });
});
