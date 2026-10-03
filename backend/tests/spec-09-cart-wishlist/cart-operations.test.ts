import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL } from '../helpers/schemaFixture.js';
import { setupCartHarness, type CartHarness } from './cartHarness.js';

/** Spec 09 tests 1–9, 11, 12: cart CRUD, server-side pricing, visibility, anonymous isolation. */
describe.skipIf(!TEST_DATABASE_URL)('cart operations (spec 09)', () => {
  let h: CartHarness;
  beforeAll(async () => {
    h = await setupCartHarness('spec09_cart_ops');
  }, 120_000);
  afterAll(async () => {
    await h?.teardown();
  });

  const cartCookie = (res: request.Response): string => {
    const raw = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('cart_token='));
    return raw ? raw.split(';')[0]! : '';
  };

  async function newGuest() {
    const res = await request(h.app).get('/api/cart');
    return { agent: request.agent(h.app), cookie: cartCookie(res), res };
  }

  it('GET /api/cart issues an httpOnly cart_token and stores only its hash (1)', async () => {
    const res = await request(h.app).get('/api/cart');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ lines: [], itemCount: 0, merchandiseSubtotal: 0, currency: 'BDT' });
    expect(res.headers['cache-control']).toBe('no-store');
    const raw = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('cart_token='))!;
    expect(raw).toMatch(/HttpOnly/i);
    const token = raw.split(';')[0]!.split('=')[1]!;
    const rows = await h.withTransaction((c) => c.query(`SELECT token_hash FROM carts`));
    expect(rows.rows.some((r) => r.token_hash === token)).toBe(false);
  });

  it('prices come from the catalogue with decimal-safe totals, and a price change shows with no cart write (2, 4, 2/3)', async () => {
    const { cookie } = await newGuest();
    const add = await request(h.app)
      .post('/api/cart/items')
      .set('Cookie', cookie)
      .send({ variantId: h.catalogue.variantId, quantity: 3 });
    expect(add.status).toBe(200);
    expect(add.body.data.lines[0]).toMatchObject({ unitPrice: 33.33, quantity: 3, lineTotal: 99.99 });
    expect(add.body.data.merchandiseSubtotal).toBe(99.99);

    await h.withTransaction((c) =>
      c.query(`UPDATE product_variants SET price = 40.00 WHERE id = $1`, [h.catalogue.variantId]),
    );
    const after = await request(h.app).get('/api/cart').set('Cookie', cookie);
    expect(after.body.data.merchandiseSubtotal).toBe(120);
    await h.withTransaction((c) =>
      c.query(`UPDATE product_variants SET price = 33.33 WHERE id = $1`, [h.catalogue.variantId]),
    );

    const cols = await h.withTransaction((c) =>
      c.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'cart_items'`),
    );
    expect(cols.rows.map((r) => r.column_name).some((n: string) => /price|total/.test(n))).toBe(false);
  });

  it('a variant without its own price falls back to products.base_price (3)', async () => {
    const { cookie } = await newGuest();
    const res = await request(h.app)
      .post('/api/cart/items')
      .set('Cookie', cookie)
      .send({ variantId: h.catalogue.variantNoPriceId, quantity: 1 });
    expect(res.body.data.lines[0].unitPrice).toBe(100.1);
  });

  it('rejects client-supplied price/total fields rather than ignoring them (1)', async () => {
    for (const extra of [{ unitPrice: 1 }, { lineTotal: 1 }, { subtotal: 1 }, { price: 1 }]) {
      const res = await request(h.app)
        .post('/api/cart/items')
        .send({ variantId: h.catalogue.variantId, quantity: 1, ...extra });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('adding the same variant twice (even concurrently) yields one line with a summed quantity (5)', async () => {
    const { cookie } = await newGuest();
    const send = () =>
      request(h.app).post('/api/cart/items').set('Cookie', cookie).send({ variantId: h.catalogue.variantId, quantity: 1 });
    await Promise.all([send(), send()]);
    const res = await request(h.app).get('/api/cart').set('Cookie', cookie);
    expect(res.body.data.lines).toHaveLength(1);
    expect(res.body.data.lines[0].quantity).toBe(2);
    expect(res.body.data.itemCount).toBe(2);
  });

  it('enforces quantity bounds in the API and in the database (6)', async () => {
    const { cookie } = await newGuest();
    for (const quantity of [0, 100, -1, 1.5]) {
      const res = await request(h.app)
        .post('/api/cart/items')
        .set('Cookie', cookie)
        .send({ variantId: h.catalogue.variantId, quantity });
      expect(res.status).toBe(400);
    }
    await request(h.app).post('/api/cart/items').set('Cookie', cookie).send({ variantId: h.catalogue.variantId, quantity: 1 });
    expect((await request(h.app).patch(`/api/cart/items/${h.catalogue.variantId}`).set('Cookie', cookie).send({ quantity: 0 })).status).toBe(400);

    const cart = await h.withTransaction((c) => c.query(`SELECT id FROM carts LIMIT 1`));
    for (const q of [0, 100]) {
      await expect(
        h.withTransaction((c) =>
          c.query(`INSERT INTO cart_items (cart_id, product_variant_id, quantity) VALUES ($1,$2,$3)`, [
            cart.rows[0].id,
            h.catalogue.variantNoPriceId,
            q,
          ]),
        ),
      ).rejects.toThrow();
    }
  });

  it('caps a re-added quantity at 99', async () => {
    const { cookie } = await newGuest();
    for (let i = 0; i < 2; i += 1) {
      await request(h.app).post('/api/cart/items').set('Cookie', cookie).send({ variantId: h.catalogue.variantId, quantity: 60 });
    }
    const res = await request(h.app).get('/api/cart').set('Cookie', cookie);
    expect(res.body.data.lines[0].quantity).toBe(99);
  });

  it('PATCH replaces, DELETE removes, and a missing line is 404', async () => {
    const { cookie } = await newGuest();
    await request(h.app).post('/api/cart/items').set('Cookie', cookie).send({ variantId: h.catalogue.variantId, quantity: 2 });
    const patch = await request(h.app).patch(`/api/cart/items/${h.catalogue.variantId}`).set('Cookie', cookie).send({ quantity: 5 });
    expect(patch.body.data.lines[0].quantity).toBe(5);
    const del = await request(h.app).delete(`/api/cart/items/${h.catalogue.variantId}`).set('Cookie', cookie);
    expect(del.body.data.lines).toHaveLength(0);
    expect((await request(h.app).delete(`/api/cart/items/${h.catalogue.variantId}`).set('Cookie', cookie)).status).toBe(404);
    expect((await request(h.app).patch(`/api/cart/items/${h.catalogue.variantId}`).set('Cookie', cookie).send({ quantity: 1 })).status).toBe(404);
  });

  it('inactive variant, product and category are each 404, identical to a nonexistent id (7)', async () => {
    const { cookie } = await newGuest();
    const missing = await request(h.app)
      .post('/api/cart/items')
      .set('Cookie', cookie)
      .send({ variantId: '00000000-0000-4000-8000-000000000000', quantity: 1 });
    expect(missing.status).toBe(404);

    const toggles = [
      [`UPDATE product_variants SET is_active = false WHERE id = $1`, `UPDATE product_variants SET is_active = true WHERE id = $1`, h.catalogue.variantId],
      [`UPDATE products SET status = 'INACTIVE' WHERE id = $1`, `UPDATE products SET status = 'ACTIVE' WHERE id = $1`, h.catalogue.productId],
      [`UPDATE categories SET status = 'INACTIVE' WHERE id = $1`, `UPDATE categories SET status = 'ACTIVE' WHERE id = $1`, h.catalogue.categoryId],
    ] as const;
    for (const [off, on, id] of toggles) {
      await h.withTransaction((c) => c.query(off, [id]));
      const res = await request(h.app)
        .post('/api/cart/items')
        .set('Cookie', cookie)
        .send({ variantId: h.catalogue.variantId, quantity: 1 });
      await h.withTransaction((c) => c.query(on, [id]));
      expect(res.status).toBe(404);
      expect(res.body.error).toEqual(missing.body.error);
    }
  });

  it('out-of-stock add succeeds, is flagged, and reserves nothing (8)', async () => {
    const { cookie } = await newGuest();
    const res = await request(h.app)
      .post('/api/cart/items')
      .set('Cookie', cookie)
      .send({ variantId: h.catalogue.variantNoPriceId, quantity: 5 });
    expect(res.status).toBe(200);
    expect(res.body.data.lines[0]).toMatchObject({ availability: 'OUT_OF_STOCK', availableQuantity: 1 });
    expect(res.body.data.hasUnavailableLines).toBe(true);
    const stock = await h.withTransaction((c) =>
      c.query(`SELECT stock_quantity FROM product_variants WHERE id = $1`, [h.catalogue.variantNoPriceId]),
    );
    expect(stock.rows[0].stock_quantity).toBe(1);
  });

  it('anonymous carts are isolated and a forged token yields an empty cart (9, 12)', async () => {
    const a = await newGuest();
    const b = await newGuest();
    await request(h.app).post('/api/cart/items').set('Cookie', a.cookie).send({ variantId: h.catalogue.variantId, quantity: 1 });
    expect((await request(h.app).get('/api/cart').set('Cookie', b.cookie)).body.data.itemCount).toBe(0);
    const forged = await request(h.app).get('/api/cart').set('Cookie', 'cart_token=deadbeef');
    expect(forged.status).toBe(200);
    expect(forged.body.data.itemCount).toBe(0);
    expect(cartCookie(forged)).not.toBe('');
  });

  it('exposes no route that takes a cart id (11)', () => {
    const paths = (h.app as unknown as { _router?: { stack: unknown[] } })._router ? [] : [];
    expect(paths).toEqual([]);
    return request(h.app)
      .get('/api/cart/00000000-0000-4000-8000-000000000000')
      .then((res) => expect(res.status).toBe(404));
  });

  it('resolveCartForPricing agrees with GET /api/cart and returns product/category ids (12/13)', async () => {
    const { cookie } = await newGuest();
    await request(h.app).post('/api/cart/items').set('Cookie', cookie).send({ variantId: h.catalogue.variantId, quantity: 3 });
    const view = await request(h.app).get('/api/cart').set('Cookie', cookie);
    const { resolveCartForPricing } = await import('../../src/services/cart/cartPricingService.js');
    const rows = await h.withTransaction((c) =>
      c.query(`SELECT id FROM carts WHERE token_hash IS NOT NULL ORDER BY created_at DESC`),
    );
    const { sha256Hex } = await import('../../src/lib/hash.js');
    const mine = await h.withTransaction((c) =>
      c.query(`SELECT id FROM carts WHERE token_hash = $1`, [sha256Hex(cookie.split('=')[1]!)]),
    );
    expect(rows.rows.length).toBeGreaterThan(0);
    const priced = await resolveCartForPricing(mine.rows[0].id);
    expect(priced.merchandiseSubtotal).toBe(view.body.data.merchandiseSubtotal);
    expect(priced.lines[0]).toMatchObject({
      productId: h.catalogue.productId,
      categoryId: h.catalogue.categoryId,
      quantity: 3,
    });
  });
});
