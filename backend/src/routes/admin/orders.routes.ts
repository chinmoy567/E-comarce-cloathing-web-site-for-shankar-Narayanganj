import { Router } from 'express';
import {
  listOrdersController,
  getOrderController,
  confirmOrderController,
  startProcessingController,
  cancelOrderController,
  verifyPaymentController,
  rejectPaymentController,
  resubmitPaymentController,
  getOrderHistoryController,
  checkCustomerRiskController,
} from '../../controllers/admin/orders.controller.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { paginationQuerySchema } from '../../lib/pagination.js';
import {
  listOrdersSchema,
  confirmOrderSchema,
  cancelOrderSchema,
  verifyPaymentSchema,
  rejectPaymentSchema,
  resubmitPaymentSchema,
  checkCustomerRiskSchema,
  orderIdParamsSchema,
} from '../../validation/orders.validation.js';

/**
 * Order, payment, and shipment management endpoints (Spec 07 §5.21).
 * Mounted at `/api/admin/orders` with authentication & rate limiting applied
 * at the router level (admin/index.ts).
 */
const router = Router();

// Order list & detail
router.get('/', validate({ query: listOrdersSchema }), requirePermission('order.view'), listOrdersController);

router.get('/:id', validate({ params: orderIdParamsSchema }), requirePermission('order.view'), getOrderController);

router.get(
  '/:id/history',
  validate({ params: orderIdParamsSchema, query: paginationQuerySchema }),
  requirePermission('order.view'),
  getOrderHistoryController
);

// Order status transitions
router.post(
  '/:id/confirm',
  validate({ params: orderIdParamsSchema, body: confirmOrderSchema }),
  requirePermission('order.confirm'),
  confirmOrderController
);

router.post('/:id/processing', validate({ params: orderIdParamsSchema }), requirePermission('order.confirm'), startProcessingController);

router.post(
  '/:id/cancel',
  validate({ params: orderIdParamsSchema, body: cancelOrderSchema }),
  requirePermission('order.cancel'),
  cancelOrderController
);

// Payment status transitions
router.post(
  '/:id/payments/verify',
  validate({ params: orderIdParamsSchema, body: verifyPaymentSchema }),
  requirePermission('payment.verify'),
  verifyPaymentController
);

router.post(
  '/:id/payments/reject',
  validate({ params: orderIdParamsSchema, body: rejectPaymentSchema }),
  requirePermission('payment.reject'),
  rejectPaymentController
);

router.post(
  '/:id/payments/resubmit',
  validate({ params: orderIdParamsSchema, body: resubmitPaymentSchema }),
  requirePermission('payment.review'),
  resubmitPaymentController
);

// Customer risk check (fraud check)
router.post(
  '/:id/risk-check',
  validate({ params: orderIdParamsSchema, body: checkCustomerRiskSchema }),
  requirePermission('customer.risk.check'),
  rateLimit('riskCheck'),
  checkCustomerRiskController
);

export default router;
