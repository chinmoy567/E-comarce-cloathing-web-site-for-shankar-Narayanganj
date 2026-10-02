/**
 * Customer-safe order projections (spec 15 — 02-customer §2.6/§2.9.6/§2.9.7,
 * 04-courier §4.14/§4.16).
 *
 * These functions are the ONLY serializers for customer-facing order data: guest lookup,
 * account history/detail and Track Order all build their payload here, so a new internal
 * column cannot reach a customer by default. Never projected: admin/manager notes,
 * fraud/risk results, payment proof or screenshots, the Transaction ID, credentials,
 * internal database ids, or the stored contact record beyond what each view allows.
 */

import { NotFoundError } from '../lib/errors.js';
import { normalizeBdPhone } from '../lib/phone.js';
import { withTransaction } from '../lib/transaction.js';
import * as analyticsRepository from '../repositories/analytics.repository.js';
import { purchaseEventIdFor } from './analytics/purchaseEvent.js';
import * as couriersRepository from '../repositories/couriers.repository.js';
import * as orderItemsRepository from '../repositories/orderItems.repository.js';
import * as orderStatusHistoryRepository from '../repositories/orderStatusHistory.repository.js';
import * as ordersRepository from '../repositories/orders.repository.js';
import type { Order } from '../repositories/orders.repository.js';
import * as shipmentsRepository from '../repositories/shipments.repository.js';
import type { ShipmentRow, TrackingEventSnapshot } from '../repositories/shipments.repository.js';
import type { OrderStatus, PaymentMethod, PaymentStatus, ShipmentStatus } from '../types/orderEnums.js';
import { resolveTrackingUrl } from './shipment.service.js';
import { ACTIVE_TRACKING_STATUSES, refreshShipmentFromCourier } from './courierSync.service.js';

/** Shipment states in which a parcel exists at a courier and a courier-issued id is meaningful. */
const PARCEL_EXISTS: readonly ShipmentStatus[] = [
  'CREATED', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED', 'RETURNED',
];

/** `FBK-YYYYMMDD-XXXXXX` — mirrors ordersRepository.generateOrderNumber. */
const ORDER_NUMBER_FORMAT = /^FBK-\d{8}-[A-Z0-9]{6}$/;

export const TRACK_GENERIC_MESSAGE =
  'Tracking information could not be found. Please check your Order ID / Tracking ID and try again.';
export const TRACK_NOT_AVAILABLE_YET_MESSAGE =
  'Shipment tracking is not available yet. Your order has been confirmed and is being prepared for shipment. ' +
  'A tracking ID will be available once the courier shipment has been created.';
export const GUEST_LOOKUP_NOT_FOUND_MESSAGE = 'We could not find an order matching those details.';

/** CREATING / CREATION_FAILED are internal creation states — a customer sees "not created yet". */
export function customerShipmentStatus(status: ShipmentStatus): ShipmentStatus {
  return status === 'CREATING' || status === 'CREATION_FAILED' ? 'NOT_CREATED' : status;
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

export type CustomerStatusEvent = { kind: 'ORDER' | 'PAYMENT' | 'SHIPMENT'; status: string; occurredAt: string };

const KIND_OF: Record<'order_status' | 'payment_status' | 'shipment_status', CustomerStatusEvent['kind']> = {
  order_status: 'ORDER',
  payment_status: 'PAYMENT',
  shipment_status: 'SHIPMENT',
};

/** Status + time only — no actor, reason, note or id (the same rows the admin timeline reads, so views cannot disagree). */
async function loadStatusHistory(orderId: string): Promise<CustomerStatusEvent[]> {
  const { items } = await orderStatusHistoryRepository.listForOrder(orderId, { page: 1, pageSize: 200 });
  return items
    .filter((row) => !(row.status_field === 'shipment_status' && ['NOT_CREATED', 'CREATING', 'CREATION_FAILED'].includes(row.new_status)))
    .reverse()
    .map((row) => ({ kind: KIND_OF[row.status_field], status: row.new_status, occurredAt: row.created_at.toISOString() }));
}

function deliveryAreaOf(order: Order): string | null {
  const parts = [order.area_unit_name, order.district].filter((p): p is string => !!p && p.length > 0);
  return parts.length > 0 ? parts.join(', ') : null;
}

function deliveryAddressSummaryOf(order: Order): string {
  return [order.area_unit_name, order.district, order.division].filter((p): p is string => !!p).join(', ');
}

async function loadItems(orderId: string) {
  const items = await withTransaction((client) => orderItemsRepository.listByOrderId(client, orderId));
  return items.map((item) => ({
    productName: item.product_name,
    variantLabel: item.variant_description ?? '',
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    lineTotal: item.lineTotal,
  }));
}

function amountsOf(order: Order) {
  return {
    subtotal: order.subtotal,
    discountAmount: order.discount_amount ?? 0,
    shippingAmount: order.shipping_amount,
    totalAmount: order.total_amount,
  };
}

type ShipmentBlock = {
  courierName: string;
  trackingId: string;
  shipmentStatus: ShipmentStatus;
  trackingUrl: string | null;
};

async function trackingUrlOf(shipment: ShipmentRow): Promise<{ courierName: string | null; trackingUrl: string | null }> {
  const courier = shipment.courier ? await couriersRepository.getByCode(shipment.courier) : null;
  const stored = shipment.tracking_url;
  const trackingUrl =
    stored && stored.startsWith('https://')
      ? stored
      : shipment.courier_order_id
        ? resolveTrackingUrl(courier?.tracking_url_template ?? null, shipment.courier_order_id, null)
        : null;
  return { courierName: courier?.name ?? null, trackingUrl: trackingUrl && trackingUrl.startsWith('https://') ? trackingUrl : null };
}

async function shipmentBlockOf(shipment: ShipmentRow | null): Promise<ShipmentBlock | null> {
  if (!shipment || !shipment.courier_order_id || !PARCEL_EXISTS.includes(shipment.shipment_status)) return null;
  const { courierName, trackingUrl } = await trackingUrlOf(shipment);
  return {
    courierName: courierName ?? shipment.courier ?? '',
    trackingId: shipment.courier_order_id,
    shipmentStatus: shipment.shipment_status,
    trackingUrl,
  };
}

/** Derived, so the page can offer resubmission without learning payment internals. */
function paymentResubmissionAllowed(order: Order): boolean {
  return order.payment_method === 'BKASH' && (order.payment_status === 'PENDING_VERIFICATION' || order.payment_status === 'REJECTED');
}

// ---------------------------------------------------------------------------
// Guest lookup (§2.9.5–2.9.7)
// ---------------------------------------------------------------------------

export type GuestOrderView = {
  orderNumber: string;
  placedAt: string;
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  shipmentStatus: ShipmentStatus;
  paymentMethod: PaymentMethod;
  amounts: ReturnType<typeof amountsOf>;
  appliedCouponCode: string | null;
  items: Awaited<ReturnType<typeof loadItems>>;
  deliveryAddressSummary: string;
  shipment: ShipmentBlock | null;
  paymentResubmissionAllowed: boolean;
  statusHistory: CustomerStatusEvent[];
  /** Deterministic Meta Purchase event_id (spec 18); null until the order has reached CONFIRMED and again once it is cancelled/returned. */
  purchaseEventId: string | null;
};

/**
 * The browser Pixel copy of Purchase may only fire for an order that is still a live sale:
 * once cancelled or returned the ID is withheld so the customer's browser never reports it
 * (the server copy already sent is not reversed — 08-analytics-meta §6.3).
 */
export async function purchaseEventIdForView(order: Order): Promise<string | null> {
  if (order.order_status === 'CANCELLED' || order.order_status === 'RETURNED') return null;
  return (await analyticsRepository.hasPurchaseLog(undefined, order.id))
    ? purchaseEventIdFor(order.order_number)
    : null;
}

async function toGuestOrderView(order: Order): Promise<GuestOrderView> {
  const shipment = await shipmentsRepository.getShipmentByOrderId(order.id);
  return {
    orderNumber: order.order_number,
    placedAt: order.created_at.toISOString(),
    orderStatus: order.order_status,
    paymentStatus: order.payment_status,
    shipmentStatus: customerShipmentStatus(shipment?.shipment_status ?? 'NOT_CREATED'),
    paymentMethod: order.payment_method,
    amounts: amountsOf(order),
    appliedCouponCode: order.coupon_code,
    items: await loadItems(order.id),
    deliveryAddressSummary: deliveryAddressSummaryOf(order),
    shipment: await shipmentBlockOf(shipment),
    paymentResubmissionAllowed: paymentResubmissionAllowed(order),
    statusHistory: await loadStatusHistory(order.id),
    purchaseEventId: await purchaseEventIdForView(order),
  };
}

/**
 * ONE indexed query on the (order number, phone) pair for every outcome — an unknown number,
 * a wrong phone and a malformed phone all run the same path and return null, so the endpoint
 * is no enumeration oracle (§2.9.7). A malformed phone cannot match any stored phone, so the
 * query is still issued with a value that matches nothing rather than returning early.
 */
export async function lookupGuestOrder(orderNumber: string, phoneNumber: string): Promise<GuestOrderView | null> {
  let phone: string;
  try {
    phone = normalizeBdPhone(phoneNumber);
  } catch {
    phone = '';
  }
  const order = await ordersRepository.findByOrderNumberAndPhone(orderNumber.trim().toUpperCase(), phone);
  return order ? toGuestOrderView(order) : null;
}

// ---------------------------------------------------------------------------
// Registered-customer account views (§2.6, §4.14.5)
// ---------------------------------------------------------------------------

export type CustomerOrderListItem = {
  orderNumber: string;
  placedAt: string;
  paymentMethod: PaymentMethod;
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  shipmentStatus: ShipmentStatus;
  totalAmount: number;
  itemCount: number;
};

export async function getCustomerOrderList(
  customerId: string,
  pagination: { page: number; pageSize: number },
): Promise<{ items: CustomerOrderListItem[]; total: number }> {
  const { items, total } = await ordersRepository.listOrders({ customer_id: customerId }, pagination);
  const units = await withTransaction((client) => orderItemsRepository.sumQuantityByOrderIds(client, items.map((o) => o.id)));
  return {
    total,
    items: items.map((order) => ({
      orderNumber: order.order_number,
      placedAt: order.created_at.toISOString(),
      paymentMethod: order.payment_method,
      orderStatus: order.order_status,
      paymentStatus: order.payment_status,
      shipmentStatus: customerShipmentStatus(order.shipment_status as ShipmentStatus),
      totalAmount: order.total_amount,
      itemCount: units.get(order.id) ?? 0,
    })),
  };
}

export type CustomerOrderDetailView = GuestOrderView & {
  deliveryAddress: {
    fullName: string | null;
    phoneNumber: string | null;
    division: string | null;
    district: string | null;
    areaUnitType: string | null;
    areaUnitName: string | null;
    wardUnitType: string | null;
    wardUnitName: string | null;
    detailedAddress: string | null;
    postalCode: string | null;
  };
  trackOrder: { available: boolean; trackingId: string | null };
};

/**
 * One order for its owner, keyed by Order Number. Another customer's order and a nonexistent
 * one are the same NotFound, so order numbers cannot be probed. Ownership is the session's
 * customer id — never a client-supplied one — so a guest order the customer later claimed
 * (§2.9.8) appears with no data migration.
 */
export async function getCustomerOrderDetail(customerId: string, orderNumber: string): Promise<CustomerOrderDetailView> {
  const order = await ordersRepository.findByOrderNumber(orderNumber.trim().toUpperCase());
  if (!order || order.customer_id !== customerId) throw new NotFoundError('Order not found.');

  const view = await toGuestOrderView(order);
  return {
    ...view,
    deliveryAddress: {
      fullName: order.full_name,
      phoneNumber: order.phone_number,
      division: order.division,
      district: order.district,
      areaUnitType: order.area_unit_type,
      areaUnitName: order.area_unit_name,
      wardUnitType: order.ward_unit_type,
      wardUnitName: order.ward_unit_name,
      detailedAddress: order.detailed_address,
      postalCode: order.postal_code,
    },
    trackOrder: { available: view.shipment !== null, trackingId: view.shipment?.trackingId ?? null },
  };
}

// ---------------------------------------------------------------------------
// Public Track Order (§4.14, §4.16)
// ---------------------------------------------------------------------------

export type TrackOrderResult =
  | {
      found: true;
      trackingId: string;
      courierName: string;
      shipmentStatus: ShipmentStatus;
      events: TrackingEventSnapshot[];
      estimatedDeliveryAt: string | null;
      deliveryAreaSummary: string | null;
      courierTrackingUrl: string | null;
    }
  | { found: false; reason: 'GENERIC' | 'NOT_AVAILABLE_YET'; message: string };

const GENERIC_NOT_FOUND: TrackOrderResult = { found: false, reason: 'GENERIC', message: TRACK_GENERIC_MESSAGE };

/**
 * Courier events to show: the courier's own normalized events when it provided them,
 * otherwise this platform's recorded shipment transitions (real, timestamped). Nothing is
 * ever invented to fill a gap in the trail (§4.14.4).
 */
async function eventsFor(shipment: ShipmentRow): Promise<TrackingEventSnapshot[]> {
  if (shipment.last_events && shipment.last_events.length > 0) return shipment.last_events.slice(0, 50);
  const history = await loadStatusHistory(shipment.order_id);
  return history
    .filter((e) => e.kind === 'SHIPMENT')
    .map((e) => ({ status: e.status as ShipmentStatus, occurredAt: e.occurredAt, description: '' }));
}

/**
 * Courier-identifier lookup. An unknown id, an id of another courier's parcel, an id whose
 * shipment is not created yet and a multi-courier collision all return the byte-identical
 * generic body (§4.16). The single exception, required by §4.14.4, is a real store Order
 * Number whose order has no shipment yet — which discloses no order detail.
 */
export async function trackOrder(trackingId: string): Promise<TrackOrderResult> {
  const matches = await shipmentsRepository.findByCourierOrderId(trackingId);
  const candidate = matches.length === 1 ? matches[0]! : null;

  if (candidate && PARCEL_EXISTS.includes(candidate.shipment_status)) {
    let shipment = candidate;
    if (ACTIVE_TRACKING_STATUSES.includes(shipment.shipment_status)) {
      const refresh = await refreshShipmentFromCourier(shipment);
      if (refresh.called) shipment = (await shipmentsRepository.getShipmentById(shipment.id)) ?? shipment;
    }
    const order = await ordersRepository.getOrderById(shipment.order_id);
    const { courierName, trackingUrl } = await trackingUrlOf(shipment);
    return {
      found: true,
      trackingId: shipment.courier_order_id as string,
      courierName: courierName ?? '',
      shipmentStatus: shipment.shipment_status,
      events: await eventsFor(shipment),
      estimatedDeliveryAt: iso(shipment.last_estimated_delivery),
      deliveryAreaSummary: order ? deliveryAreaOf(order) : null,
      courierTrackingUrl: trackingUrl,
    };
  }

  if (matches.length === 0 && ORDER_NUMBER_FORMAT.test(trackingId.toUpperCase())) {
    const order = await ordersRepository.findByOrderNumber(trackingId.toUpperCase());
    if (order) {
      const shipment = await shipmentsRepository.getShipmentByOrderId(order.id);
      if (!shipment || !PARCEL_EXISTS.includes(shipment.shipment_status)) {
        return { found: false, reason: 'NOT_AVAILABLE_YET', message: TRACK_NOT_AVAILABLE_YET_MESSAGE };
      }
    }
  }

  return GENERIC_NOT_FOUND;
}
