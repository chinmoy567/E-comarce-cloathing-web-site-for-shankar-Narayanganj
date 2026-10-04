import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { getSupabase } from '../../lib/supabase.js';
import { getEnv } from '../../config/env.js';
import { validateUpload } from '../../lib/uploadValidation.js';
import { normalizeBdPhone } from '../../lib/phone.js';
import { logger } from '../../lib/logger.js';
import { withTransaction } from '../../lib/transaction.js';
import {
  ConflictError,
  InternalError,
  NotFoundError,
  UpstreamError,
  ValidationError,
} from '../../lib/errors.js';
import {
  PAYMENT_PROOFS_BUCKET,
  PAYMENT_PROOF_MAX_BYTES,
  PAYMENT_PROOF_MAX_EDGE_PX,
} from '../../config/constants.js';
import * as ordersRepository from '../../repositories/orders.repository.js';
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

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

let bucketReady = false;

async function ensurePrivateBucket(): Promise<void> {
  if (bucketReady) return;
  const storage = getSupabase().storage;
  const existing = await storage.getBucket(PAYMENT_PROOFS_BUCKET);
  if (existing.error || !existing.data) {
    const created = await storage.createBucket(PAYMENT_PROOFS_BUCKET, { public: false });
    if (created.error && !/already exists/i.test(created.error.message)) {
      logger.error({ err: created.error.message }, 'payment-proofs bucket create failed');
      throw new UpstreamError('Failed to prepare payment proof storage.');
    }
  } else if (existing.data.public) {
    // A public payment-proofs bucket would expose customer payment evidence: refuse to use it.
    throw new InternalError('The payment proof bucket must be private.');
  }
  bucketReady = true;
}

async function reencode(file: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  try {
    const { data, info } = await sharp(file, { failOn: 'error' })
      .rotate() // apply the EXIF orientation first, then metadata is dropped (sharp strips by default)
      .resize({
        width: PAYMENT_PROOF_MAX_EDGE_PX,
        height: PAYMENT_PROOF_MAX_EDGE_PX,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch {
    throw new ValidationError('The image could not be read.', [{ field: 'file', message: 'invalid or corrupt image' }], 'INVALID_IMAGE');
  }
}

async function removeFromBucket(path: string): Promise<boolean> {
  const { error } = await getSupabase().storage.from(PAYMENT_PROOFS_BUCKET).remove([path]);
  if (error) {
    logger.error({ err: error.message }, 'payment proof bucket delete failed');
    return false;
  }
  return true;
}

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

  if (order.payment_method !== 'BKASH' || order.payment_status !== 'PENDING_VERIFICATION' || order.order_status === 'CANCELLED') {
    throw new ConflictError(
      'A payment screenshot can only be added to a bKash order that is awaiting verification.',
      undefined,
      'PAYMENT_PROOF_NOT_ACCEPTED',
    );
  }

  await validateUpload(input.file, { allowedMimeTypes: ALLOWED_MIME_TYPES, maxBytes: PAYMENT_PROOF_MAX_BYTES });
  const image = await reencode(input.file);

  await ensurePrivateBucket();
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
      const previous = await storageObjectsRepository.setOrderPaymentProof(order.id, stored.id, client);
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
    await removeFromBucket(objectPath);
    throw err;
  }

  if (previousObjectId) await retireObject(previousObjectId);
}

/** Best-effort removal of a replaced object; the registry is only marked deleted once the bucket delete succeeded. */
async function retireObject(objectId: string): Promise<void> {
  const old = await storageObjectsRepository.findById(objectId);
  if (!old || old.deletedAt) return;
  if (await removeFromBucket(old.objectPath)) await storageObjectsRepository.markDeleted(old.id);
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
  bucketReady = false;
}
