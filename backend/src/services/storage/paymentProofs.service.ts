import { createHash, randomUUID } from 'node:crypto';
import { getSupabase } from '../../lib/supabase.js';
import { getEnv } from '../../config/env.js';
import { normalizeBdPhone } from '../../lib/phone.js';
import { logger } from '../../lib/logger.js';
import { withTransaction } from '../../lib/transaction.js';
import { ConflictError, NotFoundError, UpstreamError } from '../../lib/errors.js';
import { PAYMENT_PROOFS_BUCKET, PAYMENT_PROOF_MAX_BYTES } from '../../config/constants.js';
import { ensureBucket, removeObject, resetBucketCache, validateAndNormalizeImage } from './imagePipeline.js';
import * as ordersRepository from '../../repositories/orders.repository.js';
import { resubmitPaymentInTransaction } from '../paymentStatus.service.js';
import * as storageObjectsRepository from '../../repositories/storageObjects.repository.js';
import { append as appendAudit } from '../../repositories/audit.repository.js';

/**
 * bKash payment screenshots (03-payment-order §3.1, 05-admin §5.3, spec 06 private slice).
 *
 * - Upload goes through the backend only (§1.1); the browser never talks to Supabase.
 * - Validated by content (`validateUpload`), then re-encoded to WebP with all metadata stripped
 *   and the longest edge bounded (§11.6) — this also neutralises polyglot files and EXIF GPS.
 * - Stored in the PRIVATE bucket under a server-generated path; the client filename is discarded.
 * - Read only through a short-lived signed URL minted for an admin holding `payment.view`
 *   (§2.9.6/§4.16: payment proof never reaches a customer-facing response).
 */

export type SubmitPaymentProofInput = {
  orderNumber: string;
  phoneNumber: string;
  file: Buffer;
  actorUserId?: string | null;
  requestId?: string | null;
};

/**
 * Attach (or replace) the payment screenshot of a bKash order that is awaiting verification.
 * The caller proves ownership with the order number AND the order's phone number, checked in one
 * query; a wrong pair and an unknown order are indistinguishable (§2.9.7).
 */
export async function submitPaymentProof(input: SubmitPaymentProofInput): Promise<void> {
  let phone: string;
  try {
    phone = normalizeBdPhone(input.phoneNumber);
  } catch {
    phone = '';
  }
  const order = await ordersRepository.findByOrderNumberAndPhone(input.orderNumber.trim().toUpperCase(), phone);
  if (!order) throw new NotFoundError('Order not found.');

  // Awaiting verification, or rejected — a screenshot on a rejected order is the customer's resubmission.
  const acceptsProof = order.payment_status === 'PENDING_VERIFICATION' || order.payment_status === 'REJECTED';
  if (order.payment_method !== 'BKASH' || !acceptsProof || order.order_status === 'CANCELLED') {
    throw new ConflictError(
      'A payment screenshot can only be added to a bKash order that is awaiting verification or was rejected.',
      undefined,
      'PAYMENT_PROOF_NOT_ACCEPTED',
    );
  }

  const image = await validateAndNormalizeImage(input.file, PAYMENT_PROOF_MAX_BYTES);

  await ensureBucket(PAYMENT_PROOFS_BUCKET, false);
  const objectPath = `payment/${order.id}/${randomUUID()}.webp`;
  const bucket = getSupabase().storage.from(PAYMENT_PROOFS_BUCKET);
  const { error } = await bucket.upload(objectPath, image.data, {
    contentType: 'image/webp',
    cacheControl: '3600',
    upsert: false,
  });
  if (error) {
    logger.error({ err: error.message }, 'payment proof upload failed');
    throw new UpstreamError('Failed to store the payment screenshot.');
  }

  let previousObjectId: string | null;
  try {
    previousObjectId = await withTransaction(async (client) => {
      const stored = await storageObjectsRepository.insert(
        {
          bucket: PAYMENT_PROOFS_BUCKET,
          objectPath,
          visibility: 'PRIVATE',
          mimeType: 'image/webp',
          byteSize: image.data.byteLength,
          width: image.width,
          height: image.height,
          checksumSha256: createHash('sha256').update(image.data).digest('hex'),
          uploadedBy: input.actorUserId ?? null,
          ownerEntityType: 'payment',
          ownerEntityId: order.id,
        },
        client,
      );
      // Re-read under lock: the status may have moved since the unlocked read above.
      const locked = await ordersRepository.getOrderById(order.id, { forUpdate: true, db: client });
      if (!locked || (locked.payment_status !== 'PENDING_VERIFICATION' && locked.payment_status !== 'REJECTED')) {
        throw new ConflictError(
          'A payment screenshot can only be added to a bKash order that is awaiting verification or was rejected.',
          undefined,
          'PAYMENT_PROOF_NOT_ACCEPTED',
        );
      }
      const previous = await storageObjectsRepository.setOrderPaymentProof(order.id, stored.id, client);
      if (locked.payment_status === 'REJECTED') {
        await resubmitPaymentInTransaction(
          client,
          order.id,
          { userId: input.actorUserId ?? undefined, type: input.actorUserId ? 'USER' : 'SYSTEM' },
          { requestId: input.requestId ?? null },
        );
      }
      await appendAudit(
        {
          entityType: 'order',
          entityId: order.id,
          action: 'payment_proof_submitted',
          newValue: { objectId: stored.id, replaced: previous !== null },
          actorUserId: input.actorUserId ?? null,
          actorType: input.actorUserId ? 'USER' : 'SYSTEM',
          requestId: input.requestId ?? null,
        },
        client,
      );
      return previous;
    });
  } catch (err) {
    // Compensating delete: a failed row write must not leave an orphaned private object.
    await removeObject(PAYMENT_PROOFS_BUCKET, objectPath);
    throw err;
  }

  if (previousObjectId) await retireObject(previousObjectId);
}

/** Best-effort removal of a replaced object; the registry is only marked deleted once the bucket delete succeeded. */
async function retireObject(objectId: string): Promise<void> {
  const old = await storageObjectsRepository.findById(objectId);
  if (!old || old.deletedAt) return;
  if (await removeObject(PAYMENT_PROOFS_BUCKET, old.objectPath)) await storageObjectsRepository.markDeleted(old.id);
}

export type PaymentProofUrl = { url: string; expiresAt: string };

/** Admin read: a short-lived signed URL for the order's screenshot. The route enforces `payment.view`. */
export async function getPaymentProofUrl(orderId: string): Promise<PaymentProofUrl> {
  const proof = await storageObjectsRepository.findPaymentProofForOrder(orderId);
  if (!proof || proof.visibility !== 'PRIVATE' || proof.bucket !== PAYMENT_PROOFS_BUCKET) {
    throw new NotFoundError('No payment screenshot was submitted for this order.');
  }
  const ttl = getEnv().PAYMENT_PROOF_URL_TTL_SEC;
  const { data, error } = await getSupabase().storage.from(PAYMENT_PROOFS_BUCKET).createSignedUrl(proof.objectPath, ttl);
  if (error || !data?.signedUrl) {
    logger.error({ err: error?.message }, 'payment proof signed url failed');
    throw new UpstreamError('Failed to open the payment screenshot.');
  }
  return { url: data.signedUrl, expiresAt: new Date(Date.now() + ttl * 1000).toISOString() };
}

export async function hasPaymentProof(orderId: string): Promise<boolean> {
  return (await storageObjectsRepository.findPaymentProofForOrder(orderId)) !== null;
}

/** Test seam. */
export function resetPaymentProofBucketCache(): void {
  resetBucketCache();
}
