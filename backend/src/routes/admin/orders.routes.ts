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
import { validate } from '../../middleware/validate.js';
import {
  listOrdersSchema,
  confirmOrderSchema,
  cancelOrderSchema,
  verifyPaymentSchema,
  rejectPaymentSchema,
  resubmitPaymentSchema,
  checkCustomerRiskSchema,
} from '../../validation/orders.validation.js';

/**
 * Order, payment, and shipment management endpoints (Spec 07 §5.21).
 * Mounted at `/api/admin/orders` with authentication & rate limiting applied
 * at the router level (admin/index.ts).
 */
const router = Router();

// Order list & detail
router.get('/', validate({ query: listOrdersSchema }), requirePermission('order.view'), listOrdersController);

router.get('/:id', requirePermission('order.view'), getOrderController);

router.get('/:id/history', requirePermission('order.view'), getOrderHistoryController);

// Order status transitions
router.post(
  '/:id/confirm',
  validate({ body: confirmOrderSchema }),
  confirmOrderController  // Permission checked in controller (bKash vs COD)
);

router.post('/:id/processing', requirePermission('order.confirm'), startProcessingController);

router.post(
  '/:id/cancel',
  validate({ body: cancelOrderSchema }),
  requirePermission('order.cancel'),
  cancelOrderController
);

// Payment status transitions
router.post(
  '/:id/payments/verify',
  validate({ body: verifyPaymentSchema }),
  requirePermission('payment.verify'),
  verifyPaymentController
);

router.post(
  '/:id/payments/reject',
  validate({ body: rejectPaymentSchema }),
  requirePermission('payment.reject'),
  rejectPaymentController
);

router.post(
  '/:id/payments/resubmit',
  validate({ body: resubmitPaymentSchema }),
  requirePermission('payment.review'),
  resubmitPaymentController
);

// Customer risk check (fraud check)
router.post(
  '/:id/risk-check',
  validate({ body: checkCustomerRiskSchema }),
  requirePermission('customer.risk.check'),
  checkCustomerRiskController
);

export default router;
