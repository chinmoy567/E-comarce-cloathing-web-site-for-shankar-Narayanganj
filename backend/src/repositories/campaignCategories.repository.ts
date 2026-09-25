import type pg from 'pg';
import { run, type Db } from './db.js';

/** Ordered category attachment for a campaign (13-homepage-cms §13.6a). Full-replace only. */

export async function listCategoryIds(campaignId: string, db?: Db): Promise<string[]> {
  return run(db, async (client) => {
    const { rows } = await client.query<{ category_id: string }>(
      `SELECT category_id FROM campaign_categories WHERE campaign_id = $1 ORDER BY display_order ASC`,
      [campaignId],
    );
    return rows.map((r) => r.category_id);
  });
}

/** Replaces the full ordered set. Must run inside a caller-managed transaction so the delete+insert is atomic. */
export async function replaceAll(campaignId: string, categoryIds: string[], client: pg.PoolClient): Promise<void> {
  await client.query(`DELETE FROM campaign_categories WHERE campaign_id = $1`, [campaignId]);
  for (let i = 0; i < categoryIds.length; i += 1) {
    await client.query(`INSERT INTO campaign_categories (campaign_id, category_id, display_order) VALUES ($1,$2,$3)`, [
      campaignId,
      categoryIds[i],
      i,
    ]);
  }
}
