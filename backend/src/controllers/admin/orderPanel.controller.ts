import type { NextFunction, Request, Response } from 'express';
import { buildPagination } from '../../lib/pagination.js';
import { getEnv } from '../../config/env.js';
import * as ordersRepository from '../../repositories/orders.repository.js';
import * as orderStatusService from '../../services/orderStatus.service.js';
import * as paymentStatusService from '../../services/paymentStatus.service.js';
import * as panel from '../../services/adminOrderPanel.service.js';
import { ConflictError, NotFoundError, UnauthorizedError } from '../../lib/errors.js';
import type { ApiSuccess } from '../../types/api.js';
import type { ListOrdersQuery } from '../../validation/orders.validation.js';

/**
 * Spec 13 admin order panel controllers. Thin: parse, call the service, and let
 * the central error handler turn typed errors into the shared envelope.
 * Existing status-transition controllers (confirm/cancel/verify/reject) live in
 * `orders.controller.ts`; this file holds the additions.
 */

function actorOf(req: Request): { userId: string; type: 'USER' } {
  const userId = req.actor?.userId;
  if (!userId) throw new UnauthorizedError('Authentication required.');
  return { userId, type: 'USER' };
}

function mapTransitionError(err: unknown): unknown {
  if (err instanceof orderStatusService.InsufficientStockError) {
    // Spec 13 error table: 409 INSUFFICIENT_STOCK naming the short variants; nothing was written.
    return new ConflictError(
      'Insufficient stock to confirm this order.',
      err.shortfalls.map((s) => ({ field: s.variantId, message: `available ${s.available}, requested ${s.requested}` })),
      'INSUFFICIENT_STOCK',
    );
  }
  if (err instanceof orderStatusService.TransitionError || err instanceof paymentStatusService.PaymentTransitionError) {
    // Spec 13 error table: a transition not allowed from the current status is a 409.
    const preconditionFailed = /payment must be/.test(err.message);
    return new ConflictError(
      err.message,
      undefined,
      preconditionFailed ? 'TRANSITION_PRECONDITION_FAILED' : 'INVALID_TRANSITION',
    );
  }
  if (err instanceof Error && /^Order .* not found$/.test(err.message)) {
    return new NotFoundError('Order not found.');
  }
  return err;
}

export async function listOrdersController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const q = req.query as unknown as ListOrdersQuery;
    const result = await ordersRepository.listOrders(
      {
        order_status: q.order_status,
        payment_status: q.payment_status,
        shipment_status: q.shipment_status,
        payment_method: q.payment_method,
        is_guest_order: q.is_guest_order,
        has_coupon: q.has_coupon,
        has_cod_discrepancy: q.has_cod_discrepancy,
        stale_after_hours: q.stale ? getEnv().STALE_ORDER_HOURS : undefined,
        created_after: q.created_after,
        created_before: q.created_before,
        q: q.q,
      },
      { page: q.page, pageSize: q.pageSize },
      undefined,
      { by: q.sort, direction: q.direction },
    );
    res.json({ data: result.items, pagination: buildPagination({ page: q.page, pageSize: q.pageSize }, result.total) });
  } catch (err) {
    next(err);
  }
}

export async function getOrderDetailController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const detail = await panel.getOrderDetail(req.params.id as string, req.actor?.permissions ?? []);
    // The order's own columns stay at the top level (existing consumers read `order_status` etc.);
    // the panel additions ride alongside them.
    res.json({
      data: {
        ...detail.order,
        is_guest_order: detail.isGuestOrder,
        has_cod_collection_discrepancy: detail.hasCodCollectionDiscrepancy,
        customer: detail.customer,
        items: detail.items,
        applied_coupon: detail.appliedCoupon,
        shipment: detail.shipment,
        shipment_status: detail.shipment?.status ?? 'NOT_CREATED',
        allowed_actions: detail.allowedActions,
      },
    } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function getPaymentPanelController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ data: await panel.getPaymentPanel(req.params.id as string) } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function confirmBkashController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    await panel.confirmBkashOrder(id, actorOf(req), req.requestId);
    res.json({ data: await ordersRepository.getOrderById(id) } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(mapTransitionError(err));
  }
}

export async function codConfirmController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    await panel.confirmCodOrder(id, actorOf(req), req.requestId);
    res.json({ data: await ordersRepository.getOrderById(id) } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(mapTransitionError(err));
  }
}

export async function codCollectionController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    const { outcome, reason } = req.body as { outcome: 'COLLECTED' | 'NOT_RECOVERABLE'; reason?: string };
    await panel.resolveCodCollection(id, outcome, reason, actorOf(req), req.requestId);
    res.json({ data: await ordersRepository.getOrderById(id) } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(mapTransitionError(err));
  }
}

export async function updateOrderController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id as string;
    await panel.updateOrder(id, req.body, actorOf(req), req.requestId);
    res.json({ data: await ordersRepository.getOrderById(id) } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}
