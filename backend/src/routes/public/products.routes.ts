import { Router } from 'express';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import {
  getPublicProductController,
  listPublicProductsController,
} from '../../controllers/publicProducts.controller.js';
import {
  listPublicProductsQuerySchema,
  productSlugParamsSchema,
} from '../../validation/publicProducts.validation.js';

/** Public, unauthenticated product browsing endpoints (spec 02, plan §10). */
export function createPublicProductsRoutes(): Router {
  const router = Router();

  router.get(
    '/',
    rateLimit('publicCeiling'),
    validate({ query: listPublicProductsQuerySchema }),
    listPublicProductsController,
  );

  router.get(
    '/:slug',
    rateLimit('publicCeiling'),
    validate({ params: productSlugParamsSchema }),
    getPublicProductController,
  );

  return router;
}
