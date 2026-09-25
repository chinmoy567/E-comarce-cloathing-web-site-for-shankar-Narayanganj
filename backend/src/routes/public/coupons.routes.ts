import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validateCouponController } from '../../controllers/coupons.controller.js';
import { validateCouponSchema } from '../../validation/coupons.validation.js';

/**
 * Public, unauthenticated coupon preview endpoint (10-coupon-discount §8.18,
 * plan §3). A guest has no session, so no `requireAuth` is mounted — the
 * `couponValidate` limiter (already registered in `config/rateLimits.ts`)
 * bounds abuse per §8.28.
 */
export function createCouponsRoutes(): Router {
  const router = Router();

  router.post(
    '/validate',
    rateLimit('couponValidate'),
    validate({ body: validateCouponSchema }),
    validateCouponController,
  );

  return router;
}
