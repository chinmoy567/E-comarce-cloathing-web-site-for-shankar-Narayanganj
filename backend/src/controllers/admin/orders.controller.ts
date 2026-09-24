import type { Request, Response } from 'express';
import { logger } from '../../lib/logger.js';

/**
 * Order, payment, and shipment management controllers (Spec 07).
 * Controllers delegate to service layer.
 */

// GET /api/admin/orders — List orders with filtering
export async function listOrdersController(req: Request, res: Response) {
  try {
    const { page = 1, limit = 20 } = req.query;
    const pageNum = typeof page === 'string' ? parseInt(page, 10) : 1;
    const limitNum = typeof limit === 'string' ? parseInt(limit, 10) : 20;

    // TODO: Implement with orders repository
    res.json({
      orders: [],
      total: 0,
      page: pageNum,
      limit: limitNum,
      message: 'Orders endpoint not yet implemented',
    });
  } catch (error) {
    logger.error({ error }, 'Failed to list orders');
    res.status(500).json({ error: 'Failed to list orders' });
  }
}

// GET /api/admin/orders/:id — Get order detail
export async function getOrderController(req: Request, res: Response) {
  try {
    const { id } = req.params;

    // TODO: Implement with orders repository
    res.json({
      id,
      message: 'Get order endpoint not yet implemented',
    });
  } catch (error) {
    logger.error({ error }, 'Failed to get order');
    res.status(500).json({ error: 'Failed to get order' });
  }
}

// GET /api/admin/orders/:id/history — Get order status history
export async function getOrderHistoryController(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { page = 1, limit = 50 } = req.query;

    // TODO: Implement with orderStatusHistory repository
    res.json({
      history: [],
      order_id: id,
      message: 'Order history endpoint not yet implemented',
    });
  } catch (error) {
    logger.error({ error }, 'Failed to get order history');
    res.status(500).json({ error: 'Failed to get order history' });
  }
}

// POST /api/admin/orders/:id/confirm — Confirm order
export async function confirmOrderController(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // TODO: Implement with orderStatus service
    // Check permission based on payment_method (order.confirm vs order.cod.confirm)
    res.json({
      id,
      order_status: 'CONFIRMED',
      message: 'Confirm order endpoint not yet implemented',
    });
  } catch (error: any) {
    if (error.code === 'TRANSITION_ERROR') {
      return res.status(409).json({ error: error.message });
    }
    logger.error({ error }, 'Failed to confirm order');
    res.status(500).json({ error: 'Failed to confirm order' });
  }
}

// POST /api/admin/orders/:id/processing — Start processing
export async function startProcessingController(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // TODO: Implement with orderStatus service
    res.json({
      id,
      order_status: 'PROCESSING',
      message: 'Start processing endpoint not yet implemented',
    });
  } catch (error: any) {
    if (error.code === 'TRANSITION_ERROR') {
      return res.status(409).json({ error: error.message });
    }
    logger.error({ error }, 'Failed to start processing');
    res.status(500).json({ error: 'Failed to start processing' });
  }
}

// POST /api/admin/orders/:id/cancel — Cancel order
export async function cancelOrderController(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!reason || reason.length < 10) {
      return res.status(422).json({ error: 'Reason must be at least 10 characters' });
    }

    // TODO: Implement with orderStatus service
    res.json({
      id,
      order_status: 'CANCELLED',
      cancellation_reason: reason,
      message: 'Cancel order endpoint not yet implemented',
    });
  } catch (error: any) {
    if (error.code === 'TRANSITION_ERROR') {
      return res.status(409).json({ error: error.message });
    }
    logger.error({ error }, 'Failed to cancel order');
    res.status(500).json({ error: 'Failed to cancel order' });
  }
}

// POST /api/admin/orders/:id/payments/verify — Verify payment
export async function verifyPaymentController(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { bkashTransactionId } = req.body;
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // TODO: Implement with paymentStatus service
    // For bKash: require transaction ID
    // For COD: no transaction ID needed
    res.json({
      id,
      payment_status: 'PAID_VERIFIED',
      message: 'Verify payment endpoint not yet implemented',
    });
  } catch (error: any) {
    if (error.code === 'TRANSITION_ERROR') {
      return res.status(409).json({ error: error.message });
    }
    logger.error({ error }, 'Failed to verify payment');
    res.status(500).json({ error: 'Failed to verify payment' });
  }
}

// POST /api/admin/orders/:id/payments/reject — Reject payment
export async function rejectPaymentController(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!reason || reason.length < 10) {
      return res.status(422).json({ error: 'Reason must be at least 10 characters' });
    }

    // TODO: Implement with paymentStatus service
    // CRITICAL: Order status should NOT change (§5.21.2)
    res.json({
      id,
      payment_status: 'REJECTED',
      message: 'Reject payment endpoint not yet implemented (NOTE: Order status unchanged per §5.21.2)',
    });
  } catch (error: any) {
    if (error.code === 'TRANSITION_ERROR') {
      return res.status(409).json({ error: error.message });
    }
    logger.error({ error }, 'Failed to reject payment');
    res.status(500).json({ error: 'Failed to reject payment' });
  }
}

// POST /api/admin/orders/:id/payments/resubmit — Resubmit payment
export async function resubmitPaymentController(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { newBkashTransactionId } = req.body;
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!newBkashTransactionId || newBkashTransactionId.length < 5) {
      return res.status(422).json({ error: 'Valid bKash transaction ID required' });
    }

    // TODO: Implement with paymentStatus service
    res.json({
      id,
      payment_status: 'PENDING_VERIFICATION',
      message: 'Resubmit payment endpoint not yet implemented',
    });
  } catch (error: any) {
    if (error.code === 'TRANSITION_ERROR') {
      return res.status(409).json({ error: error.message });
    }
    logger.error({ error }, 'Failed to resubmit payment');
    res.status(500).json({ error: 'Failed to resubmit payment' });
  }
}
