import type { NextFunction, Request, Response } from 'express';
import * as publicCategoriesRepository from '../repositories/publicCategories.repository.js';
import type { ApiSuccess } from '../types/api.js';

/** Public storefront category list (spec 02 §"Browse products by category"). No auth, no pagination — bounded by admin-managed category count. */
export async function listPublicCategoriesController(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const items = await publicCategoriesRepository.listActive();
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.status(200).json({ data: items } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}
