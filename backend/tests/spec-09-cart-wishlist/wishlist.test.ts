import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL } from '../helpers/schemaFixture.js';
import { nextPhone, setupCartHarness, type CartHarness } from './cartHarness.js';

/** Spec 09 test 13 and acceptance 14/15: wishlist is auth-only, idempotent, and hides inactive products. */
describe.skipIf(!TEST_DATABASE_URL)('wishlist (spec 09)', () => {
  let h: CartHarness;
  let session: string[];
  beforeAll(async () => {
    h = await setupCartHarness('spec09_wishlist');
    const reg = await request(h.app)
      .post('/api/customer/auth/register')
      .send({ phone_number: nextPhone(), password: 'WishlistPass123' });
    session = ([] as string[]).concat(reg.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]!);
  }, 120_000);
  afterAll(async () => {
    await h?.teardown();
  });

  it('requires a customer session (401)', async () => {
    expect((await request(h.app).get('/api/customer/wishlist')).status).toBe(401);
    expect((await request(h.app).post('/api/customer/wishlist').send({ productId: h.catalogue.productId })).status).toBe(401);
  });

  it('duplicate add leaves one row; list returns the product; delete removes it', async () => {
    for (let i = 0; i < 2; i += 1) {
      const res = await request(h.app).post('/api/customer/wishlist').set('Cookie', session).send({ productId: h.catalogue.productId });
      expect(res.status).toBe(200);
    }
    const rows = await h.withTransaction((c) => c.query(`SELECT count(*)::int AS n FROM wishlist_items`));
    expect(rows.rows[0].n).toBe(1);
    const list = await request(h.app).get('/api/customer/wishlist').set('Cookie', session);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ slug: 'cart-product', name: 'Cart Product' });

    await h.withTransaction((c) => c.query(`UPDATE products SET status = 'INACTIVE' WHERE id = $1`, [h.catalogue.productId]));
    expect((await request(h.app).get('/api/customer/wishlist').set('Cookie', session)).body.data).toHaveLength(0);
    await h.withTransaction((c) => c.query(`UPDATE products SET status = 'ACTIVE' WHERE id = $1`, [h.catalogue.productId]));

    const del = await request(h.app).delete(`/api/customer/wishlist/${h.catalogue.productId}`).set('Cookie', session);
    expect(del.body.data).toHaveLength(0);
  });

  it('adding an unknown/inactive product is 404 and extra body fields are rejected', async () => {
    const missing = await request(h.app)
      .post('/api/customer/wishlist')
      .set('Cookie', session)
      .send({ productId: '00000000-0000-4000-8000-000000000000' });
    expect(missing.status).toBe(404);
    const extra = await request(h.app)
      .post('/api/customer/wishlist')
      .set('Cookie', session)
      .send({ productId: h.catalogue.productId, customerId: 'x' });
    expect(extra.status).toBe(400);
  });
});
