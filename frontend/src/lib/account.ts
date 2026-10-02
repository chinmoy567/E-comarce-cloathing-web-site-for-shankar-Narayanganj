/**
 * Customer account types and display labels (02-customer §2.6/§2.9.6,
 * 03-payment-order §3.6–3.8). The backend returns enum values; the labels
 * shown to customers are the Title Case display labels from the PRD, never
 * the raw SCREAMING_SNAKE_CASE values.
 */

const ORDER_STATUS_LABELS: Record<string, string> = {
  PENDING_CONFIRMATION: 'Pending Confirmation',
  COD_VERIFICATION_PENDING: 'COD Verification Pending',
  CONFIRMED: 'Confirmed',
  PROCESSING: 'Processing',
  CANCELLED: 'Cancelled',
  DELIVERED: 'Delivered',
  RETURNED: 'Returned',
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  PENDING_VERIFICATION: 'Pending Verification',
  PAID_VERIFIED: 'Paid / Verified',
  REJECTED: 'Rejected',
  PENDING_COLLECTION: 'Pending Collection',
  PAID_COLLECTED: 'Paid / Collected',
};

const SHIPMENT_STATUS_LABELS: Record<string, string> = {
  NOT_CREATED: 'Not Created',
  CREATING: 'Creating',
  CREATED: 'Created',
  SHIPPED: 'Shipped',
  IN_TRANSIT: 'In Transit',
  OUT_FOR_DELIVERY: 'Out for Delivery',
  DELIVERED: 'Delivered',
  CREATION_FAILED: 'Creation Failed',
  DELIVERY_FAILED: 'Delivery Failed',
  RETURNED: 'Returned',
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  BKASH: 'bKash',
  COD: 'Cash on Delivery',
};

/** Falls back to a readable Title Case rendering so an unmapped value is never shown raw. */
function humanize(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export const orderStatusLabel = (v: string) => ORDER_STATUS_LABELS[v] ?? humanize(v);
export const paymentStatusLabel = (v: string) => PAYMENT_STATUS_LABELS[v] ?? humanize(v);
export const shipmentStatusLabel = (v: string) => SHIPMENT_STATUS_LABELS[v] ?? humanize(v);
export const paymentMethodLabel = (v: string) => PAYMENT_METHOD_LABELS[v] ?? humanize(v);

export const formatMoney = (amount: number) => `৳${amount.toLocaleString('en-BD')}`;

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

/** A row of GET /api/customer/orders — customer-safe, no internal ids; link by `orderNumber`. */
export type OrderSummary = {
  orderNumber: string;
  placedAt: string;
  paymentMethod: string;
  orderStatus: string;
  paymentStatus: string;
  shipmentStatus: string;
  totalAmount: number;
  itemCount: number;
};

/** Present only once a courier parcel exists (spec 15). Tracking links are backend-resolved. */
export type ShipmentBlock = {
  courierName: string;
  trackingId: string;
  shipmentStatus: string;
  trackingUrl: string | null;
};

/** One entry of the customer-safe status history: status + time only. */
export type StatusEvent = { kind: 'ORDER' | 'PAYMENT' | 'SHIPMENT'; status: string; occurredAt: string };

export type OrderLine = {
  productName: string;
  variantLabel: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type OrderAmounts = {
  subtotal: number;
  discountAmount: number;
  shippingAmount: number;
  totalAmount: number;
};

/** The order fields shared by the guest lookup and the account detail (one record, §4.7). */
export type CustomerOrderView = {
  orderNumber: string;
  placedAt: string;
  orderStatus: string;
  paymentStatus: string;
  shipmentStatus: string;
  paymentMethod: string;
  amounts: OrderAmounts;
  appliedCouponCode: string | null;
  items: OrderLine[];
  deliveryAddressSummary: string;
  shipment: ShipmentBlock | null;
  paymentResubmissionAllowed: boolean;
  statusHistory: StatusEvent[];
  /** Deterministic Meta Purchase event_id; null until the order has reached CONFIRMED (spec 18). */
  purchaseEventId: string | null;
};

export type GuestOrderLookupResponse = ({ found: true } & CustomerOrderView) | { found: false; message: string };

export type DeliveryAddress = {
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

export type OrderDetail = CustomerOrderView & {
  deliveryAddress: DeliveryAddress;
  trackOrder: { available: boolean; trackingId: string | null };
};

export type CustomerProfile = {
  id: string;
  phone_number: string;
  full_name: string;
  email?: string;
  division: string;
  district: string;
  area_unit_type: 'UPAZILA' | 'THANA';
  area_unit_name: string;
  ward_unit_type: 'UNION' | 'WARD';
  ward_unit_name: string;
  detailed_address: string;
  postal_code: string | null;
  is_complete: boolean;
};

/** One-line delivery address for summaries. */
export function formatAddressLine(a: DeliveryAddress): string {
  return [a.detailedAddress, a.wardUnitName, a.areaUnitName, a.district, a.division]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(', ');
}
