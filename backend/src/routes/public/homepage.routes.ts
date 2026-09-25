import { Router } from 'express';
import { rateLimit } from '../../middleware/rateLimit.js';
import { getHomepageController } from '../../controllers/homepage.controller.js';

/** Public, unauthenticated homepage endpoint (13-homepage-cms §13.15, plan §3.6). */
export function createHomepageRoutes(): Router {
  const router = Router();

  router.get('/', rateLimit('publicCeiling'), getHomepageController);

  return router;
}
