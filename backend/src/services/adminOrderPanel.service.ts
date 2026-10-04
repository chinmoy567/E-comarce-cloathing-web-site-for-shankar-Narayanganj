/**
 * Admin order panel read/edit service (spec 13, 05-admin §5.2-§5.4).
 *
 * Reads assemble the detail view and the payment panel; the only writes here
 * are the narrow `PATCH` whitelist, the COD-specific entry points, and the COD
 * collection resolution. Every status change is delegated to the existing
 * transition services (`orderStatus.service`, `paymentStatus.service`) — nothing
 * in this module issues an UPDATE against a status column.
 */

import { hasPaymentProof } from './storage/paymentProofs.service.js';
import { withTransaction } from '../lib/transaction.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import { normalizeBdPhone } from '../lib/phone.js';
import { append as appendAudit } from '../repositories/audit.repository.js';
import * as ordersRepository from '../repositories/orders.repository.js';
import * as orderStatusHistoryRepository from '../repositories/orderStatusHistory.repository.js';
import * as shipmentsRepository from '../repositories/shipments.repository.js';
import * as orderStatusService from './orderStatus.service.js';
import * as paymentStatusService from './paymentStatus.service.js';
import { isValidOrderTransition, isValidPaymentTransition } from './orderStateMachine.js';
import { run } from '../repositories/db.js';
import type { Order } from '../repositories/orders.repository.js';
import type { PermissionKey } from '../types/permissions.js';
import type { z } from 'zod';
import type { updateOrderSchema } from '../validation/orders.validation.js';

type UpdateOrderRequest = z.infer<typeof updateOrderSchema>;

export type AllowedAction =
  | 'verify_payment'
  | 'reject_payment'
  | 'confirm'
  | 'cod_confirm'
  | 'start_processing'
  | 'cancel'
  | 'mark_cod_collected'
  | 'mark_cod_not_recoverable';

/** 05-admin §5.2 / §5.21.3: computed per read from the two statuses it derives from, never stored. */
export function hasCodCollectionDiscrepancy(order: Pick<Order, 'payment_method' | 'order_status' | 'payment_status'>): boolean {
  return order.payment_method === 'COD' && order.order_status === 'DELIVERED' && order.payment_status === 'PENDING_COLLECTION';
}

/**
 * The actions this actor may take right now: the transition table says whether
 * the move is legal for the order's current statuses, the actor's permissions
 * say whether they may perform it. A UI convenience only — every endpoint
 * re-checks both (§5.15, §5.17).
 */
export function computeAllowedActions(
  order: Pick<Order, 'payment_method' | 'order_status' | 'payment_status'>,
  permissions: readonly string[],
): AllowedAction[] {
  const can = (key: PermissionKey) => permissions.includes(key);
  const actions: AllowedAction[] = [];
  const { payment_method: method, order_status: orderStatus, payment_status: paymentStatus } = order;

  if (isValidPaymentTransition(method, paymentStatus, 'PAID_VERIFIED') && method === 'BKASH' && can('payment.verify')) {
    actions.push('verify_payment');
  }
  if (isValidPaymentTransition(method, paymentStatus, 'REJECTED') && method === 'BKASH' && can('payment.reject')) {
    actions.push('reject_payment');
  }

  if (isValidOrderTransition(method, orderStatus, 'CONFIRMED')) {
    if (method === 'BKASH' && paymentStatus === 'PAID_VERIFIED' && can('order.confirm')) actions.push('confirm');
    if (method === 'COD' && can('order.cod.confirm')) actions.push('cod_confirm');
  }
  if (isValidOrderTransition(method, orderStatus, 'PROCESSING') && can('order.confirm')) actions.push('start_processing');
  if (isValidOrderTransition(method, orderStatus, 'CANCELLED') && can('order.cancel')) actions.push('cancel');

  if (hasCodCollectionDiscrepancy(order) && can('order.update')) {
    actions.push('mark_cod_collected', 'mark_cod_not_recoverable');
  }
  return actions;
}

export type AdminOrderDetail = {
  order: Order;
  isGuestOrder: boolean;
  hasCodCollectionDiscrepancy: boolean;
  customer: { id: string; accountType: 'GUEST' | 'REGISTERED'; email: string | null } | null;
  items: Array<{
    productName: string;
    variantDescription: string | null;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
  }>;
  appliedCoupon: {
    code: string;
    discountType: string | null;
    discountAmount: number;
    eligibleSubtotal: number | null;
  } | null;
  shipment: {
    courier: string | null;
    courierOrderId: string | null;
    status: string;
    lastError: string | null;
  } | null;
  allowedActions: AllowedAction[];
};

export async function getOrderDetail(orderId: string, permissions: readonly string[]): Promise<AdminOrderDetail> {
  const order = await ordersRepository.getOrderById(orderId);
  if (!order) throw new NotFoundError('Order not found.');

  return run(undefined, async (client) => {
    const customer = await client.query<{ id: string; account_type: 'GUEST' | 'REGISTERED'; email: string | null }>(
      `SELECT id, account_type, email FROM customers WHERE id = $1`,
      [order.customer_id],
    );
    const items = await client.query<{
      product_name: string;
      variant_description: string | null;
      unit_price: string;
      quantity: number;
      line_total: string;
    }>(
      `SELECT product_name, variant_description, unit_price, quantity, line_total
         FROM order_items WHERE order_id = $1 ORDER BY created_at, id`,
      [orderId],
    );
    const shipment = await shipmentsRepository.getShipmentByOrderId(orderId, { db: client });

    const c = customer.rows[0] ?? null;
    return {
      order,
      isGuestOrder: c?.account_type === 'GUEST',
      hasCodCollectionDiscrepancy: hasCodCollectionDiscrepancy(order),
      customer: c ? { id: c.id, accountType: c.account_type, email: c.email } : null,
      items: items.rows.map((r) => ({
        productName: r.product_name,
        variantDescription: r.variant_description,
        unitPrice: Number(r.unit_price),
        quantity: r.quantity,
        lineTotal: Number(r.line_total),
      })),
      // §8.23: the stored snapshot, never recalculated and never read from the live coupon row.
      appliedCoupon: order.coupon_code
        ? {
            code: order.coupon_code,
            discountType: order.discount_type,
            discountAmount: order.discount_amount ?? 0,
            eligibleSubtotal: order.eligible_subtotal,
          }
        : null,
      shipment: shipment
        ? {
            courier: shipment.courier,
            courierOrderId: shipment.courier_order_id,
            status: shipment.shipment_status,
            lastError: shipment.courier_error,
          }
        : null,
      allowedActions: computeAllowedActions(order, permissions),
    };
  });
}

export type PaymentPanel = {
  method: 'BKASH' | 'COD';
  status: string;
  amountDue: number;
  bkashTransactionId: string | null;
  /** Whether a screenshot was submitted; the image itself is only reachable via the signed-URL route. */
  hasProof: boolean;
  lastRejectedAt: string | null;
  /** Every payment-status change in order, oldest first — rejections keep their reason (§5.21.2). */
  events: Array<{
    previousStatus: string | null;
    newStatus: string;
    reason: string | null;
    actorUserId: string | null;
    actorType: string;
    at: string;
  }>;
};

export async function getPaymentPanel(orderId: string): Promise<PaymentPanel> {
  const order = await ordersRepository.getOrderById(orderId);
  if (!order) throw new NotFoundError('Order not found.');

  const history = await orderStatusHistoryRepository.listForOrder(orderId, { page: 1, pageSize: 200 });
  const events = history.items
    .filter((h) => h.status_field === 'payment_status')
    .map((h) => ({
      previousStatus: h.previous_status,
      newStatus: h.new_status,
      reason: h.reason,
      actorUserId: h.actor_user_id,
      actorType: h.actor_type as string,
      at: h.created_at.toISOString(),
    }))
    .reverse();

  return {
    method: order.payment_method,
    status: order.payment_status,
    amountDue: order.total_amount,
    bkashTransactionId: order.bkash_transaction_id,
    hasProof: await hasPaymentProof(orderId),
    lastRejectedAt: order.last_payment_rejected_at ? order.last_payment_rejected_at.toISOString() : null,
    events,
  };
}

async function requireOrder(orderId: string): Promise<Order> {
  const order = await ordersRepository.getOrderById(orderId);
  if (!order) throw new NotFoundError('Order not found.');
  return order;
}

function mismatch(expected: 'BKASH' | 'COD', action: string): ConflictError {
  return new ConflictError(
    `${action} applies to ${expected} orders only.`,
    undefined,
    'PAYMENT_METHOD_MISMATCH',
  );
}

/** §5.4: COD confirmation is the same CONFIRMED transition, gated on its own permission row. */
export async function confirmCodOrder(orderId: string, actor: orderStatusService.Actor, requestId?: string): Promise<void> {
  const order = await requireOrder(orderId);
  if (order.payment_method !== 'COD') throw mismatch('COD', 'COD confirmation');
  await orderStatusService.confirmOrder(orderId, actor, requestId);
}

/** bKash confirmation must not be usable on a COD order (their permission rows differ). */
export async function confirmBkashOrder(orderId: string, actor: orderStatusService.Actor, requestId?: string): Promise<void> {
  const order = await requireOrder(orderId);
  if (order.payment_method !== 'BKASH') throw mismatch('BKASH', 'Order confirmation with payment verification');
  await orderStatusService.confirmOrder(orderId, actor, requestId);
}

/** §5.21.3: only a delivered COD order with collection pending can be resolved. */
export async function resolveCodCollection(
  orderId: string,
  outcome: 'COLLECTED' | 'NOT_RECOVERABLE',
  reason: string | undefined,
  actor: paymentStatusService.Actor,
  requestId?: string,
): Promise<void> {
  const order = await requireOrder(orderId);
  if (order.payment_method !== 'COD') throw mismatch('COD', 'COD collection resolution');
  if (!hasCodCollectionDiscrepancy(order)) {
    throw new ConflictError(
      'Collection can only be resolved for a delivered COD order whose payment is pending collection.',
      undefined,
      'INVALID_TRANSITION',
    );
  }
  if (outcome === 'COLLECTED') {
    await paymentStatusService.collectPayment(orderId, actor, requestId);
  } else {
    await paymentStatusService.rejectPayment(orderId, actor, reason, requestId);
  }
}

/**
 * `PATCH /orders/:id` — deliberately narrow (§5.2, §8.23). Contact/address
 * fixes are only possible before a shipment exists; every change audits the
 * previous and new values of exactly the fields that changed.
 */
export async function updateOrder(
  orderId: string,
  input: UpdateOrderRequest,
  actor: { userId: string },
  requestId?: string,
): Promise<void> {
  await withTransaction(async (client) => {
    const order = await ordersRepository.getOrderById(orderId, { forUpdate: true, db: client });
    if (!order) throw new NotFoundError('Order not found.');

    const touchesContactOrAddress =
      input.contactName !== undefined ||
      input.contactPhone !== undefined ||
      input.detailedAddress !== undefined ||
      input.postalCode !== undefined ||
      // Already with the courier once a shipment exists, so a later edit would silently diverge from it.
      input.deliveryInstructions !== undefined;

    if (touchesContactOrAddress) {
      const shipment = await shipmentsRepository.getShipmentByOrderId(orderId, { db: client });
      if (shipment && shipment.shipment_status !== 'NOT_CREATED') {
        throw new ConflictError(
          'Contact, address and delivery instructions can no longer be edited once a shipment exists.',
          undefined,
          'ORDER_LOCKED_FOR_EDIT',
        );
      }
    }

    const changes: Array<{ column: string; field: string; value: unknown; previous: unknown }> = [];
    const add = (column: string, field: string, value: unknown, previous: unknown) => {
      if (value !== undefined && value !== previous) changes.push({ column, field, value, previous });
    };
    add('internal_note', 'internalNote', input.internalNote, order.internal_note);
    add('delivery_instructions', 'deliveryInstructions', input.deliveryInstructions, order.delivery_instructions);
    add('full_name', 'contactName', input.contactName, order.full_name);
    add(
      'phone_number',
      'contactPhone',
      input.contactPhone !== undefined ? normalizeBdPhone(input.contactPhone) : undefined,
      order.phone_number,
    );
    add('detailed_address', 'detailedAddress', input.detailedAddress, order.detailed_address);
    add('postal_code', 'postalCode', input.postalCode, order.postal_code);

    if (changes.length === 0) return;

    // Column names come from the fixed list above, never from the request.
    const sets = changes.map((c, i) => `${c.column} = $${i + 2}`).join(', ');
    await client.query(`UPDATE orders SET ${sets}, updated_at = now() WHERE id = $1`, [
      orderId,
      ...changes.map((c) => c.value),
    ]);

    await appendAudit(
      {
        entityType: 'order',
        entityId: orderId,
        action: 'order_info_updated',
        previousValue: Object.fromEntries(changes.map((c) => [c.field, c.previous])),
        newValue: Object.fromEntries(changes.map((c) => [c.field, c.value])),
        actorUserId: actor.userId,
        actorType: 'USER',
        requestId,
      },
      client,
    );
  });
}
