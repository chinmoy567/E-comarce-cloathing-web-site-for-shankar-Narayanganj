import { Router } from 'express';
import { guestOrderLookupController, trackOrderController } from '../../controllers/checkout.controller.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { guestOrderLookupSchema, trackOrderSchema } from '../../validation/checkout.validation.js';

/**
 * Public, unauthenticated lookups (spec 15). Deliberately two separate routes with separate
 * limiters, request shapes and responses — Track Order and the guest order lookup are NOT the
 * same feature and must not be merged (04-courier §4.14.1).
 *
 * Both are POST so identifiers never appear in a URL, browser history, access log or Referer.
 */
export function createOrderLookupRoutes(): Router {
  const router = Router();

  // Order Number + phone, per-order and per-IP limits with temporary lockout (§2.9.7).
  router.post('/orders/lookup', rateLimit('guestOrderLookup'), validate({ body: guestOrderLookupSchema }), guestOrderLookupController);

  // Courier Order ID / Tracking ID — its own limiter instance, independent of the guest lookup (§4.16).
  router.post('/track-order', rateLimit('trackOrder'), validate({ body: trackOrderSchema }), trackOrderController);

  return router;
}
