import type { PaginationQuery } from '../lib/pagination.js';
import type { ProductStatus } from '../types/catalogue.js';
import { run, type Db } from './db.js';
import { toDomainError } from './pgErrors.js';

/**
 * Categories and subcategories (spec 05 §Database changes — `categories`).
 *
 * Depth-limit enforcement (a category with a non-null `parent_id` cannot
 * itself be a parent) and the delete-guard 409 live in `categories.service.ts`
 * — this module is raw CRUD plus the existence checks the service needs.
 */

type CategoryRow = {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  display_order: number;
  status: ProductStatus;
  image_url: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
};

export type CategoryRecord = {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string | null;
  displayOrder: number;
  status: ProductStatus;
  imageUrl: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const COLUMNS = `
  id, parent_id, name, slug, description, display_order, status, image_url,
  created_by, updated_by, created_at, updated_at
`;

function toRecord(row: CategoryRow): CategoryRecord {
  return {
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    displayOrder: row.display_order,
    status: row.status,
    imageUrl: row.image_url,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function findById(id: string, db?: Db): Promise<CategoryRecord | null> {
  return run(db, async (client) => {
    const { rows } = await client.query<CategoryRow>(
      `SELECT ${COLUMNS} FROM categories WHERE id = $1`,
      [id],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  });
}

export async function findBySlug(slug: string, db?: Db): Promise<CategoryRecord | null> {
  return run(db, async (client) => {
    const { rows } = await client.query<CategoryRow>(
      `SELECT ${COLUMNS} FROM categories WHERE slug = $1`,
      [slug],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  });
}

export async function list(
  pagination: PaginationQuery,
  db?: Db,
): Promise<{ items: CategoryRecord[]; total: number }> {
  const { page, pageSize } = pagination;
  return run(db, async (client) => {
    const { rows } = await client.query<CategoryRow & { total: string }>(
      `SELECT ${COLUMNS}, count(*) OVER()::text AS total
         FROM categories
        ORDER BY parent_id NULLS FIRST, display_order, name
        LIMIT $1 OFFSET $2`,
      [pageSize, (page - 1) * pageSize],
    );
    return {
      items: rows.map(toRecord),
      total: rows[0] ? Number(rows[0].total) : 0,
    };
  });
}

export type CreateCategoryInput = {
  parentId?: string | null;
  name: string;
  slug: string;
  description?: string | null;
  displayOrder?: number;
  status?: ProductStatus;
  imageUrl?: string | null;
  createdBy: string;
};

export async function create(input: CreateCategoryInput, db?: Db): Promise<CategoryRecord> {
  return run(db, async (client) => {
    try {
      const { rows } = await client.query<CategoryRow>(
        `INSERT INTO categories (
           parent_id, name, slug, description, display_order, status, image_url, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING ${COLUMNS}`,
        [
          input.parentId ?? null,
          input.name,
          input.slug,
          input.description ?? null,
          input.displayOrder ?? 0,
          input.status ?? 'ACTIVE',
          input.imageUrl ?? null,
          input.createdBy,
        ],
      );
      return toRecord(rows[0]!);
    } catch (err) {
      throw toDomainError(err);
    }
  });
}

export type UpdateCategoryInput = {
  parentId?: string | null;
  name?: string;
  slug?: string;
  description?: string | null;
  displayOrder?: number;
  status?: ProductStatus;
  imageUrl?: string | null;
  updatedBy: string;
};

export async function update(
  id: string,
  input: UpdateCategoryInput,
  db?: Db,
): Promise<CategoryRecord | null> {
  const sets: string[] = [];
  const values: unknown[] = [id];

  const assign = (column: string, value: unknown): void => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };

  if (input.parentId !== undefined) assign('parent_id', input.parentId);
  if (input.name !== undefined) assign('name', input.name);
  if (input.slug !== undefined) assign('slug', input.slug);
  if (input.description !== undefined) assign('description', input.description);
  if (input.displayOrder !== undefined) assign('display_order', input.displayOrder);
  if (input.status !== undefined) assign('status', input.status);
  if (input.imageUrl !== undefined) assign('image_url', input.imageUrl);
  assign('updated_by', input.updatedBy);

  return run(db, async (client) => {
    try {
      const { rows } = await client.query<CategoryRow>(
        `UPDATE categories SET ${sets.join(', ')}, updated_at = now()
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

/** Used by the delete-guard: does this category have any child categories? */
export async function countChildren(id: string, db?: Db): Promise<number> {
  return run(db, async (client) => {
    const { rows } = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM categories WHERE parent_id = $1`,
      [id],
    );
    return Number(rows[0]!.count);
  });
}

/** Used by the delete-guard: does this category have any products? */
export async function countProducts(id: string, db?: Db): Promise<number> {
  return run(db, async (client) => {
    const { rows } = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM products WHERE category_id = $1`,
      [id],
    );
    return Number(rows[0]!.count);
  });
}

export async function remove(id: string, db?: Db): Promise<void> {
  return run(db, async (client) => {
    try {
      await client.query(`DELETE FROM categories WHERE id = $1`, [id]);
    } catch (err) {
      throw toDomainError(err);
    }
  });
}
