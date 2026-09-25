import type pg from 'pg';
import { run, type Db } from './db.js';

/** Ordered category attachment for a homepage section (13-homepage-cms §13.6). Full-replace only. */

export async function listCategoryIds(sectionId: string, db?: Db): Promise<string[]> {
  return run(db, async (client) => {
    const { rows } = await client.query<{ category_id: string }>(
      `SELECT category_id FROM homepage_section_categories WHERE section_id = $1 ORDER BY display_order ASC`,
      [sectionId],
    );
    return rows.map((r) => r.category_id);
  });
}

/** Replaces the full ordered set. Must run inside a caller-managed transaction so the delete+insert is atomic. */
export async function replaceAll(sectionId: string, categoryIds: string[], client: pg.PoolClient): Promise<void> {
  await client.query(`DELETE FROM homepage_section_categories WHERE section_id = $1`, [sectionId]);
  for (let i = 0; i < categoryIds.length; i += 1) {
    await client.query(`INSERT INTO homepage_section_categories (section_id, category_id, display_order) VALUES ($1,$2,$3)`, [
      sectionId,
      categoryIds[i],
      i,
    ]);
  }
}
