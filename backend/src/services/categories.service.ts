import { withTransaction } from '../lib/transaction.js';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors.js';
import { sanitizeHtml } from '../lib/sanitizeHtml.js';
import * as categoriesRepository from '../repositories/categories.repository.js';
import * as auditRepository from '../repositories/audit.repository.js';
import { collisionCandidate, generateSlug } from './slug.service.js';
import type { PaginationQuery } from '../lib/pagination.js';
import type { ProductStatus } from '../types/catalogue.js';
import type { CategoryRecord } from '../repositories/categories.repository.js';

/**
 * Category management (spec 05 §Database changes — `categories`,
 * §Deletion semantics).
 *
 * Depth-limit enforcement (two levels: category -> subcategory) is a
 * service-layer check, not a schema constraint — §5.1 speaks only of
 * "categories and subcategories".
 */

export type Actor = { userId: string; role: 'ADMIN' | 'MANAGER' };

export type CategoryResponse = {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string | null;
  displayOrder: number;
  status: ProductStatus;
  imageUrl: string | null;
};

function toResponse(record: CategoryRecord): CategoryResponse {
  return {
    id: record.id,
    parentId: record.parentId,
    name: record.name,
    slug: record.slug,
    description: record.description,
    displayOrder: record.displayOrder,
    status: record.status,
    imageUrl: record.imageUrl,
  };
}

const MAX_SLUG_ATTEMPTS = 10;

async function insertWithUniqueSlug(
  name: string,
  build: (slug: string) => Promise<CategoryRecord>,
): Promise<CategoryRecord> {
  const base = generateSlug(name);
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt++) {
    const candidate = collisionCandidate(base, attempt);
    try {
      return await build(candidate);
    } catch (err) {
      if (err instanceof ConflictError && err.code === 'CATEGORY_SLUG_EXISTS') {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

export async function listCategories(pagination: PaginationQuery) {
  const { items, total } = await categoriesRepository.list(pagination);
  return { items: items.map(toResponse), total };
}

export type CreateCategoryInput = {
  parentId?: string | null;
  name: string;
  description?: string | null;
  displayOrder?: number;
  status?: ProductStatus;
  imageUrl?: string | null;
};

async function assertValidParent(parentId: string | null | undefined): Promise<void> {
  if (!parentId) return;
  const parent = await categoriesRepository.findById(parentId);
  if (!parent) {
    throw new ValidationError('Parent category does not exist.', [
      { field: 'parentId', message: 'does not exist' },
    ]);
  }
  // Two-level depth: a category that itself has a parent cannot be a parent.
  if (parent.parentId !== null) {
    throw new ValidationError('Category depth is limited to two levels.', [
      { field: 'parentId', message: 'cannot be a subcategory of a subcategory' },
    ]);
  }
}

export async function createCategory(actor: Actor, input: CreateCategoryInput): Promise<CategoryResponse> {
  await assertValidParent(input.parentId);

  const sanitizedDescription = input.description ? sanitizeHtml(input.description) : null;

  const created = await insertWithUniqueSlug(input.name, (slug) =>
    withTransaction(async (client) => {
      try {
        const record = await categoriesRepository.create(
          {
            parentId: input.parentId ?? null,
            name: input.name,
            slug,
            description: sanitizedDescription,
            displayOrder: input.displayOrder,
            status: input.status,
            imageUrl: input.imageUrl ?? null,
            createdBy: actor.userId,
          },
          client,
        );

        await auditRepository.append(
          {
            entityType: 'category',
            entityId: record.id,
            action: 'category_created',
            newValue: { name: record.name, slug: record.slug },
            actorUserId: actor.userId,
            actorType: 'USER',
          },
          client,
        );

        return record;
      } catch (err) {
        // The `UNIQUE(slug)` constraint via pgErrors -> ConflictError with
        // code CATEGORY_SLUG_EXISTS is the retry signal for insertWithUniqueSlug.
        throw err;
      }
    }),
  );

  return toResponse(created);
}

export type UpdateCategoryInput = {
  parentId?: string | null;
  name?: string;
  description?: string | null;
  displayOrder?: number;
  status?: ProductStatus;
  imageUrl?: string | null;
};

export async function updateCategory(
  actor: Actor,
  id: string,
  input: UpdateCategoryInput,
): Promise<CategoryResponse> {
  if (input.parentId !== undefined) {
    if (input.parentId === id) {
      throw new ValidationError('A category cannot be its own parent.', [
        { field: 'parentId', message: 'cannot equal the category id' },
      ]);
    }
    await assertValidParent(input.parentId);
  }

  const sanitizedDescription =
    input.description !== undefined
      ? input.description === null
        ? null
        : sanitizeHtml(input.description)
      : undefined;

  return withTransaction(async (client) => {
    const existing = await categoriesRepository.findById(id, client);
    if (!existing) {
      throw new NotFoundError('Category not found.');
    }

    const updated = await categoriesRepository.update(
      id,
      {
        parentId: input.parentId,
        name: input.name,
        description: sanitizedDescription,
        displayOrder: input.displayOrder,
        status: input.status,
        imageUrl: input.imageUrl,
        updatedBy: actor.userId,
      },
      client,
    );

    await auditRepository.append(
      {
        entityType: 'category',
        entityId: id,
        action: 'category_updated',
        previousValue: existing,
        newValue: updated,
        actorUserId: actor.userId,
        actorType: 'USER',
      },
      client,
    );

    return toResponse(updated!);
  });
}

/** 409 CATEGORY_NOT_EMPTY if children or products exist. */
export async function deleteCategory(actor: Actor, id: string): Promise<void> {
  return withTransaction(async (client) => {
    const existing = await categoriesRepository.findById(id, client);
    if (!existing) {
      throw new NotFoundError('Category not found.');
    }

    const [childCount, productCount] = await Promise.all([
      categoriesRepository.countChildren(id, client),
      categoriesRepository.countProducts(id, client),
    ]);

    if (childCount > 0 || productCount > 0) {
      throw new ConflictError(
        'This category still has subcategories or products and cannot be deleted.',
        undefined,
        'CATEGORY_NOT_EMPTY',
      );
    }

    await categoriesRepository.remove(id, client);

    await auditRepository.append(
      {
        entityType: 'category',
        entityId: id,
        action: 'category_deleted',
        previousValue: { name: existing.name, slug: existing.slug },
        actorUserId: actor.userId,
        actorType: 'USER',
      },
      client,
    );
  });
}
