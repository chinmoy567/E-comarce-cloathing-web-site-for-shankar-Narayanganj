import { ConflictError, NotFoundError } from '../lib/errors.js';
import { normalizeBdPhone } from '../lib/phone.js';
import { withTransaction } from '../lib/transaction.js';
import * as ordersRepository from '../repositories/orders.repository.js';
import { PaymentTransitionError, resubmitPaymentInTransaction } from './paymentStatus.service.js';

/**
 * Customer resubmission after a rejected bKash payment (03-payment-order §3.4, 07-order-state-machine
 * §5.21.2: REJECTED → PENDING_VERIFICATION). The customer sends a new Transaction ID; a new
 * screenshot is a separate upload (and, on a rejected order, resubmits by itself — see
 * `storage/paymentProofs.service.ts`).
 *
 * Ownership is the order number AND the order's phone number, matched in one query, so a wrong pair
 * and an unknown order are indistinguishable (§2.9.7).
 */
export type CustomerResubmitInput = {
  orderNumber: string;
  phoneNumber: string;
  bkashTransactionId: string;
  actorUserId?: string | null;
  requestId?: string | null;
};

function notAccepted(): ConflictError {
  return new ConflictError(
    'Payment can only be resubmitted for a bKash order whose payment was rejected.',
    undefined,
    'PAYMENT_RESUBMISSION_NOT_ACCEPTED',
  );
}

export async function resubmitPaymentByCustomer(input: CustomerResubmitInput): Promise<void> {
  let phone: string;
  try {
    phone = normalizeBdPhone(input.phoneNumber);
  } catch {
    phone = '';
  }
  const order = await ordersRepository.findByOrderNumberAndPhone(input.orderNumber.trim().toUpperCase(), phone);
  if (!order) throw new NotFoundError('Order not found.');

  if (order.payment_method !== 'BKASH' || order.payment_status !== 'REJECTED' || order.order_status === 'CANCELLED') {
    throw notAccepted();
  }

  try {
    await withTransaction((client) =>
      resubmitPaymentInTransaction(
        client,
        order.id,
        { userId: input.actorUserId ?? undefined, type: input.actorUserId ? 'USER' : 'SYSTEM' },
        { newBkashTransactionId: input.bkashTransactionId, requestId: input.requestId ?? null },
      ),
    );
  } catch (err) {
    // Lost a race with another resubmission or an admin action: the state is no longer REJECTED.
    if (err instanceof PaymentTransitionError) throw notAccepted();
    throw err;
  }
}
