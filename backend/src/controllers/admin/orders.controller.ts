import type { Request, Response } from 'express';
import { logger } from '../../lib/logger.js';
import { buildPagination } from '../../lib/pagination.js';
import * as ordersRepository from '../../repositories/orders.repository.js';
import * as orderStatusHistoryRepository from '../../repositories/orderStatusHistory.repository.js';
import * as orderStatusService from '../../services/orderStatus.service.js';
import * as paymentStatusService from '../../services/paymentStatus.service.js';
import { customerRiskService } from '../../services/fraud/customerRiskService.js';
import * as auditRepository from '../../repositories/audit.repository.js';
import type { ListOrdersQuery } from '../../validation/orders.validation.js';
import type { PaginationQuery } from '../../lib/pagination.js';

// Generate request ID
function generateRequestId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

/**
 * Order, payment, and shipment management controllers (Spec 07).
 * Controllers delegate to service layer.
 */

// GET /api/admin/orders — List orders with filtering
export async function listOrdersController(req: Request, res: Response) {
  const requestId = generateRequestId();
  try {
    // `validate({ query: listOrdersSchema })` has already replaced `req.query`
    // with the parsed, coerced `ListOrdersQuery`.
    const { page, pageSize, order_status, payment_status, payment_method, created_after, created_before } =
      req.query as unknown as ListOrdersQuery;

    const result = await ordersRepository.listOrders(
      { order_status, payment_status, payment_method, created_after, created_before },
      { page, pageSize },
    );

    res.json({
      data: result.items,
      pagination: buildPagination({ page, pageSize }, result.total),
    });
  } catch (error) {
    logger.error({ error }, 'Failed to list orders');
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to list orders',
      },
      requestId,
    });
  }
}

// GET /api/admin/orders/:id — Get order detail
export async function getOrderController(req: Request, res: Response) {
  const requestId = generateRequestId();
  try {
    const id = req.params.id;
    if (!id) {
      return res.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Order id is required' },
        requestId,
      });
    }

    const order = await ordersRepository.getOrderById(id);

    if (!order) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: `Order ${id} not found`,
        },
        requestId,
      });
    }

    res.json({ data: order });
  } catch (error) {
    logger.error({ error }, 'Failed to get order');
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get order',
      },
      requestId,
    });
  }
}

// GET /api/admin/orders/:id/history — Get order status history
export async function getOrderHistoryController(req: Request, res: Response) {
  const requestId = generateRequestId();
  try {
    const id = req.params.id;
    if (!id) {
      return res.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Order id is required' },
        requestId,
      });
    }
    // `validate({ query: paginationQuerySchema })` has already replaced
    // `req.query` with the parsed, coerced `PaginationQuery`.
    const { page, pageSize } = req.query as unknown as PaginationQuery;

    const history = await orderStatusHistoryRepository.listForOrder(id, { page, pageSize });

    res.json({
      data: history.items,
      pagination: buildPagination({ page, pageSize }, history.total),
    });
  } catch (error) {
    logger.error({ error }, 'Failed to get order history');
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get order history',
      },
      requestId,
    });
  }
}

// POST /api/admin/orders/:id/confirm — Confirm order
export async function confirmOrderController(req: Request, res: Response) {
  const requestId = generateRequestId();
  try {
    const id = req.params.id;
    if (!id) {
      return res.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Order id is required' },
        requestId,
      });
    }
    const userId = req.actor?.userId;

    if (!userId) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
        requestId,
      });
    }

    try {
      await orderStatusService.confirmOrder(id, { userId, type: 'USER' });

      const order = await ordersRepository.getOrderById(id);
      res.json({ data: order });
    } catch (error: any) {
      if (error instanceof orderStatusService.TransitionError) {
        return res.status(409).json({
          error: {
            code: 'INVALID_STATE_TRANSITION',
            message: error.message,
          },
          requestId,
        });
      }
      throw error;
    }
  } catch (error: any) {
    if (error.message?.includes('not found')) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: error.message,
        },
        requestId,
      });
    }
    logger.error({ error }, 'Failed to confirm order');
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to confirm order',
      },
      requestId,
    });
  }
}

// POST /api/admin/orders/:id/processing — Start processing
export async function startProcessingController(req: Request, res: Response) {
  const requestId = generateRequestId();
  try {
    const id = req.params.id;
    if (!id) {
      return res.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Order id is required' },
        requestId,
      });
    }
    const userId = req.actor?.userId;

    if (!userId) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
        requestId,
      });
    }

    try {
      await orderStatusService.startProcessing(id, { userId, type: 'USER' });

      const order = await ordersRepository.getOrderById(id);
      res.json({ data: order });
    } catch (error: any) {
      if (error instanceof orderStatusService.TransitionError) {
        return res.status(409).json({
          error: {
            code: 'INVALID_STATE_TRANSITION',
            message: error.message,
          },
          requestId,
        });
      }
      throw error;
    }
  } catch (error: any) {
    if (error.message?.includes('not found')) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: error.message,
        },
        requestId,
      });
    }
    logger.error({ error }, 'Failed to start processing');
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to start processing',
      },
      requestId,
    });
  }
}

// POST /api/admin/orders/:id/cancel — Cancel order
export async function cancelOrderController(req: Request, res: Response) {
  const requestId = generateRequestId();
  try {
    const id = req.params.id;
    if (!id) {
      return res.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Order id is required' },
        requestId,
      });
    }
    const { reason } = req.body;
    const userId = req.actor?.userId;

    if (!userId) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
        requestId,
      });
    }

    try {
      await orderStatusService.cancelOrder(id, { userId, type: 'USER' }, reason);

      const order = await ordersRepository.getOrderById(id);
      res.json({ data: order });
    } catch (error: any) {
      if (error instanceof orderStatusService.TransitionError) {
        return res.status(409).json({
          error: {
            code: 'INVALID_STATE_TRANSITION',
            message: error.message,
          },
          requestId,
        });
      }
      throw error;
    }
  } catch (error: any) {
    if (error.message?.includes('not found')) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: error.message,
        },
        requestId,
      });
    }
    logger.error({ error }, 'Failed to cancel order');
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to cancel order',
      },
      requestId,
    });
  }
}

// POST /api/admin/orders/:id/payments/verify — Verify payment
export async function verifyPaymentController(req: Request, res: Response) {
  const requestId = generateRequestId();
  try {
    const id = req.params.id;
    if (!id) {
      return res.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Order id is required' },
        requestId,
      });
    }
    const userId = req.actor?.userId;

    if (!userId) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
        requestId,
      });
    }

    try {
      await paymentStatusService.verifyPayment(id, { userId, type: 'USER' });

      const order = await ordersRepository.getOrderById(id);
      res.json({ data: order });
    } catch (error: any) {
      if (error instanceof paymentStatusService.PaymentTransitionError) {
        return res.status(409).json({
          error: {
            code: 'INVALID_STATE_TRANSITION',
            message: error.message,
          },
          requestId,
        });
      }
      throw error;
    }
  } catch (error: any) {
    if (error.message?.includes('not found')) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: error.message,
        },
        requestId,
      });
    }
    logger.error({ error }, 'Failed to verify payment');
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to verify payment',
      },
      requestId,
    });
  }
}

// POST /api/admin/orders/:id/payments/reject — Reject payment
// CRITICAL: §5.21.2 — Order status must NOT change
export async function rejectPaymentController(req: Request, res: Response) {
  const requestId = generateRequestId();
  try {
    const id = req.params.id;
    if (!id) {
      return res.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Order id is required' },
        requestId,
      });
    }
    const { reason } = req.body;
    const userId = req.actor?.userId;

    if (!userId) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
        requestId,
      });
    }

    try {
      await paymentStatusService.rejectPayment(id, { userId, type: 'USER' }, reason);

      const order = await ordersRepository.getOrderById(id);
      res.json({ data: order });
    } catch (error: any) {
      if (error instanceof paymentStatusService.PaymentTransitionError) {
        return res.status(409).json({
          error: {
            code: 'INVALID_STATE_TRANSITION',
            message: error.message,
          },
          requestId,
        });
      }
      throw error;
    }
  } catch (error: any) {
    if (error.message?.includes('not found')) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: error.message,
        },
        requestId,
      });
    }
    logger.error({ error }, 'Failed to reject payment');
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to reject payment',
      },
      requestId,
    });
  }
}

// POST /api/admin/orders/:id/payments/resubmit — Resubmit payment
export async function resubmitPaymentController(req: Request, res: Response) {
  const requestId = generateRequestId();
  try {
    const id = req.params.id;
    if (!id) {
      return res.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Order id is required' },
        requestId,
      });
    }
    const { newBkashTransactionId } = req.body;
    const userId = req.actor?.userId;

    if (!userId) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
        requestId,
      });
    }

    try {
      await paymentStatusService.resubmitPayment(id, { userId, type: 'USER' }, newBkashTransactionId);

      const order = await ordersRepository.getOrderById(id);
      res.json({ data: order });
    } catch (error: any) {
      if (error instanceof paymentStatusService.PaymentTransitionError) {
        return res.status(409).json({
          error: {
            code: 'INVALID_STATE_TRANSITION',
            message: error.message,
          },
          requestId,
        });
      }
      throw error;
    }
  } catch (error: any) {
    if (error.message?.includes('not found')) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: error.message,
        },
        requestId,
      });
    }
    logger.error({ error }, 'Failed to resubmit payment');
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to resubmit payment',
      },
      requestId,
    });
  }
}

// POST /api/admin/orders/:id/risk-check — Check customer risk
export async function checkCustomerRiskController(req: Request, res: Response) {
  const requestId = generateRequestId();
  try {
    const orderId = req.params.id;
    if (!orderId) {
      return res.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Order id is required' },
        requestId,
      });
    }
    const { forceRefresh } = req.body;
    const userId = req.actor?.userId;

    if (!userId) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
        requestId,
      });
    }

    // Fetch order
    const order = await ordersRepository.getOrderById(orderId);
    if (!order) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: `Order ${orderId} not found`,
        },
        requestId,
      });
    }

    // Verify order status is CONFIRMED or PROCESSING
    const validStatuses = ['CONFIRMED', 'PROCESSING'];
    if (!validStatuses.includes(order.order_status)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_ORDER_STATUS',
          message: `Risk check only allowed for orders in CONFIRMED or PROCESSING status. Current status: ${order.order_status}`,
        },
        requestId,
      });
    }

    // Fetch customer
    const customersRepository = await import('../../repositories/customers.repository.js');
    const customer = await customersRepository.findById(order.customer_id);
    if (!customer) {
      return res.status(404).json({
        error: {
          code: 'CUSTOMER_NOT_FOUND',
          message: `Customer not found`,
        },
        requestId,
      });
    }

    // Check customer risk
    const result = await customerRiskService.checkCustomerRisk(
      orderId,
      order.customer_id,
      customer.phoneNumber,
      userId,
      forceRefresh
    );

    // Log audit entry
    await auditRepository.append({
      entityType: 'ORDER',
      entityId: orderId,
      action: 'CUSTOMER_RISK_CHECK',
      newValue: {
        customer_id: order.customer_id,
        risk_result: result.riskLevel,
      },
      actorUserId: userId,
      actorType: 'USER',
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    if (error.message?.includes('not found')) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: error.message,
        },
        requestId,
      });
    }
    if (error.statusCode === 400) {
      return res.status(400).json({
        error: {
          code: error.code || 'VALIDATION_ERROR',
          message: error.message,
        },
        requestId,
      });
    }
    logger.error({ error }, 'Failed to check customer risk');
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to check customer risk',
      },
      requestId,
    });
  }
}
