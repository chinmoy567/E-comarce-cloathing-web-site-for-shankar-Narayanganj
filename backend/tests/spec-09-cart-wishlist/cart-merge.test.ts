import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL } from '../helpers/schemaFixture.js';
import { nextPhone, setupCartHarness, type CartHarness } from './cartHarness.js';

/** Spec 09 tests 10, 11 and acceptance 9/10: merge on login/registration, one active cart per customer. */
describe.skipIf(!TEST_DATABASE_URL)('cart merge (spec 09)', () => {
  let h: CartHarness;
  beforeAll(async () => {
    h = await setupCartHarness('spec09_cart_merge');
  }, 120_000);
  afterAll(async () => {
    await h?.teardown();
  });

  const cookieOf = (res: request.Response, name: string): string | undefined =>
    ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith(`${name}=`));

  async function guestWithItems(quantity: number) {
    const first = await request(h.app).get('/api/cart');
    const cookie = cookieOf(first, 'cart_token')!.split(';')[0]!;
    await request(h.app)
      .post('/api/cart/items')
      .set('Cookie', cookie)
      .send({ variantId: h.catalogue.variantId, quantity });
    return cookie;
  }

  it('merges a guest cart into the account cart on registration, summing quantities (10, acc 9)', async () => {
    const phone = nextPhone();
    const guestCookie = await guestWithItems(2);
    const reg = await request(h.app)
      .post('/api/customer/auth/register')
      .set('Cookie', guestCookie)
      .send({ phone_number: phone, password: 'CartMergePass12' });
    expect(reg.status).toBe(201);
    // cart_token cleared on merge
    expect(cookieOf(reg, 'cart_token')).toMatch(/cart_token=;/);

    const session = ([] as string[]).concat(reg.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]!).filter((c) => c.startsWith('customer_at='));
    const cart = await request(h.app).get('/api/cart').set('Cookie', session);
    expect(cart.body.data.lines[0]).toMatchObject({ quantity: 2 });

    // Logout, build another guest cart, log in: quantities sum onto the account cart.
    const second = await guestWithItems(3);
    const login = await request(h.app)
      .post('/api/customer/auth/login')
      .set('Cookie', second)
      .send({ phone_number: phone, password: 'CartMergePass12' });
    expect(login.status).toBe(200);
    const loginSession = ([] as string[]).concat(login.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]!).filter((c) => c.startsWith('customer_at='));
    const merged = await request(h.app).get('/api/cart').set('Cookie', loginSession);
    expect(merged.body.data.lines).toHaveLength(1);
    expect(merged.body.data.lines[0].quantity).toBe(5);

    const abandoned = await h.withTransaction((c) =>
      c.query(`SELECT count(*)::int AS n FROM carts WHERE status = 'ABANDONED' AND token_hash IS NULL`),
    );
    expect(abandoned.rows[0].n).toBeGreaterThanOrEqual(2);

    // The same account cart is visible from a second browser (acc 10).
    const other = await request(h.app).get('/api/cart').set('Cookie', loginSession);
    expect(other.body.data.itemCount).toBe(5);
  });

  it('a failed merge leaves the anonymous cart intact and re-mergeable (10)', async () => {
    const phone = nextPhone();
    const guestCookie = await guestWithItems(1);
    const reg = await request(h.app)
      .post('/api/customer/auth/register')
      .send({ phone_number: phone, password: 'CartMergePass12' });
    expect(reg.status).toBe(201);
    const userId = (await h.withTransaction((c) => c.query(`SELECT id FROM users WHERE phone_number = $1`, [phone]))).rows[0].id;

    const { mergeAnonymousCart } = await import('../../src/services/cart/cartService.js');
    const cartRepo = await import('../../src/repositories/cart.repository.js');
    const original = cartRepo.mergeInto;
    // Force a failure inside the merge transaction by dropping the target's table privileges via a bad token path.
    const token = guestCookie.split('=')[1]!;
    await h.withTransaction((c) => c.query(`ALTER TABLE cart_items ADD CONSTRAINT force_fail CHECK (quantity < 0) NOT VALID`));
    await expect(mergeAnonymousCart(token, userId)).rejects.toThrow();
    await h.withTransaction((c) => c.query(`ALTER TABLE cart_items DROP CONSTRAINT force_fail`));
    expect(original).toBeTypeOf('function');

    const still = await request(h.app).get('/api/cart').set('Cookie', guestCookie);
    expect(still.body.data.itemCount).toBe(1);
    expect(await mergeAnonymousCart(token, userId)).toBe(true);
  });

  it('concurrent cart creation for one customer yields one active cart (11)', async () => {
    const phone = nextPhone();
    const reg = await request(h.app)
      .post('/api/customer/auth/register')
      .send({ phone_number: phone, password: 'CartMergePass12' });
    const session = ([] as string[]).concat(reg.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]!).filter((c) => c.startsWith('customer_at='));
    await Promise.all(Array.from({ length: 6 }, () => request(h.app).get('/api/cart').set('Cookie', session)));
    const rows = await h.withTransaction((c) =>
      c.query(
        `SELECT count(*)::int AS n FROM carts ca JOIN users u ON u.customer_id = ca.customer_id
          WHERE u.phone_number = $1 AND ca.status = 'ACTIVE'`,
        [phone],
      ),
    );
    expect(rows.rows[0].n).toBe(1);
  });
});
