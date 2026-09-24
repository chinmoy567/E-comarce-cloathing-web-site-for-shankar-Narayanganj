/**
 * Shipment Status Service — Shipment State Transitions & Atomic Cascades
 *
 * 07-order-state-machine §5.21.4, §5.21.6: Enforces shipment status transitions.
 * Includes the two atomic cascades (same transaction):
 * 1. Shipment OUT_FOR_DELIVERY → DELIVERED triggers Order PROCESSING → DELIVERED
 * 2. Shipment DELIVERY_FAILED → RETURNED triggers Order PROCESSING → RETURNED
 */

import { withTransaction } from '../lib/transaction.js';
import { append as appendAudit } from '../repositories/audit.repository.js';
import { append as appendStatusHistory } from '../repositories/orderStatusHistory.repository.js';
import * as ordersRepository from '../repositories/orders.repository.js';
import * as shipmentsRepository from '../repositories/shipments.repository.js';
import { isValidShipmentTransition, isValidOrderTransition } from './orderStateMachine.js';

import type { ShipmentStatus } from '../types/orderEnums.js';
import type { ActorType } from '../types/enums.js';

export type Actor = {
  userId?: string;
  type: ActorType;
};

/**
 * Transition error — state conflict (409 Conflict).
 */
export class ShipmentTransitionError extends Error {
  constructor(
    public from: ShipmentStatus,
    public to: ShipmentStatus,
    public reason: string,
  ) {
    super(`Invalid shipment status transition: ${from} → ${to} (${reason})`);
  }
}

/**
 * Update shipment status. Handles the atomic cascades:
 * - Shipment DELIVERED → Order DELIVERED (§5.21.4)
 * - Shipment RETURNED → Order RETURNED (§5.21.6)
 */
export async function updateShipmentStatus(
  orderId: string,
  newStatus: ShipmentStatus,
  actor: Actor,
  courierDetails?: { courier?: string; courierOrderId?: string },
  requestId?: string,
): Promise<void> {
  await withTransaction(async (client) => {
    const order = await ordersRepository.getOrderById(orderId, { forUpdate: true, db: client });
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    const shipment = await shipmentsRepository.getShipmentByOrderId(orderId, {
      forUpdate: true,
      db: client,
    });
    if (!shipment) {
      throw new Error(`Shipment for order ${orderId} not found`);
    }

    // Validate shipment transition
    const transition = isValidShipmentTransition(shipment.shipment_status, newStatus);
    if (!transition) {
      throw new ShipmentTransitionError(
        shipment.shipment_status,
        newStatus,
        'not a valid shipment transition',
      );
    }

    // Update shipment status with optional courier details
    const updatedShipment = courierDetails
      ? await shipmentsRepository.updateShipmentStatusWithCourierDetails(
          client,
          orderId,
          newStatus,
          courierDetails.courier,
          courierDetails.courierOrderId,
        )
      : await shipmentsRepository.updateShipmentStatus(client, orderId, newStatus);

    // Audit shipment status change
    await appendStatusHistory(client, {
      entityType: 'order',
      entityId: orderId,
      statusField: 'shipment_status',
      previousStatus: shipment.shipment_status,
      newStatus: newStatus,
      reason: undefined,
      actorUserId: actor.userId ?? null,
      actorType: actor.type,
      requestId: requestId ?? null,
    });

    await appendAudit(
      {
        entityType: 'order',
        entityId: orderId,
        action: 'shipment_status_change',
        previousValue: shipment.shipment_status,
        newValue: newStatus,
        actorUserId: actor.userId,
        actorType: actor.type,
        requestId: requestId,
      },
      client,
    );

    // §5.21.4, §5.21.6: Atomic cascades — only two shipment outcomes cascade
    // into order-status changes, applied atomically (same transaction).
    if (newStatus === 'DELIVERED') {
      // Shipment OUT_FOR_DELIVERY → DELIVERED triggers Order PROCESSING → DELIVERED
      if (order.order_status !== 'PROCESSING') {
        throw new Error(
          `Cannot cascade shipment DELIVERED: order is ${order.order_status}, not PROCESSING`,
        );
      }

      const orderTransition = isValidOrderTransition(order.payment_method, 'PROCESSING', 'DELIVERED');
      if (!orderTransition) {
        throw new Error('Order PROCESSING → DELIVERED transition is invalid (should never happen)');
      }

      // Update order status
      await ordersRepository.updateOrderStatus(client, orderId, 'DELIVERED');

      // Audit order status change (as part of the cascade)
      await appendStatusHistory(client, {
        entityType: 'order',
        entityId: orderId,
        statusField: 'order_status',
        previousStatus: 'PROCESSING',
        newStatus: 'DELIVERED',
        reason: 'Cascaded from shipment delivered',
        actorUserId: actor.userId ?? null,
        actorType: actor.type,
        requestId: requestId ?? null,
      });

      await appendAudit(
        {
          entityType: 'order',
          entityId: orderId,
          action: 'order_status_change',
          previousValue: 'PROCESSING',
          newValue: 'DELIVERED',
          reason: 'Cascaded from shipment delivered',
          actorUserId: actor.userId,
          actorType: actor.type,
          requestId: requestId,
        },
        client,
      );
    } else if (newStatus === 'RETURNED') {
      // Shipment DELIVERY_FAILED → RETURNED triggers Order PROCESSING → RETURNED
      if (order.order_status !== 'PROCESSING') {
        throw new Error(
          `Cannot cascade shipment RETURNED: order is ${order.order_status}, not PROCESSING`,
        );
      }

      const orderTransition = isValidOrderTransition(order.payment_method, 'PROCESSING', 'RETURNED');
      if (!orderTransition) {
        throw new Error('Order PROCESSING → RETURNED transition is invalid (should never happen)');
      }

      // Update order status with return tracking
      await ordersRepository.updateOrderStatusWithCancellation(client, orderId, 'RETURNED', actor.userId);

      // Audit order status change (as part of the cascade)
      await appendStatusHistory(client, {
        entityType: 'order',
        entityId: orderId,
        statusField: 'order_status',
        previousStatus: 'PROCESSING',
        newStatus: 'RETURNED',
        reason: 'Cascaded from shipment returned',
        actorUserId: actor.userId ?? null,
        actorType: actor.type,
        requestId: requestId ?? null,
      });

      await appendAudit(
        {
          entityType: 'order',
          entityId: orderId,
          action: 'order_status_change',
          previousValue: 'PROCESSING',
          newValue: 'RETURNED',
          reason: 'Cascaded from shipment returned',
          actorUserId: actor.userId,
          actorType: actor.type,
          requestId: requestId,
        },
        client,
      );
    }
    // No cascade for other transitions (CREATING, SHIPPED, IN_TRANSIT, OUT_FOR_DELIVERY,
    // CREATION_FAILED, DELIVERY_FAILED — order stays PROCESSING throughout).
  });
}

/**
 * Record a courier error on a shipment.
 */
export async function recordCourierError(
  orderId: string,
  error: string,
  actor: Actor,
  requestId?: string,
): Promise<void> {
  await withTransaction(async (client) => {
    const shipment = await shipmentsRepository.getShipmentByOrderId(orderId, {
      forUpdate: true,
      db: client,
    });
    if (!shipment) {
      throw new Error(`Shipment for order ${orderId} not found`);
    }

    // Record the error
    await shipmentsRepository.recordCourierError(client, orderId, error);

    // Audit trail
    await appendAudit(
      {
        entityType: 'shipment',
        entityId: shipment.id,
        action: 'courier_error',
        previousValue: null,
        newValue: error,
        reason: 'Courier API error',
        actorUserId: actor.userId,
        actorType: actor.type,
        requestId: requestId,
      },
      client,
    );
  });
}
