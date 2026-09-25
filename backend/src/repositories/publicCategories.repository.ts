import { run, type Db } from './db.js';

/**
 * Public (storefront) category reads — spec 02 §"Browse products by
 * category". Active categories only.
 */

export type PublicCategory = {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  imageUrl: string | null;
};

type CategoryRow = {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  image_url: string | null;
};

/** Every active category, ordered for a category tree/filter list (parents first, then by display order). */
export async function listActive(db?: Db): Promise<PublicCategory[]> {
  return run(db, async (client) => {
    const { rows } = await client.query<CategoryRow>(
      `SELECT id, parent_id, name, slug, image_url
         FROM categories
        WHERE status = 'ACTIVE'
        ORDER BY parent_id NULLS FIRST, display_order, name`,
    );
    return rows.map((row) => ({
      id: row.id,
      parentId: row.parent_id,
      name: row.name,
      slug: row.slug,
      imageUrl: row.image_url,
    }));
  });
}
