/**
 * bKash payment screenshot upload (03-payment-order §3.1). The file check here is UX only — it
 * gives fast feedback; the backend re-validates the actual content and is the authority
 * (frontend skill §2).
 */

import { apiPost } from './apiClient';
import { validateImageFile } from './imageUpload';

export { IMAGE_MAX_BYTES as PROOF_MAX_BYTES } from './imageUpload';
export { validateImageFile as validateProofFile } from './imageUpload';

/**
 * Sends the raw image bytes; the order number is in the path and the phone number that proves
 * ownership travels in a header, so it never appears in a URL.
 */
export async function uploadPaymentProof(orderNumber: string, phoneNumber: string, file: File): Promise<void> {
  const base = (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');
  let res: Response;
  try {
    res = await fetch(`${base}/api/orders/${encodeURIComponent(orderNumber)}/payment-proof`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': file.type, 'X-Order-Phone': phoneNumber },
      body: await file.arrayBuffer(),
    });
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }
  if (res.ok) return;

  let message = 'Could not upload the screenshot. Please try again.';
  if (res.status === 429) message = 'Too many attempts. Please wait a few minutes and try again.';
  else if (res.status === 413) message = 'The image is larger than 5 MB. Please choose a smaller one.';
  else {
    try {
      const payload = (await res.json()) as { error?: { message?: string } };
      if (payload.error?.message) message = payload.error.message;
    } catch {
      /* keep the generic message */
    }
  }
  throw new Error(message);
}

/** bKash Transaction IDs are short alphanumeric references; the backend enforces 5-50 characters and uniqueness. */
export const TRANSACTION_ID_MIN = 5;
export const TRANSACTION_ID_MAX = 50;

/**
 * UX pre-check for the resubmission form. After a rejection (`REJECTED`) the customer must send a
 * new Transaction ID and/or a screenshot; while a payment is merely awaiting verification only a
 * screenshot can be added. The backend is the authority on both.
 */
export function validateResubmission(input: {
  paymentStatus: string;
  transactionId: string;
  file: { type: string; size: number } | null;
}): string | null {
  const txn = input.transactionId.trim();
  if (input.paymentStatus !== 'REJECTED' && txn) return 'A Transaction ID can only be sent after a payment is rejected.';
  if (!txn && !input.file) {
    return input.paymentStatus === 'REJECTED'
      ? 'Enter a new bKash Transaction ID and/or choose a screenshot.'
      : 'Choose a screenshot to upload.';
  }
  if (txn && (txn.length < TRANSACTION_ID_MIN || txn.length > TRANSACTION_ID_MAX)) {
    return `The Transaction ID must be ${TRANSACTION_ID_MIN} to ${TRANSACTION_ID_MAX} characters.`;
  }
  if (input.file) return validateImageFile(input.file);
  return null;
}

/** Sends a new Transaction ID for a rejected bKash payment; the phone number proves ownership. */
export async function resubmitTransactionId(orderNumber: string, phoneNumber: string, transactionId: string): Promise<void> {
  await apiPost(`/api/orders/${encodeURIComponent(orderNumber)}/payment-resubmission`, {
    phoneNumber,
    bkashTransactionId: transactionId.trim(),
  });
}
