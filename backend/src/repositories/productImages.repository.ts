import { run, type Db } from './db.js';

/**
 * `product_images` (spec 05 table, spec 06 operations). `storage_path` holds the public URL the
 * storefront renders; `storage_object_id` points at the registry row used to delete the object.
 * Callers that change several rows pass one transaction client and lock the parent product first.
 */

export type ProductImageRecord = {
  id: string;
  productId: string;
  storagePath: string;
  storageObjectId: string | null;
  altText: string | null;
  displayOrder: number;
  isPrimary: boolean;
};

type Row = {
  id: string;
  product_id: string;
  storage_path: string;
  storage_object_id: string | null;
  alt_text: string | null;
  display_order: number;
  is_primary: boolean;
};

const COLUMNS = `id, product_id, storage_path, storage_object_id, alt_text, display_order, is_primary`;

function toRecord(row: Row): ProductImageRecord {
  return {
    id: row.id,
    productId: row.product_id,
    storagePath: row.storage_path,
    storageObjectId: row.storage_object_id,
    altText: row.alt_text,
    displayOrder: row.display_order,
    isPrimary: row.is_primary,
  };
}

/** Serialises image changes for one product (count limit, primary swap, reorder). */
export async function lockProduct(productId: string, db?: Db): Promise<boolean> {
  return run(db, async (client) => {
    const { rowCount } = await client.query(`SELECT 1 FROM products WHERE id = $1 FOR UPDATE`, [productId]);
    return (rowCount ?? 0) > 0;
  });
}

export async function listByProduct(productId: string, db?: Db): Promise<ProductImageRecord[]> {
  return run(db, async (client) => {
    const { rows } = await client.query<Row>(
      `SELECT ${COLUMNS} FROM product_images WHERE product_id = $1 ORDER BY display_order, created_at, id`,
      [productId],
    );
    return rows.map(toRecord);
  });
}

export async function findById(id: string, db?: Db): Promise<ProductImageRecord | null> {
  return run(db, async (client) => {
    const { rows } = await client.query<Row>(`SELECT ${COLUMNS} FROM product_images WHERE id = $1`, [id]);
    return rows[0] ? toRecord(rows[0]) : null;
  });
}

export type InsertProductImage = {
  productId: string;
  storagePath: string;
  storageObjectId: string;
  altText: string | null;
  displayOrder: number;
  isPrimary: boolean;
};

export async function insert(input: InsertProductImage, db?: Db): Promise<ProductImageRecord> {
  return run(db, async (client) => {
    const { rows } = await client.query<Row>(
      `INSERT INTO product_images (product_id, storage_path, storage_object_id, alt_text, display_order, is_primary)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${COLUMNS}`,
      [input.productId, input.storagePath, input.storageObjectId, input.altText, input.displayOrder, input.isPrimary],
    );
    return toRecord(rows[0]!);
  });
}

export async function updateAltText(id: string, altText: string | null, db?: Db): Promise<ProductImageRecord | null> {
  return run(db, async (client) => {
    const { rows } = await client.query<Row>(
      `UPDATE product_images SET alt_text = $2 WHERE id = $1 RETURNING ${COLUMNS}`,
      [id, altText],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  });
}

/** Clears then sets in order, so the one-primary partial unique index is never violated. */
export async function setPrimary(productId: string, imageId: string, db?: Db): Promise<void> {
  await run(db, async (client) => {
    await client.query(`UPDATE product_images SET is_primary = false WHERE product_id = $1 AND is_primary`, [productId]);
    await client.query(`UPDATE product_images SET is_primary = true WHERE id = $1 AND product_id = $2`, [imageId, productId]);
  });
}

/** Rewrites every image's order from the full ordered id list in one statement. */
export async function setOrder(productId: string, orderedIds: string[], db?: Db): Promise<void> {
  await run(db, (client) =>
    client.query(
      `UPDATE product_images AS pi SET display_order = o.ord
         FROM (SELECT id, ord - 1 AS ord FROM unnest($2::uuid[]) WITH ORDINALITY AS t(id, ord)) AS o
        WHERE pi.id = o.id AND pi.product_id = $1`,
      [productId, orderedIds],
    ),
  );
}

export async function remove(id: string, db?: Db): Promise<void> {
  await run(db, (client) => client.query(`DELETE FROM product_images WHERE id = $1`, [id]));
}

/** Registry rows behind a product's images, read before the product (and its image rows) is deleted. */
export async function listObjectsForProduct(
  productId: string,
  db?: Db,
): Promise<Array<{ objectId: string; bucket: string; objectPath: string }>> {
  return run(db, async (client) => {
    const { rows } = await client.query<{ id: string; bucket: string; object_path: string }>(
      `SELECT so.id, so.bucket, so.object_path
         FROM product_images pi JOIN storage_objects so ON so.id = pi.storage_object_id
        WHERE pi.product_id = $1 AND so.deleted_at IS NULL`,
      [productId],
    );
    return rows.map((r) => ({ objectId: r.id, bucket: r.bucket, objectPath: r.object_path }));
  });
}
