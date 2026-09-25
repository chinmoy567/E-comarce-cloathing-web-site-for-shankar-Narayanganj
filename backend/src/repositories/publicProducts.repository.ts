import { run, type Db } from './db.js';
import type { PaginationQuery } from '../lib/pagination.js';
import type { AttributeType } from '../types/catalogue.js';

/**
 * Public (storefront) product reads — spec 02 §"Browse products by category",
 * "Search and filter products", "View detailed product information".
 *
 * Only `products.status = 'ACTIVE'` rows are ever returned here — this module
 * is never used by the admin catalogue, which reads every status via
 * `products.repository.ts`.
 */

export type PublicProductListItem = {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  basePrice: number;
  compareAtPrice: number | null;
  isFeatured: boolean;
  imageUrl: string | null;
  categoryId: string;
  categoryName: string;
  outOfStock: boolean;
};

type ListRow = {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  base_price: string;
  compare_at_price: string | null;
  is_featured: boolean;
  image_url: string | null;
  category_id: string;
  category_name: string;
  out_of_stock: boolean;
  total: string;
};

const PRIMARY_IMAGE_SUBQUERY = `(
  SELECT pi.storage_path FROM product_images pi
   WHERE pi.product_id = p.id
   ORDER BY pi.is_primary DESC, pi.display_order ASC
   LIMIT 1
)`;

const STOCK_EXISTS_SUBQUERY = `EXISTS (
  SELECT 1 FROM product_variants pv
   WHERE pv.product_id = p.id AND pv.is_active AND pv.stock_quantity > 0
)`;

export type PublicProductListFilter = {
  categoryId?: string;
  search?: string;
};

function toListItem(row: ListRow): PublicProductListItem {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    sku: row.sku,
    basePrice: Number(row.base_price),
    compareAtPrice: row.compare_at_price === null ? null : Number(row.compare_at_price),
    isFeatured: row.is_featured,
    imageUrl: row.image_url,
    categoryId: row.category_id,
    categoryName: row.category_name,
    outOfStock: row.out_of_stock,
  };
}

/** Paginated, active-only product list, optionally filtered by category or name search (§2 "Browse ... Search and filter"). */
export async function list(
  filter: PublicProductListFilter,
  pagination: PaginationQuery,
  db?: Db,
): Promise<{ items: PublicProductListItem[]; total: number }> {
  const { page, pageSize } = pagination;
  return run(db, async (client) => {
    const conditions = [`p.status = 'ACTIVE'`];
    const values: unknown[] = [];

    if (filter.categoryId) {
      values.push(filter.categoryId);
      conditions.push(`p.category_id = $${values.length}`);
    }
    if (filter.search) {
      values.push(`%${filter.search}%`);
      conditions.push(`p.name ILIKE $${values.length}`);
    }

    values.push(pageSize, (page - 1) * pageSize);

    const { rows } = await client.query<ListRow>(
      `SELECT
          p.id, p.name, p.slug, p.sku, p.base_price, p.compare_at_price, p.is_featured,
          ${PRIMARY_IMAGE_SUBQUERY} AS image_url,
          p.category_id, c.name AS category_name,
          NOT ${STOCK_EXISTS_SUBQUERY} AS out_of_stock,
          count(*) OVER()::text AS total
        FROM products p
        JOIN categories c ON c.id = p.category_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY p.created_at DESC
        LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );

    return {
      items: rows.map(toListItem),
      total: rows[0] ? Number(rows[0].total) : 0,
    };
  });
}

export type PublicProductDetailRow = {
  id: string;
  category_id: string;
  category_name: string;
  category_slug: string;
  name: string;
  slug: string;
  sku: string | null;
  description: string | null;
  base_price: string;
  compare_at_price: string | null;
  is_featured: boolean;
  weight_grams: number | null;
};

export type PublicProductDetail = {
  id: string;
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  name: string;
  slug: string;
  sku: string | null;
  description: string | null;
  basePrice: number;
  compareAtPrice: number | null;
  isFeatured: boolean;
  weightGrams: number | null;
};

/** Active product detail by slug — id lookup intentionally not exposed publicly (SEO-friendly URLs, seo skill §4). */
export async function findActiveBySlug(slug: string, db?: Db): Promise<PublicProductDetail | null> {
  return run(db, async (client) => {
    const { rows } = await client.query<PublicProductDetailRow>(
      `SELECT p.id, p.category_id, c.name AS category_name, c.slug AS category_slug,
              p.name, p.slug, p.sku, p.description, p.base_price, p.compare_at_price,
              p.is_featured, p.weight_grams
         FROM products p
         JOIN categories c ON c.id = p.category_id
        WHERE p.slug = $1 AND p.status = 'ACTIVE'`,
      [slug],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      categoryId: row.category_id,
      categoryName: row.category_name,
      categorySlug: row.category_slug,
      name: row.name,
      slug: row.slug,
      sku: row.sku,
      description: row.description,
      basePrice: Number(row.base_price),
      compareAtPrice: row.compare_at_price === null ? null : Number(row.compare_at_price),
      isFeatured: row.is_featured,
      weightGrams: row.weight_grams,
    };
  });
}

export type PublicVariantRow = {
  id: string;
  sku: string | null;
  price: string | null;
  compare_at_price: string | null;
  stock_quantity: number;
  is_active: boolean;
};

export type PublicVariant = {
  id: string;
  sku: string | null;
  price: number | null;
  compareAtPrice: number | null;
  stockQuantity: number;
  isActive: boolean;
  attributeValues: Array<{ attributeId: string; attributeType: AttributeType; attributeName: string; valueId: string; value: string }>;
};

/** Active variants for a product, each with its resolved attribute values (§2 "Select product variants"). */
export async function listActiveVariants(productId: string, db?: Db): Promise<PublicVariant[]> {
  return run(db, async (client) => {
    const { rows: variantRows } = await client.query<PublicVariantRow>(
      `SELECT id, sku, price, compare_at_price, stock_quantity, is_active
         FROM product_variants
        WHERE product_id = $1 AND is_active
        ORDER BY created_at`,
      [productId],
    );
    if (variantRows.length === 0) return [];

    const { rows: valueRows } = await client.query<{
      variant_id: string;
      attribute_id: string;
      attribute_type: AttributeType;
      attribute_name: string;
      value_id: string;
      value: string;
    }>(
      `SELECT vv.variant_id, pa.id AS attribute_id, pa.type AS attribute_type, pa.name AS attribute_name,
              pav.id AS value_id, pav.value
         FROM product_variant_values vv
         JOIN product_attribute_values pav ON pav.id = vv.attribute_value_id
         JOIN product_attributes pa ON pa.id = pav.attribute_id
        WHERE vv.variant_id = ANY($1::uuid[])`,
      [variantRows.map((v) => v.id)],
    );

    const byVariant = new Map<string, PublicVariant['attributeValues']>();
    for (const row of valueRows) {
      const list = byVariant.get(row.variant_id) ?? [];
      list.push({
        attributeId: row.attribute_id,
        attributeType: row.attribute_type,
        attributeName: row.attribute_name,
        valueId: row.value_id,
        value: row.value,
      });
      byVariant.set(row.variant_id, list);
    }

    return variantRows.map((row) => ({
      id: row.id,
      sku: row.sku,
      price: row.price === null ? null : Number(row.price),
      compareAtPrice: row.compare_at_price === null ? null : Number(row.compare_at_price),
      stockQuantity: row.stock_quantity,
      isActive: row.is_active,
      attributeValues: byVariant.get(row.id) ?? [],
    }));
  });
}

export type PublicProductImage = {
  id: string;
  storagePath: string;
  altText: string | null;
  displayOrder: number;
  isPrimary: boolean;
};

export async function listImages(productId: string, db?: Db): Promise<PublicProductImage[]> {
  return run(db, async (client) => {
    const { rows } = await client.query<{
      id: string;
      storage_path: string;
      alt_text: string | null;
      display_order: number;
      is_primary: boolean;
    }>(
      `SELECT id, storage_path, alt_text, display_order, is_primary
         FROM product_images
        WHERE product_id = $1
        ORDER BY is_primary DESC, display_order ASC`,
      [productId],
    );
    return rows.map((row) => ({
      id: row.id,
      storagePath: row.storage_path,
      altText: row.alt_text,
      displayOrder: row.display_order,
      isPrimary: row.is_primary,
    }));
  });
}
