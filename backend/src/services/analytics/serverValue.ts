import { CURRENCY, type MetaContent } from '@shared/analytics';
import { withTransaction } from '../../lib/transaction.js';

/**
 * Server-side monetary value for browser-initiated events (§8.31, §8.16): the
 * client sends only ids and integer quantities; prices come from the catalogue.
 * An id may be a variant id or a product id; unknown ids are dropped, and the
 * price is the variant price when set, else the product base price.
 */
export async function resolveContents(
  contents: Array<{ id: string; quantity: number }>,
): Promise<{ contents: MetaContent[]; value: number; currency: typeof CURRENCY } | null> {
  if (contents.length === 0) return null;
  const ids = contents.map((c) => c.id);
  const { rows } = await withTransaction((db) => db.query<{ id: string; price: string }>(
    `SELECT v.id::text AS id, COALESCE(v.price, p.base_price)::text AS price
       FROM product_variants v JOIN products p ON p.id = v.product_id
      WHERE v.id::text = ANY($1)
     UNION ALL
     SELECT p.id::text, p.base_price::text FROM products p WHERE p.id::text = ANY($1)`,
    [ids],
  ));
  const price = new Map<string, number>();
  for (const r of rows) if (!price.has(r.id)) price.set(r.id, Number(r.price));

  const resolved: MetaContent[] = [];
  let value = 0;
  for (const c of contents) {
    const unit = price.get(c.id);
    if (unit === undefined) continue;
    resolved.push({ id: c.id, quantity: c.quantity, item_price: unit });
    value += unit * c.quantity;
  }
  if (resolved.length === 0) return null;
  return { contents: resolved, value: Math.round(value * 100) / 100, currency: CURRENCY };
}
