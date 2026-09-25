import { z } from 'zod';
import { paginationQuerySchema } from '../lib/pagination.js';

/**
 * Public storefront product request schemas (spec 02 §"Browse products by
 * category", "Search and filter products"). `.strict()` — an unknown query
 * field is rejected, never ignored (11-security-hardening §11.6).
 */

export const listPublicProductsQuerySchema = paginationQuerySchema
  .extend({
    categoryId: z.string().uuid('Must be a valid id.').optional(),
    search: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export type ListPublicProductsQuery = z.infer<typeof listPublicProductsQuerySchema>;

export const productSlugParamsSchema = z
  .object({ slug: z.string().trim().min(1).max(200) })
  .strict();
export type ProductSlugParams = z.infer<typeof productSlugParamsSchema>;
