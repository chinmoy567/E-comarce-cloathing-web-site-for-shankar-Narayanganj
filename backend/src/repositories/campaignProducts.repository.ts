import type pg from 'pg';
import { run, type Db } from './db.js';

/** Ordered product attachment for a campaign (13-homepage-cms §13.6a). Full-replace only. */

export async function listProductIds(campaignId: string, db?: Db): Promise<string[]> {
  return run(db, async (client) => {
    const { rows } = await client.query<{ product_id: string }>(
      `SELECT product_id FROM campaign_products WHERE campaign_id = $1 ORDER BY display_order ASC`,
      [campaignId],
    );
    return rows.map((r) => r.product_id);
  });
}

/** Replaces the full ordered set. Must run inside a caller-managed transaction so the delete+insert is atomic. */
export async function replaceAll(campaignId: string, productIds: string[], client: pg.PoolClient): Promise<void> {
  await client.query(`DELETE FROM campaign_products WHERE campaign_id = $1`, [campaignId]);
  for (let i = 0; i < productIds.length; i += 1) {
    await client.query(`INSERT INTO campaign_products (campaign_id, product_id, display_order) VALUES ($1,$2,$3)`, [
      campaignId,
      productIds[i],
      i,
    ]);
  }
}
