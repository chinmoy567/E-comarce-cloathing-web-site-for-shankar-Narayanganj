import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { optionalAuth } from '../../middleware/optionalAuth.js';
import {
  createOrderController,
  getCustomerOrderHistoryController,
  getCustomerOrderDetailController,
} from '../../controllers/checkout.controller.js';
import {
  createOrderSchema,
  customerOrderHistoryQuerySchema,
  customerOrderNumberParamSchema,
} from '../../validation/checkout.validation.js';

/**
 * Customer order endpoints (spec 11 — 02-customer §2.9, 03-payment-order §3; spec 15 §2.6).
 * Mounted at `/api/customer/orders`. The public guest lookup moved to
 * `POST /api/orders/lookup` (routes/public/orderLookup.routes.ts): it must never be a GET.
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

// Registered-customer order history.
router.get(
  '/',
  requireAuth('customer'),
  rateLimit('authenticatedCeiling'),
  validate({ query: customerOrderHistoryQuerySchema }),
  getCustomerOrderHistoryController,
);

// One order of the signed-in customer, addressed by Order Number — never an internal id.
router.get(
  '/:orderNumber',
  requireAuth('customer'),
  rateLimit('authenticatedCeiling'),
  validate({ params: customerOrderNumberParamSchema }),
  getCustomerOrderDetailController,
);

export default router;
