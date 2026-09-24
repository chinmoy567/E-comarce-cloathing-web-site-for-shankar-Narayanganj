/**
 * TypeScript mirrors of the database enums created in spec 07's migration (0006_orders.sql).
 *
 * Each list must stay identical to its Postgres enum; a value added in SQL
 * without a matching entry here is a bug the type system cannot catch (checked
 * by backend/tests/shared/enums.parity.test.ts).
 */

/** 07-order-state-machine §5.21 — order status lifecycle. */
export const ORDER_STATUSES = [
  'PENDING_CONFIRMATION',
  'COD_VERIFICATION_PENDING',
  'CONFIRMED',
  'PROCESSING',
  'DELIVERED',
  'CANCELLED',
  'RETURNED',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && (ORDER_STATUSES as readonly string[]).includes(value);
}

/** 07-order-state-machine §3 — payment method selection at checkout. */
export const PAYMENT_METHODS = ['BKASH', 'COD'] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === 'string' && (PAYMENT_METHODS as readonly string[]).includes(value);
}

/** 07-order-state-machine §5.21.2, §5.21.3 — payment status lifecycle. */
export const PAYMENT_STATUSES = [
  'PENDING_VERIFICATION',
  'PAID_VERIFIED',
  'REJECTED',
  'PENDING_COLLECTION',
  'PAID_COLLECTED',
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export function isPaymentStatus(value: unknown): value is PaymentStatus {
  return typeof value === 'string' && (PAYMENT_STATUSES as readonly string[]).includes(value);
}

/** 07-order-state-machine §5.21.4 — shipment status lifecycle. */
export const SHIPMENT_STATUSES = [
  'NOT_CREATED',
  'CREATING',
  'CREATED',
  'SHIPPED',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CREATION_FAILED',
  'DELIVERY_FAILED',
  'RETURNED',
] as const;

export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export function isShipmentStatus(value: unknown): value is ShipmentStatus {
  return typeof value === 'string' && (SHIPMENT_STATUSES as readonly string[]).includes(value);
}
