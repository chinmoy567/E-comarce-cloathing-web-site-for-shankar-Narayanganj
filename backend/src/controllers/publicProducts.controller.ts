import type { NextFunction, Request, Response } from 'express';
import * as publicProductsService from '../services/publicProducts.service.js';
import type { ListPublicProductsQuery, ProductSlugParams } from '../validation/publicProducts.validation.js';
import { buildPagination } from '../lib/pagination.js';
import type { ApiListSuccess, ApiSuccess } from '../types/api.js';

/** Public storefront product endpoints (spec 02). No auth required. */
export async function listPublicProductsController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = req.query as unknown as ListPublicProductsQuery;
    const { page, pageSize, categoryId, search } = query;
    const { items, total } = await publicProductsService.listProducts(
      { categoryId, search },
      { page, pageSize },
    );
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.status(200).json({
      data: items,
      pagination: buildPagination({ page, pageSize }, total),
    } satisfies ApiListSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function getPublicProductController(
  req: Request<ProductSlugParams>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await publicProductsService.getProductBySlug(req.params.slug);
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.status(200).json({ data: result } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}
