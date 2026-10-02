import { Router } from 'express';
import { z } from 'zod';
import type { NextFunction, Request, Response } from 'express';
import { paginationQuerySchema, buildPagination, type PaginationQuery } from '../../lib/pagination.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { validate } from '../../middleware/validate.js';
import * as cmsLookupsRepository from '../../repositories/cmsLookups.repository.js';
import type { ApiListSuccess } from '../../types/api.js';

/**
 * CMS picker lookups (17-homepage-cms-and-campaigns): minimal product/category
 * projections behind `cms.manage` alone, so a Manager holding only that
 * permission can use the pickers without `product.update`/`category.manage`.
 */
const router = Router();

const productLookupQuerySchema = paginationQuerySchema.extend({ q: z.string().trim().max(100).optional() }).strict();

router.get(
  '/products',
  requirePermission('cms.manage'),
  validate({ query: productLookupQuerySchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = req.query as unknown as PaginationQuery & { q?: string };
      const { items, total } = await cmsLookupsRepository.searchProducts(query.q || undefined, query);
      res.status(200).json({ data: items, pagination: buildPagination(query, total) } satisfies ApiListSuccess<unknown>);
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/categories',
  requirePermission('cms.manage'),
  validate({ query: paginationQuerySchema.strict() }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = req.query as unknown as PaginationQuery;
      const { items, total } = await cmsLookupsRepository.listCategories(query);
      res.status(200).json({ data: items, pagination: buildPagination(query, total) } satisfies ApiListSuccess<unknown>);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
