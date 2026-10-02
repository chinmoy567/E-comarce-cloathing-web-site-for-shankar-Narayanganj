import type { PaginationQuery } from '../lib/pagination.js';
import { run, type Db } from './db.js';

/**
 * Minimal product/category projections for the CMS pickers and attachment
 * reads (17-homepage-cms-and-campaigns, "CMS lookups"). A `cms.manage`-only
 * Manager reaches these without `product.update`/`category.manage`.
 */

export type ProductLookup = { id: string; name: string; slug: string; imageUrl: string | null; isActive: boolean };
export type CategoryLookup = { id: string; name: string; slug: string; parentId: string | null };

type ProductLookupRow = { id: string; name: string; slug: string; image_url: string | null; status: string };
type CategoryLookupRow = { id: string; name: string; slug: string; parent_id: string | null };

const PRIMARY_IMAGE_SUBQUERY = `(
  SELECT pi.storage_path FROM product_images pi
   WHERE pi.product_id = p.id
   ORDER BY pi.is_primary DESC, pi.display_order ASC
   LIMIT 1
)`;

const PRODUCT_COLUMNS = `p.id, p.name, p.slug, ${PRIMARY_IMAGE_SUBQUERY} AS image_url, p.status`;

function toProduct(row: ProductLookupRow): ProductLookup {
  return { id: row.id, name: row.name, slug: row.slug, imageUrl: row.image_url, isActive: row.status === 'ACTIVE' };
}

function toCategory(row: CategoryLookupRow): CategoryLookup {
  return { id: row.id, name: row.name, slug: row.slug, parentId: row.parent_id };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function searchProducts(
  q: string | undefined,
  pagination: PaginationQuery,
  db?: Db,
): Promise<{ items: ProductLookup[]; total: number }> {
  const { page, pageSize } = pagination;
  const pattern = q ? `%${escapeLike(q)}%` : null;
  return run(db, async (client) => {
    const { rows } = await client.query<ProductLookupRow & { total: string }>(
      `SELECT ${PRODUCT_COLUMNS}, count(*) OVER()::text AS total
         FROM products p
        WHERE ($1::text IS NULL OR p.name ILIKE $1 OR p.slug ILIKE $1)
        ORDER BY p.name ASC, p.id ASC
        LIMIT $2 OFFSET $3`,
      [pattern, pageSize, (page - 1) * pageSize],
    );
    return { items: rows.map(toProduct), total: rows[0] ? Number(rows[0].total) : 0 };
  });
}

export async function listCategories(
  pagination: PaginationQuery,
  db?: Db,
): Promise<{ items: CategoryLookup[]; total: number }> {
  const { page, pageSize } = pagination;
  return run(db, async (client) => {
    const { rows } = await client.query<CategoryLookupRow & { total: string }>(
      `SELECT id, name, slug, parent_id, count(*) OVER()::text AS total
         FROM categories
        ORDER BY parent_id NULLS FIRST, display_order ASC, name ASC
        LIMIT $1 OFFSET $2`,
      [pageSize, (page - 1) * pageSize],
    );
    return { items: rows.map(toCategory), total: rows[0] ? Number(rows[0].total) : 0 };
  });
}

type AttachmentTable = {
  table: 'homepage_section_products' | 'homepage_section_categories' | 'campaign_products' | 'campaign_categories';
  owner: 'section_id' | 'campaign_id';
  target: 'product_id' | 'category_id';
};

/** Fixed table/column names only — never interpolates caller input. */
const ATTACHMENTS = {
  sectionProducts: { table: 'homepage_section_products', owner: 'section_id', target: 'product_id' },
  sectionCategories: { table: 'homepage_section_categories', owner: 'section_id', target: 'category_id' },
  campaignProducts: { table: 'campaign_products', owner: 'campaign_id', target: 'product_id' },
  campaignCategories: { table: 'campaign_categories', owner: 'campaign_id', target: 'category_id' },
} satisfies Record<string, AttachmentTable>;

async function attachedProducts(spec: AttachmentTable, ownerId: string, db?: Db): Promise<ProductLookup[]> {
  return run(db, async (client) => {
    const { rows } = await client.query<ProductLookupRow>(
      `SELECT ${PRODUCT_COLUMNS}
         FROM ${spec.table} j
         JOIN products p ON p.id = j.${spec.target}
        WHERE j.${spec.owner} = $1
        ORDER BY j.display_order ASC`,
      [ownerId],
    );
    return rows.map(toProduct);
  });
}

async function attachedCategories(spec: AttachmentTable, ownerId: string, db?: Db): Promise<CategoryLookup[]> {
  return run(db, async (client) => {
    const { rows } = await client.query<CategoryLookupRow>(
      `SELECT c.id, c.name, c.slug, c.parent_id
         FROM ${spec.table} j
         JOIN categories c ON c.id = j.${spec.target}
        WHERE j.${spec.owner} = $1
        ORDER BY j.display_order ASC`,
      [ownerId],
    );
    return rows.map(toCategory);
  });
}

export const listSectionProducts = (id: string, db?: Db) => attachedProducts(ATTACHMENTS.sectionProducts, id, db);
export const listSectionCategories = (id: string, db?: Db) => attachedCategories(ATTACHMENTS.sectionCategories, id, db);
export const listCampaignProducts = (id: string, db?: Db) => attachedProducts(ATTACHMENTS.campaignProducts, id, db);
export const listCampaignCategories = (id: string, db?: Db) => attachedCategories(ATTACHMENTS.campaignCategories, id, db);
