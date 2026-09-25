import type pg from 'pg';
import { run, type Db } from './db.js';

/** Ordered product attachment for a homepage section (13-homepage-cms §13.6). Full-replace only — no partial insert/delete, matching the atomicity requirement in plan §3.5. */

export async function listProductIds(sectionId: string, db?: Db): Promise<string[]> {
  return run(db, async (client) => {
    const { rows } = await client.query<{ product_id: string }>(
      `SELECT product_id FROM homepage_section_products WHERE section_id = $1 ORDER BY display_order ASC`,
      [sectionId],
    );
    return rows.map((r) => r.product_id);
  });
}

/** Replaces the full ordered set. Must run inside a caller-managed transaction so the delete+insert is atomic. */
export async function replaceAll(sectionId: string, productIds: string[], client: pg.PoolClient): Promise<void> {
  await client.query(`DELETE FROM homepage_section_products WHERE section_id = $1`, [sectionId]);
  for (let i = 0; i < productIds.length; i += 1) {
    await client.query(`INSERT INTO homepage_section_products (section_id, product_id, display_order) VALUES ($1,$2,$3)`, [
      sectionId,
      productIds[i],
      i,
    ]);
  }
}
