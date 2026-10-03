import { run, type Db } from './db.js';

/**
 * Cart persistence (spec 09). Cart rows hold no price and no PII — prices are joined from the
 * catalogue by `cartPricingService` on every read.
 */

export type CartRecord = { id: string; customerId: string | null };

type CartRow = { id: string; customer_id: string | null };

const toRecord = (row: CartRow): CartRecord => ({ id: row.id, customerId: row.customer_id });

export async function findActiveByCustomer(customerId: string, db?: Db): Promise<CartRecord | null> {
  return run(db, async (client) => {
    const { rows } = await client.query<CartRow>(
      `SELECT id, customer_id FROM carts WHERE customer_id = $1 AND status = 'ACTIVE'`,
      [customerId],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  });
}

export async function findActiveByTokenHash(tokenHash: string, db?: Db): Promise<CartRecord | null> {
  return run(db, async (client) => {
    const { rows } = await client.query<CartRow>(
      `SELECT id, customer_id FROM carts WHERE token_hash = $1 AND status = 'ACTIVE'`,
      [tokenHash],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  });
}

/** Race-safe: the partial unique index makes concurrent creation for one customer yield one row. */
export async function getOrCreateForCustomer(customerId: string, db?: Db): Promise<CartRecord> {
  return run(db, async (client) => {
    await client.query(
      `INSERT INTO carts (customer_id) VALUES ($1)
       ON CONFLICT (customer_id) WHERE customer_id IS NOT NULL AND status = 'ACTIVE' DO NOTHING`,
      [customerId],
    );
    const { rows } = await client.query<CartRow>(
      `SELECT id, customer_id FROM carts WHERE customer_id = $1 AND status = 'ACTIVE'`,
      [customerId],
    );
    return toRecord(rows[0]!);
  });
}

export async function createAnonymous(tokenHash: string, db?: Db): Promise<CartRecord> {
  return run(db, async (client) => {
    const { rows } = await client.query<CartRow>(
      `INSERT INTO carts (token_hash) VALUES ($1) RETURNING id, customer_id`,
      [tokenHash],
    );
    return toRecord(rows[0]!);
  });
}

export async function touch(cartId: string, db?: Db): Promise<void> {
  await run(db, (client) =>
    client.query(`UPDATE carts SET last_activity_at = now(), updated_at = now() WHERE id = $1`, [cartId]),
  );
}

/** True when the variant, its product and its category are all active (the storefront visibility rule). */
export async function isVariantPurchasable(variantId: string, db?: Db): Promise<boolean> {
  return run(db, async (client) => {
    const { rows } = await client.query(
      `SELECT 1
         FROM product_variants pv
         JOIN products p ON p.id = pv.product_id
         JOIN categories c ON c.id = p.category_id
        WHERE pv.id = $1 AND pv.is_active AND p.status = 'ACTIVE' AND c.status = 'ACTIVE'`,
      [variantId],
    );
    return rows.length > 0;
  });
}

/** One line per variant: re-adding increments (capped at 99) instead of duplicating. */
export async function upsertAddItem(cartId: string, variantId: string, quantity: number, db?: Db): Promise<void> {
  await run(db, (client) =>
    client.query(
      `INSERT INTO cart_items (cart_id, product_variant_id, quantity) VALUES ($1, $2, $3)
       ON CONFLICT (cart_id, product_variant_id)
       DO UPDATE SET quantity = LEAST(99, cart_items.quantity + EXCLUDED.quantity), updated_at = now()`,
      [cartId, variantId, quantity],
    ),
  );
}

/** Returns false when the line does not exist. */
export async function setItemQuantity(cartId: string, variantId: string, quantity: number, db?: Db): Promise<boolean> {
  return run(db, async (client) => {
    const res = await client.query(
      `UPDATE cart_items SET quantity = $3, updated_at = now() WHERE cart_id = $1 AND product_variant_id = $2`,
      [cartId, variantId, quantity],
    );
    return (res.rowCount ?? 0) > 0;
  });
}

export async function deleteItem(cartId: string, variantId: string, db?: Db): Promise<boolean> {
  return run(db, async (client) => {
    const res = await client.query(`DELETE FROM cart_items WHERE cart_id = $1 AND product_variant_id = $2`, [
      cartId,
      variantId,
    ]);
    return (res.rowCount ?? 0) > 0;
  });
}

export async function clearItems(cartId: string, db?: Db): Promise<void> {
  await run(db, (client) => client.query(`DELETE FROM cart_items WHERE cart_id = $1`, [cartId]));
}

/**
 * Sums quantities of `fromCartId` into `toCartId` (capped at 99), then retires the source cart. The retired
 * cart is attributed to the customer (token cleared, so the cookie can never reach it again) to satisfy
 * the carts_owner_check constraint.
 */
export async function mergeInto(fromCartId: string, toCartId: string, customerId: string, db?: Db): Promise<void> {
  await run(db, async (client) => {
    await client.query(
      `INSERT INTO cart_items (cart_id, product_variant_id, quantity)
       SELECT $2, product_variant_id, quantity FROM cart_items WHERE cart_id = $1
       ON CONFLICT (cart_id, product_variant_id)
       DO UPDATE SET quantity = LEAST(99, cart_items.quantity + EXCLUDED.quantity), updated_at = now()`,
      [fromCartId, toCartId],
    );
    await client.query(`DELETE FROM cart_items WHERE cart_id = $1`, [fromCartId]);
    await client.query(
      `UPDATE carts SET status = 'ABANDONED', token_hash = NULL, customer_id = $2, updated_at = now() WHERE id = $1`,
      [fromCartId, customerId],
    );
    await client.query(`UPDATE carts SET last_activity_at = now(), updated_at = now() WHERE id = $1`, [toCartId]);
  });
}

export type PricedLineRow = {
  variant_id: string;
  product_id: string;
  category_id: string;
  product_slug: string;
  product_name: string;
  variant_label: string;
  image_url: string | null;
  image_alt: string | null;
  unit_price: string;
  line_total: string;
  quantity: number;
  stock_quantity: number;
  purchasable: boolean;
};

/** The single cart → priced-lines query (no N+1). Price precedence: variant price, else product base price. */
export async function listPricedLines(cartId: string, db?: Db): Promise<PricedLineRow[]> {
  return run(db, async (client) => {
    const { rows } = await client.query<PricedLineRow>(
      `SELECT pv.id AS variant_id, p.id AS product_id, p.category_id, p.slug AS product_slug, p.name AS product_name,
              COALESCE((
                SELECT string_agg(pav.value, ' / ' ORDER BY pa.display_order, pav.display_order)
                  FROM product_variant_values vv
                  JOIN product_attribute_values pav ON pav.id = vv.attribute_value_id
                  JOIN product_attributes pa ON pa.id = pav.attribute_id
                 WHERE vv.variant_id = pv.id
              ), '') AS variant_label,
              img.storage_path AS image_url, img.alt_text AS image_alt,
              COALESCE(pv.price, p.base_price)::text AS unit_price,
              (COALESCE(pv.price, p.base_price) * ci.quantity)::text AS line_total,
              ci.quantity, pv.stock_quantity,
              (pv.is_active AND p.status = 'ACTIVE' AND c.status = 'ACTIVE') AS purchasable
         FROM cart_items ci
         JOIN product_variants pv ON pv.id = ci.product_variant_id
         JOIN products p ON p.id = pv.product_id
         JOIN categories c ON c.id = p.category_id
         LEFT JOIN LATERAL (
           SELECT pi.storage_path, pi.alt_text FROM product_images pi
            WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC, pi.display_order ASC LIMIT 1
         ) img ON true
        WHERE ci.cart_id = $1
        ORDER BY ci.added_at, ci.id`,
      [cartId],
    );
    return rows;
  });
}
