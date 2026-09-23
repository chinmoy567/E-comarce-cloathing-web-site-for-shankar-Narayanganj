import type pg from 'pg';
import { withTransaction } from '../lib/transaction.js';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors.js';
import { sanitizeHtml } from '../lib/sanitizeHtml.js';
import * as categoriesRepository from '../repositories/categories.repository.js';
import * as productsRepository from '../repositories/products.repository.js';
import * as productVariantsRepository from '../repositories/productVariants.repository.js';
import * as productAttributesRepository from '../repositories/productAttributes.repository.js';
import * as inventoryRepository from '../repositories/inventory.repository.js';
import * as auditRepository from '../repositories/audit.repository.js';
import { collisionCandidate, generateSlug } from './slug.service.js';
import type { PaginationQuery } from '../lib/pagination.js';
import type { ProductStatus } from '../types/catalogue.js';
import type { ProductRecord } from '../repositories/products.repository.js';
import type { VariantRecord } from '../repositories/productVariants.repository.js';

/**
 * Product create/update orchestration (spec 05 §Types, §Validation rules,
 * §Deletion semantics).
 */

export type Actor = { userId: string; role: 'ADMIN' | 'MANAGER' };

export type VariantResponse = {
  id: string;
  sku: string | null;
  price: number | null;
  compareAtPrice: number | null;
  stockQuantity: number;
  lowStockThreshold: number;
  isActive: boolean;
  attributeValueIds: string[];
};

export type ProductResponse = {
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
  variants: VariantResponse[];
  images: [];
  totalStock: number;
  isOutOfStock: boolean;
};

export type CreateVariantInput = {
  sku?: string | null;
  price?: number | null;
  compareAtPrice?: number | null;
  stockQuantity: number;
  lowStockThreshold?: number;
  attributeValueIds: string[];
};

export type CreateProductInput = {
  categoryId: string;
  name: string;
  sku?: string | null;
  description?: string | null;
  basePrice: number;
  compareAtPrice?: number | null;
  weightGrams?: number | null;
  isFeatured?: boolean;
  variants: CreateVariantInput[];
};

export type UpdateProductInput = {
  categoryId?: string;
  name?: string;
  sku?: string | null;
  description?: string | null;
  basePrice?: number;
  compareAtPrice?: number | null;
  weightGrams?: number | null;
  isFeatured?: boolean;
  /** Explicit opt-in slug change (seo skill §2: slugs are stable by default). */
  slug?: string;
};

const MAX_SLUG_ATTEMPTS = 10;

function normalizeCombination(ids: string[]): string {
  return [...ids].sort().join(',');
}

async function assertCategoryExists(categoryId: string, client: pg.PoolClient): Promise<void> {
  const category = await categoriesRepository.findById(categoryId, client);
  if (!category) {
    throw new ValidationError('Category does not exist.', [{ field: 'categoryId', message: 'does not exist' }]);
  }
}

async function assertAttributeValuesExist(
  attributeValueIds: string[],
  client: pg.PoolClient,
): Promise<void> {
  if (attributeValueIds.length === 0) return;
  const found = await productAttributesRepository.findValuesByIds(attributeValueIds, client);
  const foundIds = new Set(found.map((v) => v.id));
  const missing = attributeValueIds.filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    throw new ValidationError('One or more attribute values do not exist.', [
      { field: 'attributeValueIds', message: `unknown: ${missing.join(', ')}` },
    ]);
  }
}

/**
 * Attribute-value-combination uniqueness within a product (§5.1's "Black / M
 * is one variant"). `existingCombinations` excludes the variant being
 * updated, if any.
 */
function assertNoCombinationCollision(
  candidate: string[],
  existingCombinations: string[][],
): void {
  const key = normalizeCombination(candidate);
  for (const existing of existingCombinations) {
    if (normalizeCombination(existing) === key) {
      throw new ConflictError(
        'A variant with this attribute-value combination already exists on this product.',
        undefined,
        'VARIANT_COMBINATION_EXISTS',
      );
    }
  }
}

function toVariantResponse(variant: VariantRecord, attributeValueIds: string[]): VariantResponse {
  return {
    id: variant.id,
    sku: variant.sku,
    price: variant.price,
    compareAtPrice: variant.compareAtPrice,
    stockQuantity: variant.stockQuantity,
    lowStockThreshold: variant.lowStockThreshold,
    isActive: variant.isActive,
    attributeValueIds,
  };
}

async function buildProductResponse(
  product: ProductRecord,
  client?: pg.PoolClient,
): Promise<ProductResponse> {
  const variants = await productVariantsRepository.findByProductId(product.id, client);
  const variantResponses: VariantResponse[] = [];
  let totalStock = 0;
  for (const variant of variants) {
    const attributeValueIds = await productVariantsRepository.getAttributeValueIds(variant.id, client);
    variantResponses.push(toVariantResponse(variant, attributeValueIds));
    if (variant.isActive) totalStock += variant.stockQuantity;
  }

  return {
    id: product.id,
    categoryId: product.categoryId,
    name: product.name,
    slug: product.slug,
    sku: product.sku,
    description: product.description,
    basePrice: product.basePrice,
    compareAtPrice: product.compareAtPrice,
    status: product.status,
    isFeatured: product.isFeatured,
    weightGrams: product.weightGrams,
    variants: variantResponses,
    images: [],
    // Derived only — never stored (§5.1 note). No column named out_of_stock exists.
    totalStock,
    isOutOfStock: totalStock === 0,
  };
}

export async function listProducts(
  filter: productsRepository.ProductListFilter,
  pagination: PaginationQuery,
) {
  const { items, total } = await productsRepository.list(filter, pagination);
  const responses: ProductResponse[] = [];
  for (const item of items) {
    responses.push(await buildProductResponse(item));
  }
  return { items: responses, total };
}

export async function getProduct(id: string): Promise<ProductResponse> {
  const product = await productsRepository.findById(id);
  if (!product) {
    throw new NotFoundError('Product not found.');
  }
  return buildProductResponse(product);
}

async function insertVariants(
  productId: string,
  variants: CreateVariantInput[],
  client: pg.PoolClient,
): Promise<void> {
  const combinationsSoFar: string[][] = [];
  for (const variant of variants) {
    await assertAttributeValuesExist(variant.attributeValueIds, client);
    assertNoCombinationCollision(variant.attributeValueIds, combinationsSoFar);
    combinationsSoFar.push(variant.attributeValueIds);

    const created = await productVariantsRepository.create(
      {
        productId,
        sku: variant.sku ?? null,
        price: variant.price ?? null,
        compareAtPrice: variant.compareAtPrice ?? null,
        stockQuantity: variant.stockQuantity,
        lowStockThreshold: variant.lowStockThreshold,
      },
      client,
    );

    if (variant.attributeValueIds.length > 0) {
      await productVariantsRepository.setAttributeValues(created.id, variant.attributeValueIds, client);
    }
  }
}

export async function createProduct(actor: Actor, input: CreateProductInput): Promise<ProductResponse> {
  if (input.variants.length === 0) {
    throw new ValidationError('At least one variant is required.', [
      { field: 'variants', message: 'must contain at least one entry' },
    ]);
  }

  const sanitizedDescription = input.description ? sanitizeHtml(input.description) : null;
  const base = generateSlug(input.name);

  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt++) {
    const candidate = collisionCandidate(base, attempt);
    try {
      return await withTransaction(async (client) => {
        await assertCategoryExists(input.categoryId, client);

        const product = await productsRepository.create(
          {
            categoryId: input.categoryId,
            name: input.name,
            slug: candidate,
            sku: input.sku ?? null,
            description: sanitizedDescription,
            basePrice: input.basePrice,
            compareAtPrice: input.compareAtPrice ?? null,
            weightGrams: input.weightGrams ?? null,
            isFeatured: input.isFeatured ?? false,
            createdBy: actor.userId,
          },
          client,
        );

        await insertVariants(product.id, input.variants, client);

        await auditRepository.append(
          {
            entityType: 'product',
            entityId: product.id,
            action: 'product_created',
            newValue: { name: product.name, slug: product.slug },
            actorUserId: actor.userId,
            actorType: 'USER',
          },
          client,
        );

        return buildProductResponse(product, client);
      });
    } catch (err) {
      if (err instanceof ConflictError && err.code === 'PRODUCT_SLUG_EXISTS') {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

export async function updateProduct(
  actor: Actor,
  id: string,
  input: UpdateProductInput,
): Promise<ProductResponse> {
  return withTransaction(async (client) => {
    const existing = await productsRepository.findById(id, client);
    if (!existing) {
      throw new NotFoundError('Product not found.');
    }

    if (input.categoryId !== undefined) {
      await assertCategoryExists(input.categoryId, client);
    }

    const sanitizedDescription =
      input.description !== undefined
        ? input.description === null
          ? null
          : sanitizeHtml(input.description)
        : undefined;

    const updated = await productsRepository.update(
      id,
      {
        categoryId: input.categoryId,
        name: input.name,
        slug: input.slug,
        sku: input.sku,
        description: sanitizedDescription,
        basePrice: input.basePrice,
        compareAtPrice: input.compareAtPrice,
        weightGrams: input.weightGrams,
        isFeatured: input.isFeatured,
        updatedBy: actor.userId,
      },
      client,
    );

    await auditRepository.append(
      {
        entityType: 'product',
        entityId: id,
        action: 'product_updated',
        previousValue: existing,
        newValue: updated,
        actorUserId: actor.userId,
        actorType: 'USER',
      },
      client,
    );

    return buildProductResponse(updated!, client);
  });
}

/**
 * 409 PRODUCT_REFERENCED if any order line item references one of its
 * variants. Order tables don't exist until spec 11 — the repository hook
 * `countOrderLineItemReferences` always returns 0 until then, so this guard
 * never fires today; only the FK from product_variants applies.
 */
export async function deleteProduct(actor: Actor, id: string): Promise<void> {
  return withTransaction(async (client) => {
    const existing = await productsRepository.findById(id, client);
    if (!existing) {
      throw new NotFoundError('Product not found.');
    }

    const referenced = await productsRepository.countOrderLineItemReferences(id, client);
    if (referenced > 0) {
      throw new ConflictError(
        'This product has been ordered and cannot be deleted. Deactivate it instead.',
        undefined,
        'PRODUCT_REFERENCED',
      );
    }

    await productsRepository.remove(id, client);

    await auditRepository.append(
      {
        entityType: 'product',
        entityId: id,
        action: 'product_deleted',
        previousValue: { name: existing.name, slug: existing.slug },
        actorUserId: actor.userId,
        actorType: 'USER',
      },
      client,
    );
  });
}

export type UpdatePriceInput = { basePrice?: number; compareAtPrice?: number | null };

export async function updatePrice(actor: Actor, id: string, input: UpdatePriceInput): Promise<ProductResponse> {
  return withTransaction(async (client) => {
    const existing = await productsRepository.findById(id, client);
    if (!existing) {
      throw new NotFoundError('Product not found.');
    }

    const updated = await productsRepository.update(
      id,
      {
        basePrice: input.basePrice,
        compareAtPrice: input.compareAtPrice,
        updatedBy: actor.userId,
      },
      client,
    );

    await auditRepository.append(
      {
        entityType: 'product',
        entityId: id,
        action: 'price_updated',
        previousValue: { basePrice: existing.basePrice, compareAtPrice: existing.compareAtPrice },
        newValue: { basePrice: updated!.basePrice, compareAtPrice: updated!.compareAtPrice },
        actorUserId: actor.userId,
        actorType: 'USER',
      },
      client,
    );

    return buildProductResponse(updated!, client);
  });
}

export type UpdateVisibilityInput = { status: ProductStatus };

export async function updateVisibility(
  actor: Actor,
  id: string,
  input: UpdateVisibilityInput,
): Promise<ProductResponse> {
  return withTransaction(async (client) => {
    const existing = await productsRepository.findById(id, client);
    if (!existing) {
      throw new NotFoundError('Product not found.');
    }

    const updated = await productsRepository.update(
      id,
      { status: input.status, updatedBy: actor.userId },
      client,
    );

    await auditRepository.append(
      {
        entityType: 'product',
        entityId: id,
        action: 'visibility_updated',
        previousValue: { status: existing.status },
        newValue: { status: updated!.status },
        actorUserId: actor.userId,
        actorType: 'USER',
      },
      client,
    );

    return buildProductResponse(updated!, client);
  });
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

export async function createVariant(
  actor: Actor,
  productId: string,
  input: CreateVariantInput,
): Promise<VariantResponse> {
  return withTransaction(async (client) => {
    const product = await productsRepository.findById(productId, client);
    if (!product) {
      throw new NotFoundError('Product not found.');
    }

    await assertAttributeValuesExist(input.attributeValueIds, client);
    const existing = await productVariantsRepository.listAttributeValueSetsForProduct(productId, client);
    assertNoCombinationCollision(
      input.attributeValueIds,
      existing.map((e) => e.attributeValueIds),
    );

    const created = await productVariantsRepository.create(
      {
        productId,
        sku: input.sku ?? null,
        price: input.price ?? null,
        compareAtPrice: input.compareAtPrice ?? null,
        stockQuantity: input.stockQuantity,
        lowStockThreshold: input.lowStockThreshold,
      },
      client,
    );

    if (input.attributeValueIds.length > 0) {
      await productVariantsRepository.setAttributeValues(created.id, input.attributeValueIds, client);
    }

    await auditRepository.append(
      {
        entityType: 'product_variant',
        entityId: created.id,
        action: 'variant_created',
        newValue: { productId, sku: created.sku },
        actorUserId: actor.userId,
        actorType: 'USER',
      },
      client,
    );

    return toVariantResponse(created, input.attributeValueIds);
  });
}

export type UpdateVariantInput = {
  sku?: string | null;
  price?: number | null;
  compareAtPrice?: number | null;
  lowStockThreshold?: number;
  isActive?: boolean;
  attributeValueIds?: string[];
};

export async function updateVariant(
  actor: Actor,
  id: string,
  input: UpdateVariantInput,
): Promise<VariantResponse> {
  return withTransaction(async (client) => {
    const existing = await productVariantsRepository.findById(id, client);
    if (!existing) {
      throw new NotFoundError('Variant not found.');
    }

    if (input.attributeValueIds !== undefined) {
      await assertAttributeValuesExist(input.attributeValueIds, client);
      const others = await productVariantsRepository.listAttributeValueSetsForProduct(
        existing.productId,
        client,
      );
      assertNoCombinationCollision(
        input.attributeValueIds,
        others.filter((o) => o.variantId !== id).map((o) => o.attributeValueIds),
      );
      await client.query(`DELETE FROM product_variant_values WHERE variant_id = $1`, [id]);
      if (input.attributeValueIds.length > 0) {
        await productVariantsRepository.setAttributeValues(id, input.attributeValueIds, client);
      }
    }

    const updated = await productVariantsRepository.update(
      id,
      {
        sku: input.sku,
        price: input.price,
        compareAtPrice: input.compareAtPrice,
        lowStockThreshold: input.lowStockThreshold,
        isActive: input.isActive,
      },
      client,
    );

    await auditRepository.append(
      {
        entityType: 'product_variant',
        entityId: id,
        action: 'variant_updated',
        previousValue: existing,
        newValue: updated,
        actorUserId: actor.userId,
        actorType: 'USER',
      },
      client,
    );

    const attributeValueIds = await productVariantsRepository.getAttributeValueIds(id, client);
    return toVariantResponse(updated!, attributeValueIds);
  });
}

/** Same delete-guard rule as products: a referenced variant is never deleted. */
export async function deleteVariant(actor: Actor, id: string): Promise<void> {
  return withTransaction(async (client) => {
    const existing = await productVariantsRepository.findById(id, client);
    if (!existing) {
      throw new NotFoundError('Variant not found.');
    }

    await productVariantsRepository.remove(id, client);

    await auditRepository.append(
      {
        entityType: 'product_variant',
        entityId: id,
        action: 'variant_deleted',
        previousValue: { productId: existing.productId, sku: existing.sku },
        actorUserId: actor.userId,
        actorType: 'USER',
      },
      client,
    );
  });
}

/** Manual stock adjustment — `PATCH /variants/:id/stock`. Requires a `reason`. */
export async function adjustStock(
  actor: Actor,
  id: string,
  stockQuantity: number,
  reason: string,
): Promise<VariantResponse> {
  return withTransaction(async (client) => {
    const existing = await productVariantsRepository.findById(id, client);
    if (!existing) {
      throw new NotFoundError('Variant not found.');
    }

    const result = await inventoryRepository.setQuantity(client, id, stockQuantity);
    if (!result.updated) {
      throw new NotFoundError('Variant not found.');
    }

    await auditRepository.append(
      {
        entityType: 'product_variant',
        entityId: id,
        action: 'stock_adjust',
        previousValue: { stockQuantity: result.previousQuantity },
        newValue: { stockQuantity: result.newQuantity },
        reason,
        actorUserId: actor.userId,
        actorType: 'USER',
      },
      client,
    );

    const updated = (await productVariantsRepository.findById(id, client))!;
    const attributeValueIds = await productVariantsRepository.getAttributeValueIds(id, client);
    return toVariantResponse(updated, attributeValueIds);
  });
}
