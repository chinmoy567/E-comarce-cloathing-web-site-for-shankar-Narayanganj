import type { PaginationQuery } from '../lib/pagination.js';
import type { ProductStatus } from '../types/catalogue.js';
import { run, type Db } from './db.js';
import { toDomainError } from './pgErrors.js';

/**
 * Products (spec 05 §Database changes — `products`).
 *
 * `totalStock`/`isOutOfStock` are computed at read time via a join/aggregate
 * over `product_variants` (§5.1 note) — never stored, never written.
 */

type ProductRow = {
  id: string;
  category_id: string;
  name: string;
  slug: string;
  sku: string | null;
  description: string | null;
  base_price: string;
  compare_at_price: string | null;
  status: ProductStatus;
  is_featured: boolean;
  weight_grams: number | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
};

export type ProductRecord = {
  id: string;
  categoryId: string;
  name: string;
  slug: string;
  sku: string | null;
  description: string | null;
  basePrice: number;
  compareAtPrice: number | null;
  status: ProductStatus;
  isFeatured: boolean;
  weightGrams: number | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const COLUMNS = `
  id, category_id, name, slug, sku, description, base_price, compare_at_price,
  status, is_featured, weight_grams, created_by, updated_by, created_at, updated_at
`;

function toRecord(row: ProductRow): ProductRecord {
  return {
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    slug: row.slug,
    sku: row.sku,
    description: row.description,
    basePrice: Number(row.base_price),
    compareAtPrice: row.compare_at_price === null ? null : Number(row.compare_at_price),
    status: row.status,
    isFeatured: row.is_featured,
    weightGrams: row.weight_grams,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function findById(id: string, db?: Db): Promise<ProductRecord | null> {
  return run(db, async (client) => {
    const { rows } = await client.query<ProductRow>(
      `SELECT ${COLUMNS} FROM products WHERE id = $1`,
      [id],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  });
}

export async function findBySlug(slug: string, db?: Db): Promise<ProductRecord | null> {
  return run(db, async (client) => {
    const { rows } = await client.query<ProductRow>(
      `SELECT ${COLUMNS} FROM products WHERE slug = $1`,
      [slug],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  });
}

export type ProductListFilter = {
  categoryId?: string;
  status?: ProductStatus;
  isFeatured?: boolean;
  search?: string;
};

export async function list(
  filter: ProductListFilter,
  pagination: PaginationQuery,
  db?: Db,
): Promise<{ items: ProductRecord[]; total: number }> {
  const { page, pageSize } = pagination;
  return run(db, async (client) => {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filter.categoryId) {
      values.push(filter.categoryId);
      conditions.push(`category_id = $${values.length}`);
    }
    if (filter.status) {
      values.push(filter.status);
      conditions.push(`status = $${values.length}`);
    }
    if (filter.isFeatured !== undefined) {
      values.push(filter.isFeatured);
      conditions.push(`is_featured = $${values.length}`);
    }
    if (filter.search) {
      values.push(`%${filter.search}%`);
      conditions.push(`name ILIKE $${values.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    values.push(pageSize, (page - 1) * pageSize);

    const { rows } = await client.query<ProductRow & { total: string }>(
      `SELECT ${COLUMNS}, count(*) OVER()::text AS total
         FROM products
         ${where}
        ORDER BY created_at DESC
        LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return {
      items: rows.map(toRecord),
      total: rows[0] ? Number(rows[0].total) : 0,
    };
  });
}

export type CreateProductInput = {
  categoryId: string;
  name: string;
  slug: string;
  sku?: string | null;
  description?: string | null;
  basePrice: number;
  compareAtPrice?: number | null;
  weightGrams?: number | null;
  isFeatured?: boolean;
  status?: ProductStatus;
  createdBy: string;
};

export async function create(input: CreateProductInput, db?: Db): Promise<ProductRecord> {
  return run(db, async (client) => {
    try {
      const { rows } = await client.query<ProductRow>(
        `INSERT INTO products (
           category_id, name, slug, sku, description, base_price, compare_at_price,
           status, is_featured, weight_grams, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING ${COLUMNS}`,
        [
          input.categoryId,
          input.name,
          input.slug,
          input.sku ?? null,
          input.description ?? null,
          input.basePrice,
          input.compareAtPrice ?? null,
          input.status ?? 'INACTIVE',
          input.isFeatured ?? false,
          input.weightGrams ?? null,
          input.createdBy,
        ],
      );
      return toRecord(rows[0]!);
    } catch (err) {
      throw toDomainError(err);
    }
  });
}

export type UpdateProductInput = {
  categoryId?: string;
  name?: string;
  slug?: string;
  sku?: string | null;
  description?: string | null;
  basePrice?: number;
  compareAtPrice?: number | null;
  weightGrams?: number | null;
  isFeatured?: boolean;
  status?: ProductStatus;
  updatedBy: string;
};

export async function update(
  id: string,
  input: UpdateProductInput,
  db?: Db,
): Promise<ProductRecord | null> {
  const sets: string[] = [];
  const values: unknown[] = [id];

  const assign = (column: string, value: unknown): void => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };

  if (input.categoryId !== undefined) assign('category_id', input.categoryId);
  if (input.name !== undefined) assign('name', input.name);
  if (input.slug !== undefined) assign('slug', input.slug);
  if (input.sku !== undefined) assign('sku', input.sku);
  if (input.description !== undefined) assign('description', input.description);
  if (input.basePrice !== undefined) assign('base_price', input.basePrice);
  if (input.compareAtPrice !== undefined) assign('compare_at_price', input.compareAtPrice);
  if (input.weightGrams !== undefined) assign('weight_grams', input.weightGrams);
  if (input.isFeatured !== undefined) assign('is_featured', input.isFeatured);
  if (input.status !== undefined) assign('status', input.status);
  assign('updated_by', input.updatedBy);

  return run(db, async (client) => {
    try {
      const { rows } = await client.query<ProductRow>(
        `UPDATE products SET ${sets.join(', ')}, updated_at = now()
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
      await client.query(`DELETE FROM products WHERE id = $1`, [id]);
    } catch (err) {
      throw toDomainError(err);
    }
  });
}

/**
 * Hook point for spec 11's order-line-item delete-guard. Order tables do not
 * exist until spec 11 — until then this always returns 0, so the guard never
 * fires. Spec 11 replaces this implementation with a real join against order
 * line items; the call site in `products.service.ts` does not change.
 */
export async function countOrderLineItemReferences(_productId: string, _db?: Db): Promise<number> {
  return 0;
}
