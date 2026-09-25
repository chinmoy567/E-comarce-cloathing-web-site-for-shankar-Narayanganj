import { Router } from 'express';
import { rateLimit } from '../../middleware/rateLimit.js';
import { listPublicCategoriesController } from '../../controllers/publicCategories.controller.js';

/** Public, unauthenticated category list (spec 02, plan §10). */
export function createPublicCategoriesRoutes(): Router {
  const router = Router();

  router.get('/', rateLimit('publicCeiling'), listPublicCategoriesController);

  return router;
}
