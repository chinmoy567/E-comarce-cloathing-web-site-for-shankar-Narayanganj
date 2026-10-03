import { Router, type NextFunction, type Request, type Response } from 'express';
import { validate } from '../../middleware/validate.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { optionalAuth } from '../../middleware/optionalAuth.js';
import { checkoutValidateController, shippingQuoteController } from '../../controllers/shipping.controller.js';
import { checkoutValidateSchema, shippingQuoteQuerySchema } from '../../validation/shipping.validation.js';

/**
 * Public, advisory shipping endpoints (spec 21). Both are rate-limited under `publicCeiling` so they
 * cannot be used to enumerate configuration at scale, and neither is trusted at order creation.
 */

/**
 * A coupon code on this endpoint is a coupon-validity oracle, exactly like `POST /api/coupons/validate`,
 * so it must meet the same stricter `couponValidate` limiter (10-coupon-discount §8.28) — otherwise code
 * guessing is bounded only by the general public ceiling. Requests without a code are unaffected.
 */
const couponLimiter = rateLimit('couponValidate');
function limitCouponGuessing(req: Request, res: Response, next: NextFunction): void {
  const body = req.body as { couponCode?: string | null } | undefined;
  if (body?.couponCode) {
    void couponLimiter(req, res, next);
    return;
  }
  next();
}

/** Mounted at `/api/shipping`. */
export function createShippingRoutes(): Router {
  const router = Router();
  router.get('/quote', rateLimit('publicCeiling'), validate({ query: shippingQuoteQuerySchema }), shippingQuoteController);
  return router;
}

/** Mounted at `/api/checkout`. `optionalAuth` lets a signed-in customer be priced on their profile address. */
export function createCheckoutRoutes(): Router {
  const router = Router();
  router.post(
    '/validate',
    optionalAuth(),
    rateLimit('publicCeiling'),
    validate({ body: checkoutValidateSchema }),
    limitCouponGuessing,
    checkoutValidateController,
  );
  return router;
}
