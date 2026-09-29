import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { optionalAuth } from '../../middleware/optionalAuth.js';
import {
  createOrderController,
  lookupGuestOrderController,
  getCustomerOrderHistoryController,
  getCustomerOrderDetailController,
} from '../../controllers/checkout.controller.js';
import {
  createOrderSchema,
  guestOrderLookupQuerySchema,
  customerOrderHistoryQuerySchema,
  customerOrderIdParamSchema,
} from '../../validation/checkout.validation.js';

/**
 * Customer order endpoints (spec 11 — 02-customer §2.9, 03-payment-order §3).
 * Mounted at `/api/customer/orders`.
 */
const router = Router();

// Guest or registered checkout — optionalAuth never rejects; absence of a
// valid customer session means the guest path.
router.post(
  '/',
  optionalAuth(),
  rateLimit('publicCeiling'),
  validate({ body: createOrderSchema }),
  createOrderController,
);

// Guest order lookup by (Order Number, Phone Number) — no auth, rate-limited
// with lockout (§2.9.7).
router.get(
  '/lookup',
  rateLimit('guestOrderLookup'),
  validate({ query: guestOrderLookupQuerySchema }),
  lookupGuestOrderController,
);

// Registered-customer order history.
router.get(
  '/',
  requireAuth('customer'),
  rateLimit('authenticatedCeiling'),
  validate({ query: customerOrderHistoryQuerySchema }),
  getCustomerOrderHistoryController,
);

// One order of the signed-in customer. Registered after `/lookup` so the
// literal path is never captured as an id.
router.get(
  '/:id',
  requireAuth('customer'),
  rateLimit('authenticatedCeiling'),
  validate({ params: customerOrderIdParamSchema }),
  getCustomerOrderDetailController,
);

export default router;
