import { run, type Db } from './db.js';
import { toDomainError } from './pgErrors.js';

/**
 * Product variants and their attribute-value combinations (spec 05
 * §Database changes — `product_variants`, `product_variant_values`).
 *
 * Stock reads/writes go through `inventory.repository.ts`, not here — this
 * module owns variant identity/pricing/attribute-combination CRUD.
 */

type VariantRow = {
  id: string;
  product_id: string;
  sku: string | null;
  price: string | null;
  compare_at_price: string | null;
  stock_quantity: number;
  low_stock_threshold: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
};

export type VariantRecord = {
  id: string;
  productId: string;
  sku: string | null;
  price: number | null;
  compareAtPrice: number | null;
  stockQuantity: number;
  lowStockThreshold: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const COLUMNS = `
  id, product_id, sku, price, compare_at_price, stock_quantity,
  low_stock_threshold, is_active, created_at, updated_at
`;

function toNumberOrNull(value: string | null): number | null {
  return value === null ? null : Number(value);
}

function toRecord(row: VariantRow): VariantRecord {
  return {
    id: row.id,
    productId: row.product_id,
    sku: row.sku,
    price: toNumberOrNull(row.price),
    compareAtPrice: toNumberOrNull(row.compare_at_price),
    stockQuantity: row.stock_quantity,
    lowStockThreshold: row.low_stock_threshold,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function findById(id: string, db?: Db): Promise<VariantRecord | null> {
  return run(db, async (client) => {
    const { rows } = await client.query<VariantRow>(
      `SELECT ${COLUMNS} FROM product_variants WHERE id = $1`,
      [id],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  });
}

export async function findByProductId(productId: string, db?: Db): Promise<VariantRecord[]> {
  return run(db, async (client) => {
    const { rows } = await client.query<VariantRow>(
      `SELECT ${COLUMNS} FROM product_variants WHERE product_id = $1 ORDER BY created_at`,
      [productId],
    );
    return rows.map(toRecord);
  });
}

export type CreateVariantInput = {
  productId: string;
  sku?: string | null;
  price?: number | null;
  compareAtPrice?: number | null;
  stockQuantity: number;
  lowStockThreshold?: number;
};

export async function create(input: CreateVariantInput, db?: Db): Promise<VariantRecord> {
  return run(db, async (client) => {
    try {
      const { rows } = await client.query<VariantRow>(
        `INSERT INTO product_variants (
           product_id, sku, price, compare_at_price, stock_quantity, low_stock_threshold
         ) VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING ${COLUMNS}`,
        [
          input.productId,
          input.sku ?? null,
          input.price ?? null,
          input.compareAtPrice ?? null,
          input.stockQuantity,
          input.lowStockThreshold ?? 5,
        ],
      );
      return toRecord(rows[0]!);
    } catch (err) {
      throw toDomainError(err);
    }
  });
}

export type UpdateVariantInput = {
  sku?: string | null;
  price?: number | null;
  compareAtPrice?: number | null;
  lowStockThreshold?: number;
  isActive?: boolean;
};

export async function update(
  id: string,
  input: UpdateVariantInput,
  db?: Db,
): Promise<VariantRecord | null> {
  const sets: string[] = [];
  const values: unknown[] = [id];

  const assign = (column: string, value: unknown): void => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };

  if (input.sku !== undefined) assign('sku', input.sku);
  if (input.price !== undefined) assign('price', input.price);
  if (input.compareAtPrice !== undefined) assign('compare_at_price', input.compareAtPrice);
  if (input.lowStockThreshold !== undefined) assign('low_stock_threshold', input.lowStockThreshold);
  if (input.isActive !== undefined) assign('is_active', input.isActive);

  if (sets.length === 0) return findById(id, db);

  return run(db, async (client) => {
    try {
      const { rows } = await client.query<VariantRow>(
        `UPDATE product_variants SET ${sets.join(', ')}, updated_at = now()
          WHERE id = $1
          RETURNING ${COLUMNS}`,
        values,
      );
      return rows[0] ? toRecord(rows[0]) : null;
    } catch (err) {
      throw toDomainError(err);
    }
  });
}

export async function remove(id: string, db?: Db): Promise<void> {
  return run(db, async (client) => {
    try {
      await client.query(`DELETE FROM product_variants WHERE id = $1`, [id]);
    } catch (err) {
      throw toDomainError(err);
    }
  });
}

/** The attribute-value ids that define one variant, in no particular order. */
export async function getAttributeValueIds(variantId: string, db?: Db): Promise<string[]> {
  return run(db, async (client) => {
    const { rows } = await client.query<{ attribute_value_id: string }>(
      `SELECT attribute_value_id FROM product_variant_values WHERE variant_id = $1`,
      [variantId],
    );
    return rows.map((row) => row.attribute_value_id);
  });
}

/**
 * Every existing variant of a product paired with its attribute-value id set,
 * used by the service layer to detect a duplicate combination before insert.
 */
export async function listAttributeValueSetsForProduct(
  productId: string,
  db?: Db,
): Promise<Array<{ variantId: string; attributeValueIds: string[] }>> {
  return run(db, async (client) => {
    const { rows } = await client.query<{ variant_id: string; attribute_value_id: string | null }>(
      `SELECT v.id AS variant_id, vv.attribute_value_id
         FROM product_variants v
         LEFT JOIN product_variant_values vv ON vv.variant_id = v.id
        WHERE v.product_id = $1`,
      [productId],
    );
    const byVariant = new Map<string, string[]>();
    for (const row of rows) {
      const list = byVariant.get(row.variant_id) ?? [];
      if (row.attribute_value_id) list.push(row.attribute_value_id);
      byVariant.set(row.variant_id, list);
    }
    return [...byVariant.entries()].map(([variantId, attributeValueIds]) => ({
      variantId,
      attributeValueIds,
    }));
  });
}

export async function setAttributeValues(
  variantId: string,
  attributeValueIds: string[],
  db?: Db,
): Promise<void> {
  return run(db, async (client) => {
    try {
      for (const attributeValueId of attributeValueIds) {
        await client.query(
          `INSERT INTO product_variant_values (variant_id, attribute_value_id) VALUES ($1,$2)`,
          [variantId, attributeValueId],
        );
      }
    } catch (err) {
      throw toDomainError(err);
    }
  });
}

/** Sum of active variants' stock for a product — `totalStock` in `ProductResponse`. */
export async function sumActiveStockForProduct(productId: string, db?: Db): Promise<number> {
  return run(db, async (client) => {
    const { rows } = await client.query<{ total: string | null }>(
      `SELECT sum(stock_quantity)::text AS total
         FROM product_variants
        WHERE product_id = $1 AND is_active`,
      [productId],
    );
    return rows[0]?.total ? Number(rows[0].total) : 0;
  });
}
