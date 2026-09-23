import { z } from 'zod';
import { paginationQuerySchema } from '../lib/pagination.js';
import { ATTRIBUTE_TYPES, PRODUCT_STATUSES } from '../types/catalogue.js';

/**
 * Catalogue request schemas (spec 05 §Validation rules). `.strict()`
 * throughout — an unknown field is rejected, never ignored
 * (11-security-hardening §11.6).
 *
 * `slug` is never accepted from the client on create (§Slug generation) —
 * no schema here has a `slug` field on a create shape. `PATCH /products/:id`
 * accepts an explicit opt-in `slug` field only, per the stability rule.
 */

const idSchema = z.string().uuid('Must be a valid id.');

/** name: 1-200 chars, trimmed. */
const nameSchema = z.string().trim().min(1, 'Required.').max(200, 'Must be at most 200 characters.');

/** Price fields: >= 0, at most 2 decimal places, numeric not float-imprecise. */
const moneySchema = z
  .number()
  .nonnegative('Must be zero or greater.')
  .refine((value) => Number.isInteger(Math.round(value * 100)), {
    message: 'Must have at most 2 decimal places.',
  });

const stockQuantitySchema = z.number().int('Must be a whole number.').nonnegative('Must be zero or greater.');

const statusSchema = z.enum(PRODUCT_STATUSES);
const attributeTypeSchema = z.enum(ATTRIBUTE_TYPES);

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const categoryIdParamsSchema = z.object({ id: idSchema }).strict();

export const listCategoriesQuerySchema = paginationQuerySchema;

export const createCategorySchema = z
  .object({
    parentId: idSchema.nullable().optional(),
    name: nameSchema,
    description: z.string().max(5000).nullable().optional(),
    displayOrder: z.number().int().optional(),
    status: statusSchema.optional(),
    imageUrl: z.string().url().nullable().optional(),
  })
  .strict();
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = z
  .object({
    parentId: idSchema.nullable().optional(),
    name: nameSchema.optional(),
    description: z.string().max(5000).nullable().optional(),
    displayOrder: z.number().int().optional(),
    status: statusSchema.optional(),
    imageUrl: z.string().url().nullable().optional(),
  })
  .strict();
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

// ---------------------------------------------------------------------------
// Attributes
// ---------------------------------------------------------------------------

export const attributeIdParamsSchema = z.object({ id: idSchema }).strict();

export const attributeValueParamsSchema = z
  .object({ id: idSchema, valueId: idSchema })
  .strict();

export const createAttributeSchema = z
  .object({
    type: attributeTypeSchema,
    name: nameSchema,
    displayOrder: z.number().int().optional(),
  })
  .strict();
export type CreateAttributeInput = z.infer<typeof createAttributeSchema>;

export const createAttributeValueSchema = z
  .object({
    value: z.string().trim().min(1, 'Required.').max(100, 'Must be at most 100 characters.'),
    displayOrder: z.number().int().optional(),
  })
  .strict();
export type CreateAttributeValueInput = z.infer<typeof createAttributeValueSchema>;

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export const productIdParamsSchema = z.object({ id: idSchema }).strict();

export const listProductsQuerySchema = paginationQuerySchema.extend({
  categoryId: idSchema.optional(),
  status: statusSchema.optional(),
  isFeatured: z.coerce.boolean().optional(),
  search: z.string().trim().min(1).max(200).optional(),
});
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;

const attributeValueIdsSchema = z.array(idSchema);

const createVariantSchema = z
  .object({
    sku: z.string().trim().min(1).max(64).nullable().optional(),
    price: moneySchema.nullable().optional(),
    compareAtPrice: moneySchema.nullable().optional(),
    stockQuantity: stockQuantitySchema,
    lowStockThreshold: z.number().int().nonnegative().optional(),
    attributeValueIds: attributeValueIdsSchema,
  })
  .strict();

export const createProductSchema = z
  .object({
    categoryId: idSchema,
    name: nameSchema,
    sku: z.string().trim().min(1).max(64).nullable().optional(),
    description: z.string().max(20000).nullable().optional(),
    basePrice: moneySchema,
    compareAtPrice: moneySchema.nullable().optional(),
    weightGrams: z.number().int().positive().nullable().optional(),
    isFeatured: z.boolean().optional(),
    variants: z.array(createVariantSchema).min(1, 'At least one variant is required.'),
  })
  .strict();
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = z
  .object({
    categoryId: idSchema.optional(),
    name: nameSchema.optional(),
    sku: z.string().trim().min(1).max(64).nullable().optional(),
    description: z.string().max(20000).nullable().optional(),
    basePrice: moneySchema.optional(),
    compareAtPrice: moneySchema.nullable().optional(),
    weightGrams: z.number().int().positive().nullable().optional(),
    isFeatured: z.boolean().optional(),
    // Explicit opt-in slug change (seo skill §2) — never implicit on rename.
    slug: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9-]+$/, 'Must be lowercase letters, numbers, and hyphens only.')
      .optional(),
  })
  .strict();
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const updatePriceSchema = z
  .object({
    basePrice: moneySchema.optional(),
    compareAtPrice: moneySchema.nullable().optional(),
  })
  .strict()
  .refine((value) => value.basePrice !== undefined || value.compareAtPrice !== undefined, {
    message: 'At least one of basePrice or compareAtPrice is required.',
  });
export type UpdatePriceInput = z.infer<typeof updatePriceSchema>;

export const updateVisibilitySchema = z.object({ status: statusSchema }).strict();
export type UpdateVisibilityInput = z.infer<typeof updateVisibilitySchema>;

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

export const variantIdParamsSchema = z.object({ id: idSchema }).strict();

export const createProductVariantSchema = createVariantSchema;
export type CreateProductVariantInput = z.infer<typeof createProductVariantSchema>;

export const updateVariantSchema = z
  .object({
    sku: z.string().trim().min(1).max(64).nullable().optional(),
    price: moneySchema.nullable().optional(),
    compareAtPrice: moneySchema.nullable().optional(),
    lowStockThreshold: z.number().int().nonnegative().optional(),
    isActive: z.boolean().optional(),
    attributeValueIds: attributeValueIdsSchema.optional(),
  })
  .strict();
export type UpdateVariantInput = z.infer<typeof updateVariantSchema>;

export const updateStockSchema = z
  .object({
    stockQuantity: stockQuantitySchema,
    reason: z.string().trim().min(1, 'A reason is required.').max(500),
  })
  .strict();
export type UpdateStockInput = z.infer<typeof updateStockSchema>;
