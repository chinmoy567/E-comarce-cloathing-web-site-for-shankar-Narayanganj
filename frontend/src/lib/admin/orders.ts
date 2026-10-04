/**
 * Shared types, labels and formatters for the back-office order, customer and
 * dashboard screens (spec 13). The backend is the authority for every status,
 * amount and allowed action; nothing here derives business state.
 */

export type PaymentMethod = 'BKASH' | 'COD';

export type AllowedAction =
  | 'verify_payment'
  | 'reject_payment'
  | 'confirm'
  | 'cod_confirm'
  | 'start_processing'
  | 'cancel'
  | 'mark_cod_collected'
  | 'mark_cod_not_recoverable';

export type AdminOrderListItem = {
  id: string;
  order_number: string;
  customer_id: string;
  full_name: string | null;
  phone_number: string | null;
  payment_method: PaymentMethod;
  order_status: string;
  payment_status: string;
  shipment_status: string;
  total_amount: number;
  created_at: string;
  last_payment_rejected_at: string | null;
  is_guest_order: boolean;
  has_coupon_applied: boolean;
  has_cod_collection_discrepancy: boolean;
};

export type AdminOrderDetail = AdminOrderListItem & {
  subtotal: number;
  shipping_amount: number;
  discount_amount: number | null;
  cancellation_reason: string | null;
  cancelled_at: string | null;
  bkash_transaction_id: string | null;
  internal_note: string | null;
  /** A note for the courier, sent when the shipment is created. */
  delivery_instructions: string | null;
  division: string | null;
  district: string | null;
  area_unit_type: string | null;
  area_unit_name: string | null;
  ward_unit_type: string | null;
  ward_unit_name: string | null;
  detailed_address: string | null;
  postal_code: string | null;
  customer: { id: string; accountType: 'GUEST' | 'REGISTERED'; email: string | null } | null;
  items: Array<{
    productName: string;
    variantDescription: string | null;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
  }>;
  applied_coupon: {
    code: string;
    discountType: string | null;
    discountAmount: number;
    eligibleSubtotal: number | null;
  } | null;
  shipment: { courier: string | null; courierOrderId: string | null; status: string; lastError: string | null } | null;
  allowed_actions: AllowedAction[];
};

export type PaymentPanelData = {
  method: PaymentMethod;
  status: string;
  amountDue: number;
  bkashTransactionId: string | null;
  /** A screenshot was submitted; the image is only reachable through the signed-URL route. */
  hasProof: boolean;
  lastRejectedAt: string | null;
  events: Array<{
    previousStatus: string | null;
    newStatus: string;
    reason: string | null;
    actorUserId: string | null;
    actorType: string;
    at: string;
  }>;
};

export type HistoryEntry = {
  id: string;
  status_field: 'order_status' | 'payment_status' | 'shipment_status';
  previous_status: string | null;
  new_status: string;
  reason: string | null;
  actor_type: string;
  created_at: string;
};

/** 03-payment-order §3.4's listed rejection reasons. */
export const PAYMENT_REJECTION_REASONS: Array<{ value: string; label: string }> = [
  { value: 'INVALID_TRANSACTION_ID', label: 'Invalid transaction ID' },
  { value: 'TRANSACTION_MISMATCH', label: 'Transaction does not match' },
  { value: 'INCORRECT_AMOUNT', label: 'Incorrect amount' },
  { value: 'UNVERIFIABLE', label: 'Payment could not be verified' },
  { value: 'UNCLEAR_SCREENSHOT', label: 'Unclear screenshot' },
  { value: 'PAYMENT_NOT_COMPLETED', label: 'Payment not completed' },
  { value: 'OTHER', label: 'Other' },
];

const STATUS_LABELS: Record<string, string> = {
  PENDING_CONFIRMATION: 'Pending confirmation',
  COD_VERIFICATION_PENDING: 'COD verification pending',
  CONFIRMED: 'Confirmed',
  PROCESSING: 'Processing',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  RETURNED: 'Returned',
  PENDING_VERIFICATION: 'Pending verification',
  PAID_VERIFIED: 'Paid (verified)',
  REJECTED: 'Rejected',
  PENDING_COLLECTION: 'Pending collection',
  PAID_COLLECTED: 'Paid (collected)',
  NOT_CREATED: 'Not created',
  CREATING: 'Creating',
  CREATED: 'Created',
  SHIPPED: 'Shipped',
  IN_TRANSIT: 'In transit',
  OUT_FOR_DELIVERY: 'Out for delivery',
  CREATION_FAILED: 'Creation failed',
  DELIVERY_FAILED: 'Delivery failed',
};

export function statusLabel(value: string): string {
  return STATUS_LABELS[value] ?? value;
}

export function formatPrice(amount: number): string {
  return new Intl.NumberFormat('en-BD', {
    style: 'currency',
    currency: 'BDT',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(value: string, withTime = false): string {
  return new Date(value).toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}
