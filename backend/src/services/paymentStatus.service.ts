/**
 * Payment Status Service — Payment State Transitions
 *
 * 07-order-state-machine §5.21.2, §5.21.3: Enforces payment status transitions
 * independently of order status. bKash: verify/reject/resubmit cycle.
 * COD: collect/reject cycle.
 */

import { withTransaction } from '../lib/transaction.js';
import { append as appendAudit } from '../repositories/audit.repository.js';
import { append as appendStatusHistory } from '../repositories/orderStatusHistory.repository.js';
import * as ordersRepository from '../repositories/orders.repository.js';
import { isValidPaymentTransition } from './orderStateMachine.js';

import type { PaymentStatus } from '../types/orderEnums.js';
import type { ActorType } from '../types/enums.js';

export type Actor = {
  userId?: string;
  type: ActorType;
};

/**
 * Transition error — state conflict (409 Conflict).
 */
export class PaymentTransitionError extends Error {
  constructor(
    public from: PaymentStatus,
    public to: PaymentStatus,
    public reason: string,
  ) {
    super(`Invalid payment status transition: ${from} → ${to} (${reason})`);
  }
}

/**
 * Verify a bKash payment (PENDING_VERIFICATION → PAID_VERIFIED).
 */
export async function verifyPayment(
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
    const transition = isValidPaymentTransition(
      order.payment_method,
      order.payment_status,
      'PAID_VERIFIED',
    );
    if (!transition) {
      throw new PaymentTransitionError(
        order.payment_status,
        'PAID_VERIFIED',
        `not a valid ${order.payment_method} transition`,
      );
    }

    // Update payment status
    await ordersRepository.updatePaymentStatus(client, orderId, 'PAID_VERIFIED');

    // Audit trail
    await appendStatusHistory(client, {
      entityType: 'order',
      entityId: orderId,
      statusField: 'payment_status',
      previousStatus: order.payment_status,
      newStatus: 'PAID_VERIFIED',
      reason: undefined,
      actorUserId: actor.userId ?? null,
      actorType: actor.type,
      requestId: requestId ?? null,
    });

    await appendAudit(
      {
        entityType: 'order',
        entityId: orderId,
        action: 'payment_status_change',
        previousValue: order.payment_status,
        newValue: 'PAID_VERIFIED',
        actorUserId: actor.userId,
        actorType: actor.type,
        requestId: requestId,
      },
      client,
    );
  });
}

/**
 * Reject a payment (PENDING_VERIFICATION → REJECTED, or PENDING_COLLECTION → REJECTED).
 * §5.21.2: Rejection must not auto-cancel the order.
 */
export async function rejectPayment(
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
    const transition = isValidPaymentTransition(order.payment_method, order.payment_status, 'REJECTED');
    if (!transition) {
      throw new PaymentTransitionError(
        order.payment_status,
        'REJECTED',
        `not a valid ${order.payment_method} transition`,
      );
    }

    // Update payment status
    await ordersRepository.updatePaymentStatus(client, orderId, 'REJECTED');

    // Audit trail
    await appendStatusHistory(client, {
      entityType: 'order',
      entityId: orderId,
      statusField: 'payment_status',
      previousStatus: order.payment_status,
      newStatus: 'REJECTED',
      reason: reason ?? null,
      actorUserId: actor.userId ?? null,
      actorType: actor.type,
      requestId: requestId ?? null,
    });

    await appendAudit(
      {
        entityType: 'order',
        entityId: orderId,
        action: 'payment_status_change',
        previousValue: order.payment_status,
        newValue: 'REJECTED',
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
 * Resubmit a bKash payment (REJECTED → PENDING_VERIFICATION).
 * §5.21.2: Customer resubmits payment information.
 */
export async function resubmitPayment(
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
    const transition = isValidPaymentTransition(
      order.payment_method,
      order.payment_status,
      'PENDING_VERIFICATION',
    );
    if (!transition) {
      throw new PaymentTransitionError(
        order.payment_status,
        'PENDING_VERIFICATION',
        `not a valid ${order.payment_method} transition`,
      );
    }

    // Update payment status
    await ordersRepository.updatePaymentStatus(client, orderId, 'PENDING_VERIFICATION');

    // Audit trail
    await appendStatusHistory(client, {
      entityType: 'order',
      entityId: orderId,
      statusField: 'payment_status',
      previousStatus: order.payment_status,
      newStatus: 'PENDING_VERIFICATION',
      reason: 'Customer resubmitted payment',
      actorUserId: actor.userId ?? null,
      actorType: actor.type,
      requestId: requestId ?? null,
    });

    await appendAudit(
      {
        entityType: 'order',
        entityId: orderId,
        action: 'payment_status_change',
        previousValue: order.payment_status,
        newValue: 'PENDING_VERIFICATION',
        reason: 'Customer resubmitted payment',
        actorUserId: actor.userId,
        actorType: actor.type,
        requestId: requestId,
      },
      client,
    );
  });
}

/**
 * Collect COD payment (PENDING_COLLECTION → PAID_COLLECTED).
 * §5.21.3: Courier confirms payment, or Admin manually marks collected.
 */
export async function collectPayment(
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
    const transition = isValidPaymentTransition(
      order.payment_method,
      order.payment_status,
      'PAID_COLLECTED',
    );
    if (!transition) {
      throw new PaymentTransitionError(
        order.payment_status,
        'PAID_COLLECTED',
        `not a valid ${order.payment_method} transition`,
      );
    }

    // Update payment status
    await ordersRepository.updatePaymentStatus(client, orderId, 'PAID_COLLECTED');

    // Audit trail
    await appendStatusHistory(client, {
      entityType: 'order',
      entityId: orderId,
      statusField: 'payment_status',
      previousStatus: order.payment_status,
      newStatus: 'PAID_COLLECTED',
      reason: undefined,
      actorUserId: actor.userId ?? null,
      actorType: actor.type,
      requestId: requestId ?? null,
    });

    await appendAudit(
      {
        entityType: 'order',
        entityId: orderId,
        action: 'payment_status_change',
        previousValue: order.payment_status,
        newValue: 'PAID_COLLECTED',
        actorUserId: actor.userId,
        actorType: actor.type,
        requestId: requestId,
      },
      client,
    );
  });
}
