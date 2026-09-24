import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { ingestAnalyticsEvent } from '../../controllers/analytics.controller.js';
import { analyticsEventRequestSchema } from '../../validation/analytics.validation.js';

export function createAnalyticsRoutes(): Router {
  const router = Router();

  router.post('/event', validate({ body: analyticsEventRequestSchema }), ingestAnalyticsEvent);

  return router;
}
