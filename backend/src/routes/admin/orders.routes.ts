import { Router } from 'express';
import {
  startProcessingController,
  cancelOrderController,
  verifyPaymentController,
  rejectPaymentController,
  resubmitPaymentController,
  getOrderHistoryController,
  checkCustomerRiskController,
} from '../../controllers/admin/orders.controller.js';
import {
  codCollectionController,
  codConfirmController,
  confirmBkashController,
  getOrderDetailController,
  getPaymentPanelController,
  listOrdersController,
  updateOrderController,
} from '../../controllers/admin/orderPanel.controller.js';
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
  codCollectionSchema,
  codConfirmSchema,
  updateOrderSchema,
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

router.get('/:id', validate({ params: orderIdParamsSchema }), requirePermission('order.view'), getOrderDetailController);

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
  confirmBkashController
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

// Spec 13 additions ---------------------------------------------------------

// Payment sub-resource - gated separately from order.view (06-rbac: "bKash Payment View" is its own row).
router.get('/:id/payment', validate({ params: orderIdParamsSchema }), requirePermission('payment.view'), getPaymentPanelController);

// COD confirmation (05-admin §5.4) - its own permission row, COD orders only.
router.post(
  '/:id/cod-confirm',
  validate({ params: orderIdParamsSchema, body: codConfirmSchema }),
  requirePermission('order.cod.confirm'),
  codConfirmController,
);

// COD collection resolution (§5.21.3).
router.post(
  '/:id/payment/collection',
  validate({ params: orderIdParamsSchema, body: codCollectionSchema }),
  requirePermission('order.update'),
  codCollectionController,
);

// Narrow whitelisted edit (§5.2, §8.23).
router.patch(
  '/:id',
  validate({ params: orderIdParamsSchema, body: updateOrderSchema }),
  requirePermission('order.update'),
  updateOrderController,
);

export default router;
