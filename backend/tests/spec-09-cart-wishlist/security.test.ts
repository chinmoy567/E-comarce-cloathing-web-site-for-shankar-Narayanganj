import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL } from '../helpers/schemaFixture.js';
import { setupCartHarness, type CartHarness } from './cartHarness.js';

/** Spec 09 test 14: carts carry no PII, so a leaked cart token exposes nothing personal. */
describe.skipIf(!TEST_DATABASE_URL)('cart schema security (spec 09)', () => {
  let h: CartHarness;
  beforeAll(async () => {
    h = await setupCartHarness('spec09_cart_security');
  }, 120_000);
  afterAll(async () => {
    await h?.teardown();
  });

  it('no cart table has a name/phone/address/email/price column', async () => {
    const res = await h.withTransaction((c) =>
      c.query(
        `SELECT table_name, column_name FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name IN ('carts','cart_items','wishlist_items')`,
      ),
    );
    const bad = res.rows.filter((r) => /name|phone|address|email|price|total/i.test(r.column_name));
    expect(bad).toEqual([]);
  });
});
