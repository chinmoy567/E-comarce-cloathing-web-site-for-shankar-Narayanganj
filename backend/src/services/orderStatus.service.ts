/**
 * Order Status Service — State Transitions with Business Logic
 *
 * 07-order-state-machine §5.21: Enforces order status transitions atomically,
 * including stock management, audit logging, and cascades. Every transition
 * validation happens inside a withTransaction so the state change and audit
 * record commit together (§5.21.11).
 */

import { withTransaction } from '../lib/transaction.js';
import { append as appendAudit } from '../repositories/audit.repository.js';
import { append as appendStatusHistory } from '../repositories/orderStatusHistory.repository.js';
import * as ordersRepository from '../repositories/orders.repository.js';
import * as inventoryService from '../services/inventory.service.js';
import * as orderItemsRepository from '../repositories/orderItems.repository.js';
import {
  isValidOrderTransition,
  initialOrderStatus,
  initialPaymentStatus,
  initialShipmentStatus,
} from './orderStateMachine.js';
import * as shipmentsRepository from '../repositories/shipments.repository.js';
import { emitPurchaseForOrder } from './analytics/purchaseEvent.js';

import type { OrderStatus, PaymentMethod } from '../types/orderEnums.js';
import type { ActorType } from '../types/enums.js';

export type Actor = {
  userId?: string;
  type: ActorType;
};

/**
 * Transition error — state conflict (409 Conflict).
 */
export class TransitionError extends Error {
  constructor(
    public from: OrderStatus,
    public to: OrderStatus,
    public reason: string,
  ) {
    super(`Invalid order status transition: ${from} → ${to} (${reason})`);
  }
}

/**
 * Confirmation blocked by insufficient stock (422). Nothing was written.
 */
export class InsufficientStockError extends Error {
  constructor(public shortfalls: Array<{ variantId: string; available: number; requested: number }>) {
    super('Insufficient stock to confirm this order');
  }
}

async function stockItemsFor(client: import('pg').PoolClient, orderId: string) {
  const items = await orderItemsRepository.listByOrderId(client, orderId);
  return items
    .filter((i) => i.product_variant_id)
    .map((i) => ({ variantId: i.product_variant_id as string, quantity: i.quantity }));
}

/**
 * Confirm an order (PENDING_CONFIRMATION → CONFIRMED for bKash, or
 * COD_VERIFICATION_PENDING → CONFIRMED for COD). Stock is decremented
 * atomically on confirmation (§5.1).
 */
export async function confirmOrder(
  orderId: string,
  actor: Actor,
  requestId?: string,
): Promise<void> {
  await withTransaction(async (client) => {
    const order = await ordersRepository.getOrderById(orderId, { forUpdate: true, db: client });
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    // Validate transition
    const transition = isValidOrderTransition(order.payment_method, order.order_status, 'CONFIRMED');
    if (!transition) {
      throw new TransitionError(
        order.order_status,
        'CONFIRMED',
        `not a valid ${order.payment_method} transition`,
      );
    }

    // Payment precondition (§5.21.2): bKash needs verified payment before
    // confirmation; COD confirmation happens while collection is pending.
    const requiredPayment = order.payment_method === 'BKASH' ? 'PAID_VERIFIED' : 'PENDING_COLLECTION';
    if (order.payment_status !== requiredPayment) {
      throw new TransitionError(
        order.order_status,
        'CONFIRMED',
        `payment must be ${requiredPayment} before confirming (is ${order.payment_status})`,
      );
    }

    // Decrement stock (§5.1: atomic check-and-decrement at CONFIRMED). A
    // shortfall throws, rolling back the whole transaction.
    const decrement = await inventoryService.decrementStock(client, await stockItemsFor(client, orderId), {
      orderId,
      actorUserId: actor.userId ?? null,
    });
    if (!decrement.ok) {
      throw new InsufficientStockError(decrement.insufficient);
    }

    // Update order status
    const updated = await ordersRepository.updateOrderStatus(client, orderId, 'CONFIRMED');

    // Audit trail: order_status_history + audit_logs
    await appendStatusHistory({
      entityType: 'order',
      entityId: orderId,
      statusField: 'order_status',
      previousStatus: order.order_status,
      newStatus: 'CONFIRMED',
      reason: undefined,
      actorUserId: actor.userId ?? null,
      actorType: actor.type,
      requestId: requestId ?? null,
    }, client);

    await appendAudit(
      {
        entityType: 'order',
        entityId: orderId,
        action: 'order_status_change',
        previousValue: order.order_status,
        newValue: 'CONFIRMED',
        actorUserId: actor.userId,
        actorType: actor.type,
        requestId: requestId,
      },
      client,
    );
  });

  // 08-analytics-meta §6.3: Purchase fires exactly once, after the CONFIRMED write commits.
  emitPurchaseForOrder(orderId);
}

/**
 * Cancel an order (from any state where cancellation is allowed per the
 * transition table). Stock is restored uniformly (§5.1) if the order was
 * already confirmed.
 */
export async function cancelOrder(
  orderId: string,
  actor: Actor,
  reason?: string,
  requestId?: string,
): Promise<void> {
  await withTransaction(async (client) => {
    const order = await ordersRepository.getOrderById(orderId, { forUpdate: true, db: client });
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    // Validate transition
    const transition = isValidOrderTransition(order.payment_method, order.order_status, 'CANCELLED');
    if (!transition) {
      throw new TransitionError(
        order.order_status,
        'CANCELLED',
        `not a valid ${order.payment_method} transition`,
      );
    }

    // Restore stock if order was confirmed (§5.1: uniform restoration rule)
    if (order.order_status === 'CONFIRMED' || order.order_status === 'PROCESSING') {
      await inventoryService.restoreStock(client, await stockItemsFor(client, orderId), {
        orderId,
        reason: `order ${orderId} cancelled`,
        actorUserId: actor.userId ?? null,
      });
    }

    // Update order status with cancellation tracking
    await ordersRepository.updateOrderStatusWithCancellation(
      client,
      orderId,
      'CANCELLED',
      actor.userId,
      reason,
    );

    // Audit trail
    await appendStatusHistory({
      entityType: 'order',
      entityId: orderId,
      statusField: 'order_status',
      previousStatus: order.order_status,
      newStatus: 'CANCELLED',
      reason: reason ?? null,
      actorUserId: actor.userId ?? null,
      actorType: actor.type,
      requestId: requestId ?? null,
    }, client);

    await appendAudit(
      {
        entityType: 'order',
        entityId: orderId,
        action: 'order_status_change',
        previousValue: order.order_status,
        newValue: 'CANCELLED',
        reason,
        actorUserId: actor.userId,
        actorType: actor.type,
        requestId: requestId,
      },
      client,
    );
  });
}

/**
 * Start processing an order (CONFIRMED → PROCESSING).
 */
export async function startProcessing(
  orderId: string,
  actor: Actor,
  requestId?: string,
): Promise<void> {
  await withTransaction(async (client) => {
    const order = await ordersRepository.getOrderById(orderId, { forUpdate: true, db: client });
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    // Validate transition
    const transition = isValidOrderTransition(order.payment_method, order.order_status, 'PROCESSING');
    if (!transition) {
      throw new TransitionError(
        order.order_status,
        'PROCESSING',
        `not a valid ${order.payment_method} transition`,
      );
    }

    // Update order status
    await ordersRepository.updateOrderStatus(client, orderId, 'PROCESSING');

    // Audit trail
    await appendStatusHistory({
      entityType: 'order',
      entityId: orderId,
      statusField: 'order_status',
      previousStatus: order.order_status,
      newStatus: 'PROCESSING',
      reason: undefined,
      actorUserId: actor.userId ?? null,
      actorType: actor.type,
      requestId: requestId ?? null,
    }, client);

    await appendAudit(
      {
        entityType: 'order',
        entityId: orderId,
        action: 'order_status_change',
        previousValue: order.order_status,
        newValue: 'PROCESSING',
        actorUserId: actor.userId,
        actorType: actor.type,
        requestId: requestId,
      },
      client,
    );
  });
}

/**
 * Deliver an order (PROCESSING → DELIVERED). Typically called via shipment
 * cascade (§5.21.4), but can also be called manually as a fallback.
 */
export async function deliverOrder(
  orderId: string,
  actor: Actor,
  requestId?: string,
): Promise<void> {
  await withTransaction(async (client) => {
    const order = await ordersRepository.getOrderById(orderId, { forUpdate: true, db: client });
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    // Validate transition
    const transition = isValidOrderTransition(order.payment_method, order.order_status, 'DELIVERED');
    if (!transition) {
      throw new TransitionError(
        order.order_status,
        'DELIVERED',
        `not a valid ${order.payment_method} transition`,
      );
    }

    // Update order status
    await ordersRepository.updateOrderStatus(client, orderId, 'DELIVERED');

    // Audit trail
    await appendStatusHistory({
      entityType: 'order',
      entityId: orderId,
      statusField: 'order_status',
      previousStatus: order.order_status,
      newStatus: 'DELIVERED',
      reason: undefined,
      actorUserId: actor.userId ?? null,
      actorType: actor.type,
      requestId: requestId ?? null,
    }, client);

    await appendAudit(
      {
        entityType: 'order',
        entityId: orderId,
        action: 'order_status_change',
        previousValue: order.order_status,
        newValue: 'DELIVERED',
        actorUserId: actor.userId,
        actorType: actor.type,
        requestId: requestId,
      },
      client,
    );
  });
}

/**
 * Return an order (PROCESSING → RETURNED). Typically called via shipment
 * cascade (§5.21.6) when courier reports return, but can also be called
 * manually as a fallback (§5.21.9).
 */
export async function returnOrder(
  orderId: string,
  actor: Actor,
  reason?: string,
  requestId?: string,
): Promise<void> {
  await withTransaction(async (client) => {
    const order = await ordersRepository.getOrderById(orderId, { forUpdate: true, db: client });
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    // Validate transition
    const transition = isValidOrderTransition(order.payment_method, order.order_status, 'RETURNED');
    if (!transition) {
      throw new TransitionError(
        order.order_status,
        'RETURNED',
        `not a valid ${order.payment_method} transition`,
      );
    }

    // Update order status with return tracking
    await ordersRepository.updateOrderStatusWithCancellation(
      client,
      orderId,
      'RETURNED',
      actor.userId,
      reason,
    );

    // Audit trail
    await appendStatusHistory({
      entityType: 'order',
      entityId: orderId,
      statusField: 'order_status',
      previousStatus: order.order_status,
      newStatus: 'RETURNED',
      reason: reason ?? null,
      actorUserId: actor.userId ?? null,
      actorType: actor.type,
      requestId: requestId ?? null,
    }, client);

    await appendAudit(
      {
        entityType: 'order',
        entityId: orderId,
        action: 'order_status_change',
        previousValue: order.order_status,
        newValue: 'RETURNED',
        reason,
        actorUserId: actor.userId,
        actorType: actor.type,
        requestId: requestId,
      },
      client,
    );
  });
}
