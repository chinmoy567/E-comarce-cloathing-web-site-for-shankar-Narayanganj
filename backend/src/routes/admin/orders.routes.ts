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
import {
  changeCourierController,
  createShipmentController,
  getShipmentController,
  listShipmentRequestsController,
  markShippedController,
  retryShipmentController,
} from '../../controllers/admin/shipment.controller.js';
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
import { createShipmentSchema, shipmentRequestsQuerySchema } from '../../validation/shipment.validation.js';

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

// Spec 14 — shipment (04-courier §4.1–4.11). Creation and change-courier need BOTH the
// action permission and courier.select (choosing the courier is part of the request).
router.get('/:id/shipment', validate({ params: orderIdParamsSchema }), requirePermission('shipment.view'), getShipmentController);

router.get(
  '/:id/shipment/requests',
  validate({ params: orderIdParamsSchema, query: shipmentRequestsQuerySchema }),
  requirePermission('shipment.view'),
  listShipmentRequestsController,
);

router.post(
  '/:id/shipment',
  validate({ params: orderIdParamsSchema, body: createShipmentSchema }),
  requirePermission('shipment.create'),
  requirePermission('courier.select'),
  createShipmentController,
);

router.post(
  '/:id/shipment/retry',
  validate({ params: orderIdParamsSchema }),
  requirePermission('shipment.retry'),
  retryShipmentController,
);

router.post(
  '/:id/shipment/change-courier',
  validate({ params: orderIdParamsSchema, body: createShipmentSchema }),
  requirePermission('shipment.courier.change'),
  requirePermission('courier.select'),
  changeCourierController,
);

router.post(
  '/:id/shipment/mark-shipped',
  validate({ params: orderIdParamsSchema }),
  requirePermission('shipment.create'),
  markShippedController,
);

export default router;
