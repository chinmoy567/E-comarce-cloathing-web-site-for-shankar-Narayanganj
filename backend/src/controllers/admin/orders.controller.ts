import type { Request, Response } from 'express';
import { logger } from '../../lib/logger.js';
import * as ordersRepository from '../../repositories/orders.repository.js';
import * as orderStatusHistoryRepository from '../../repositories/orderStatusHistory.repository.js';
import * as orderStatusService from '../../services/orderStatus.service.js';
import * as paymentStatusService from '../../services/paymentStatus.service.js';

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
    const { page = 1, limit = 20, order_status, payment_status, payment_method } = req.query;
    const pageNum = typeof page === 'string' ? parseInt(page, 10) : 1;
    const limitNum = typeof limit === 'string' ? parseInt(limit, 10) : 20;

    if (pageNum < 1 || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({
        error: {
          code: 'INVALID_PAGINATION',
          message: 'Invalid pagination parameters',
        },
        requestId,
      });
    }

    const filters = {
      order_status: typeof order_status === 'string' ? order_status : undefined,
      payment_status: typeof payment_status === 'string' ? payment_status : undefined,
      payment_method: typeof payment_method === 'string' ? payment_method : undefined,
    };

    const result = await ordersRepository.listOrders(pageNum, limitNum, filters);

    res.json({
      data: result.items,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: result.total,
      },
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
    const { id } = req.params;

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
    const { id } = req.params;
    const { page = 1, limit = 50 } = req.query;

    const pageNum = typeof page === 'string' ? parseInt(page, 10) : 1;
    const limitNum = typeof limit === 'string' ? parseInt(limit, 10) : 50;

    if (pageNum < 1 || limitNum < 1) {
      return res.status(400).json({
        error: {
          code: 'INVALID_PAGINATION',
          message: 'Invalid pagination parameters',
        },
        requestId,
      });
    }

    const history = await orderStatusHistoryRepository.listForOrder(id, pageNum, limitNum);

    res.json({
      data: history.items,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: history.total,
      },
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
    const { id } = req.params;
    const userId = (req as any).user?.id;

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
    const { id } = req.params;
    const userId = (req as any).user?.id;

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
    const { id } = req.params;
    const { reason } = req.body;
    const userId = (req as any).user?.id;

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
    const { id } = req.params;
    const userId = (req as any).user?.id;

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
    const { id } = req.params;
    const { reason } = req.body;
    const userId = (req as any).user?.id;

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
    const { id } = req.params;
    const { newBkashTransactionId } = req.body;
    const userId = (req as any).user?.id;

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
