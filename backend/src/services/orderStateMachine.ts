/**
 * Order/Payment/Shipment State Machine — Transition Tables
 *
 * 07-order-state-machine §5.21: Pure, side-effect-free module exhaustively
 * encoding every allowed transition for order_status, payment_status, and
 * shipment_status. This is the single source of truth for the state machine —
 * every transition in the spec is readable here, unit-testable without a DB,
 * and referenced by every service function that mutates state.
 *
 * Invalid transitions are rejected simply by returning undefined; no separate
 * blocklist is needed (§5.21.10).
 */

import type { PermissionKey } from '../types/permissions.js';
import type { OrderStatus, PaymentStatus, ShipmentStatus, PaymentMethod } from '../types/orderEnums.js';

export type Transition<S extends string> = {
  from: S;
  to: S;
  permission: PermissionKey;
  trigger: 'ADMIN' | 'SYSTEM';
};

/**
 * §5.21.1 (bKash) + §5.21.3 (COD) — order status transitions.
 * Combined per payment_method; COD substitutes COD_VERIFICATION_PENDING
 * for PENDING_CONFIRMATION as the initial state.
 */
export const ORDER_STATUS_TRANSITIONS: Record<PaymentMethod, readonly Transition<OrderStatus>[]> =
  {
    BKASH: [
      { from: 'PENDING_CONFIRMATION', to: 'CONFIRMED', permission: 'order.confirm', trigger: 'ADMIN' },
      { from: 'PENDING_CONFIRMATION', to: 'CANCELLED', permission: 'order.cancel', trigger: 'ADMIN' },
      { from: 'CONFIRMED', to: 'PROCESSING', permission: 'order.confirm', trigger: 'ADMIN' },
      { from: 'CONFIRMED', to: 'CANCELLED', permission: 'order.cancel', trigger: 'ADMIN' },
      { from: 'PROCESSING', to: 'CANCELLED', permission: 'order.cancel', trigger: 'ADMIN' },
      {
        from: 'PROCESSING',
        to: 'RETURNED',
        permission: 'order.cancel',
        trigger: 'SYSTEM',
      },
      {
        from: 'PROCESSING',
        to: 'DELIVERED',
        permission: 'shipment.track',
        trigger: 'SYSTEM',
      },
    ],
    COD: [
      {
        from: 'COD_VERIFICATION_PENDING',
        to: 'CONFIRMED',
        permission: 'order.cod.confirm',
        trigger: 'ADMIN',
      },
      {
        from: 'COD_VERIFICATION_PENDING',
        to: 'CANCELLED',
        permission: 'order.cancel',
        trigger: 'ADMIN',
      },
      { from: 'CONFIRMED', to: 'PROCESSING', permission: 'order.confirm', trigger: 'ADMIN' },
      { from: 'CONFIRMED', to: 'CANCELLED', permission: 'order.cancel', trigger: 'ADMIN' },
      { from: 'PROCESSING', to: 'CANCELLED', permission: 'order.cancel', trigger: 'ADMIN' },
      {
        from: 'PROCESSING',
        to: 'RETURNED',
        permission: 'order.cancel',
        trigger: 'SYSTEM',
      },
      {
        from: 'PROCESSING',
        to: 'DELIVERED',
        permission: 'shipment.track',
        trigger: 'SYSTEM',
      },
    ],
  };

/**
 * §5.21.2 — payment status transitions (independent of order status).
 * bKash uses: PENDING_VERIFICATION → PAID_VERIFIED / REJECTED → PENDING_VERIFICATION
 * COD uses: PENDING_COLLECTION → PAID_COLLECTED / REJECTED
 */
export const PAYMENT_STATUS_TRANSITIONS: Record<PaymentMethod, readonly Transition<PaymentStatus>[]> =
  {
    BKASH: [
      {
        from: 'PENDING_VERIFICATION',
        to: 'PAID_VERIFIED',
        permission: 'payment.verify',
        trigger: 'ADMIN',
      },
      {
        from: 'PENDING_VERIFICATION',
        to: 'REJECTED',
        permission: 'payment.reject',
        trigger: 'ADMIN',
      },
      {
        from: 'REJECTED',
        to: 'PENDING_VERIFICATION',
        permission: 'payment.review',
        trigger: 'ADMIN',
      },
    ],
    COD: [
      {
        from: 'PENDING_COLLECTION',
        to: 'PAID_COLLECTED',
        permission: 'payment.verify',
        trigger: 'ADMIN',
      },
      {
        from: 'PENDING_COLLECTION',
        to: 'REJECTED',
        permission: 'payment.reject',
        trigger: 'ADMIN',
      },
    ],
  };

/**
 * §5.21.4, §5.21.5, §5.21.6, §5.21.8 — shipment status transitions.
 * One flat list; shipment lifecycle is identical for bKash and COD.
 */
export const SHIPMENT_STATUS_TRANSITIONS: readonly Transition<ShipmentStatus>[] = [
  { from: 'NOT_CREATED', to: 'CREATING', permission: 'shipment.create', trigger: 'ADMIN' },
  { from: 'CREATING', to: 'CREATED', permission: 'shipment.create', trigger: 'SYSTEM' },
  {
    from: 'CREATING',
    to: 'CREATION_FAILED',
    permission: 'shipment.create',
    trigger: 'SYSTEM',
  },
  {
    from: 'CREATION_FAILED',
    to: 'CREATING',
    permission: 'shipment.retry',
    trigger: 'ADMIN',
  },
  { from: 'CREATED', to: 'SHIPPED', permission: 'shipment.create', trigger: 'ADMIN' },
  { from: 'SHIPPED', to: 'IN_TRANSIT', permission: 'shipment.track', trigger: 'SYSTEM' },
  {
    from: 'IN_TRANSIT',
    to: 'OUT_FOR_DELIVERY',
    permission: 'shipment.track',
    trigger: 'SYSTEM',
  },
  {
    from: 'OUT_FOR_DELIVERY',
    to: 'DELIVERED',
    permission: 'shipment.track',
    trigger: 'SYSTEM',
  },
  {
    from: 'OUT_FOR_DELIVERY',
    to: 'DELIVERY_FAILED',
    permission: 'shipment.track',
    trigger: 'SYSTEM',
  },
  {
    from: 'DELIVERY_FAILED',
    to: 'IN_TRANSIT',
    permission: 'shipment.retry',
    trigger: 'ADMIN',
  },
  {
    from: 'DELIVERY_FAILED',
    to: 'RETURNED',
    permission: 'shipment.track',
    trigger: 'SYSTEM',
  },
];

/**
 * Validates whether a transition from one order status to another is allowed
 * under the given payment method's rules. Returns the transition object if valid,
 * undefined if not. This directly implements §5.21.10's requirement that invalid
 * transitions (e.g., PENDING_CONFIRMATION → PROCESSING) are rejected simply
 * because they don't exist in this table.
 */
export function isValidOrderTransition(
  method: PaymentMethod,
  from: OrderStatus,
  to: OrderStatus,
): Transition<OrderStatus> | undefined {
  const transitions = ORDER_STATUS_TRANSITIONS[method];
  return transitions.find((t) => t.from === from && t.to === to);
}

/**
 * Validates whether a payment status transition is allowed under the given
 * payment method's rules.
 */
export function isValidPaymentTransition(
  method: PaymentMethod,
  from: PaymentStatus,
  to: PaymentStatus,
): Transition<PaymentStatus> | undefined {
  const transitions = PAYMENT_STATUS_TRANSITIONS[method];
  return transitions.find((t) => t.from === from && t.to === to);
}

/**
 * Validates whether a shipment status transition is allowed.
 * (Shipment lifecycle is identical for both bKash and COD.)
 */
export function isValidShipmentTransition(
  from: ShipmentStatus,
  to: ShipmentStatus,
): Transition<ShipmentStatus> | undefined {
  return SHIPMENT_STATUS_TRANSITIONS.find((t) => t.from === from && t.to === to);
}

/**
 * Returns the initial order status for a given payment method.
 * §5.21.1: bKash starts at PENDING_CONFIRMATION.
 * §5.21.3: COD starts at COD_VERIFICATION_PENDING.
 */
export function initialOrderStatus(method: PaymentMethod): OrderStatus {
  return method === 'COD' ? 'COD_VERIFICATION_PENDING' : 'PENDING_CONFIRMATION';
}

/**
 * Returns the initial payment status for a given payment method.
 * §5.21.2: bKash starts at PENDING_VERIFICATION.
 * §5.21.3: COD starts at PENDING_COLLECTION.
 */
export function initialPaymentStatus(method: PaymentMethod): PaymentStatus {
  return method === 'COD' ? 'PENDING_COLLECTION' : 'PENDING_VERIFICATION';
}

/**
 * Returns the initial shipment status (same for both methods).
 */
export function initialShipmentStatus(): ShipmentStatus {
  return 'NOT_CREATED';
}
