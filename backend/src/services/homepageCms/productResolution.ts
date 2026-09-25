import type pg from 'pg';
import { run, type Db } from '../../repositories/db.js';
import type { PublicProductSummary } from '../../types/homepageCms.js';

/**
 * Product resolution for `PRODUCT_CAROUSEL` sections (13-homepage-cms §13.5,
 * §13.6, plan §3). This is the minimal spec-07 `activeProductScope()` slice —
 * scoped to exactly the filters the four automatic rules need, not a general
 * storefront-browsing query. A full spec 07 generalizes it later (plan §10).
 *
 * Every automatic rule reads `products.status = 'ACTIVE'` plus an
 * active-variant-with-stock join, so "excluded when out of stock" (§13.5) is
 * enforced identically across rules rather than re-implemented per rule.
 */

export type AutomaticRule = 'LATEST' | 'FEATURED' | 'CATEGORY' | 'ON_SALE';

type ProductQueryRow = {
  id: string;
  name: string;
  slug: string;
  image_url: string | null;
  price: string;
  compare_at_price: string | null;
  is_featured: boolean;
  out_of_stock: boolean;
};

function toSummary(row: ProductQueryRow): PublicProductSummary {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    imageUrl: row.image_url,
    price: Number(row.price),
    compareAtPrice: row.compare_at_price === null ? null : Number(row.compare_at_price),
    isFeatured: row.is_featured,
    outOfStock: row.out_of_stock,
  };
}

/** Primary product image, if any — `product_images` is populated by spec 06's upload path, still empty in this slice. */
const PRIMARY_IMAGE_SUBQUERY = `(
  SELECT pi.storage_path FROM product_images pi
   WHERE pi.product_id = p.id
   ORDER BY pi.is_primary DESC, pi.display_order ASC
   LIMIT 1
)`;

const STOCK_SUBQUERY = `EXISTS (
  SELECT 1 FROM product_variants pv
   WHERE pv.product_id = p.id AND pv.is_active AND pv.stock_quantity > 0
)`;

const PRODUCT_SUMMARY_COLUMNS = `
  p.id, p.name, p.slug, ${PRIMARY_IMAGE_SUBQUERY} AS image_url,
  COALESCE(
    (SELECT MIN(pv.price) FROM product_variants pv WHERE pv.product_id = p.id AND pv.price IS NOT NULL),
    p.base_price
  ) AS price,
  p.compare_at_price, p.is_featured,
  NOT ${STOCK_SUBQUERY} AS out_of_stock
`;

export type AutomaticResolutionInput = {
  rule: AutomaticRule;
  limit: number;
  categoryId?: string;
};

async function resolveSubcategoryIds(client: pg.PoolClient, categoryId: string): Promise<string[]> {
  const { rows } = await client.query<{ id: string }>(`SELECT id FROM categories WHERE parent_id = $1`, [categoryId]);
  return [categoryId, ...rows.map((r) => r.id)];
}

/**
 * Automatic-mode product resolution (§13.5). Always excludes Inactive and
 * out-of-stock products — a narrower rule than spec 07's category browsing
 * will use, deliberately: a promotional carousel should not advertise what
 * cannot be bought (plan §3.9 item 2).
 */
export async function resolveAutomaticProducts(input: AutomaticResolutionInput, db?: Db): Promise<PublicProductSummary[]> {
  return run(db, async (client) => {
    const baseConditions = [`p.status = 'ACTIVE'`, STOCK_SUBQUERY];
    const values: unknown[] = [];

    switch (input.rule) {
      case 'LATEST': {
        if (input.categoryId) {
          values.push(input.categoryId);
          baseConditions.push(`p.category_id = $${values.length}`);
        }
        values.push(input.limit);
        const { rows } = await client.query<ProductQueryRow>(
          `SELECT ${PRODUCT_SUMMARY_COLUMNS} FROM products p
            WHERE ${baseConditions.join(' AND ')}
            ORDER BY p.created_at DESC
            LIMIT $${values.length}`,
          values,
        );
        return rows.map(toSummary);
      }
      case 'FEATURED': {
        baseConditions.push(`p.is_featured = true`);
        values.push(input.limit);
        const { rows } = await client.query<ProductQueryRow>(
          `SELECT ${PRODUCT_SUMMARY_COLUMNS} FROM products p
            WHERE ${baseConditions.join(' AND ')}
            ORDER BY p.created_at DESC
            LIMIT $${values.length}`,
          values,
        );
        return rows.map(toSummary);
      }
      case 'CATEGORY': {
        if (!input.categoryId) return [];
        const categoryIds = await resolveSubcategoryIds(client, input.categoryId);
        values.push(categoryIds);
        baseConditions.push(`p.category_id = ANY($${values.length}::uuid[])`);
        values.push(input.limit);
        const { rows } = await client.query<ProductQueryRow>(
          `SELECT ${PRODUCT_SUMMARY_COLUMNS} FROM products p
            WHERE ${baseConditions.join(' AND ')}
            ORDER BY p.created_at DESC
            LIMIT $${values.length}`,
          values,
        );
        return rows.map(toSummary);
      }
      case 'ON_SALE': {
        if (input.categoryId) {
          values.push(input.categoryId);
          baseConditions.push(`p.category_id = $${values.length}`);
        }
        values.push(input.limit);
        // Union of (A) a visible compare_at_price markdown — a display field,
        // never entering the §8.14 discount-calculation chain — and (B)
        // products/categories under an ACTIVE, in-schedule, product- or
        // category-restricted coupon. B returns nothing until §8.12
        // enforcement ships, by design (plan §3, "ON_SALE resolution").
        // ALL_PRODUCTS-eligibility coupons are excluded from B: with a
        // storewide coupon active every product would qualify, degenerating
        // the rule into LATEST.
        const { rows } = await client.query<ProductQueryRow>(
          `SELECT ${PRODUCT_SUMMARY_COLUMNS} FROM products p
            WHERE ${baseConditions.join(' AND ')}
              AND (
                (p.compare_at_price IS NOT NULL AND p.compare_at_price > p.base_price)
                OR EXISTS (
                  SELECT 1 FROM coupon_products cp
                  JOIN coupons c ON c.id = cp.coupon_id
                  WHERE cp.product_id = p.id
                    AND c.status = 'ACTIVE' AND c.product_eligibility = 'SPECIFIC_PRODUCTS'
                    AND c.starts_at <= now() AND c.expires_at >= now()
                )
                OR EXISTS (
                  SELECT 1 FROM coupon_categories cc
                  JOIN coupons c ON c.id = cc.coupon_id
                  WHERE cc.category_id = p.category_id
                    AND c.status = 'ACTIVE' AND c.product_eligibility = 'SPECIFIC_CATEGORIES'
                    AND c.starts_at <= now() AND c.expires_at >= now()
                )
              )
            ORDER BY p.created_at DESC
            LIMIT $${values.length}`,
          values,
        );
        return rows.map(toSummary);
      }
    }
  });
}

/**
 * Manual-mode product resolution (§13.6). `Active` products only; out-of-stock
 * manual picks still render (with the badge, via `outOfStock`), and any
 * product is selectable regardless of `is_featured`.
 */
export async function resolveManualProducts(sectionId: string, db?: Db): Promise<PublicProductSummary[]> {
  return run(db, async (client) => {
    const { rows } = await client.query<ProductQueryRow>(
      `SELECT ${PRODUCT_SUMMARY_COLUMNS}
         FROM homepage_section_products hsp
         JOIN products p ON p.id = hsp.product_id
        WHERE hsp.section_id = $1 AND p.status = 'ACTIVE'
        ORDER BY hsp.display_order ASC`,
      [sectionId],
    );
    return rows.map(toSummary);
  });
}

export async function resolveManualCampaignProducts(campaignId: string, db?: Db): Promise<PublicProductSummary[]> {
  return run(db, async (client) => {
    const { rows } = await client.query<ProductQueryRow>(
      `SELECT ${PRODUCT_SUMMARY_COLUMNS}
         FROM campaign_products cp
         JOIN products p ON p.id = cp.product_id
        WHERE cp.campaign_id = $1 AND p.status = 'ACTIVE'
        ORDER BY cp.display_order ASC`,
      [campaignId],
    );
    return rows.map(toSummary);
  });
}
