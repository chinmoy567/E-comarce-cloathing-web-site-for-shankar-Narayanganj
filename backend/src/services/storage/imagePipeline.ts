import sharp from 'sharp';
import { getSupabase } from '../../lib/supabase.js';
import { validateUpload } from '../../lib/uploadValidation.js';
import { logger } from '../../lib/logger.js';
import { InternalError, UpstreamError, ValidationError } from '../../lib/errors.js';
import { IMAGE_MAX_EDGE_PX } from '../../config/constants.js';

/**
 * The shared upload pipeline (spec 06): every image that reaches storage — product images and
 * bKash screenshots alike — is validated by actual content and re-encoded the same way, and every
 * bucket is verified to have the visibility the caller expects before anything is written to it.
 */

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export type NormalizedImage = { data: Buffer; width: number; height: number };

/**
 * Content-sniffs the bytes (SVG/HTML/scripts are never allowed, whatever the file is called), then
 * re-encodes to WebP with every piece of metadata dropped and the longest edge bounded — which
 * also neutralises polyglot files and EXIF location data (11-security-hardening §11.6).
 */
export async function validateAndNormalizeImage(file: Buffer, maxBytes: number): Promise<NormalizedImage> {
  await validateUpload(file, { allowedMimeTypes: ALLOWED_MIME_TYPES, maxBytes });
  try {
    const { data, info } = await sharp(file, { failOn: 'error' })
      .rotate() // apply the EXIF orientation first; metadata is then dropped (sharp strips by default)
      .resize({ width: IMAGE_MAX_EDGE_PX, height: IMAGE_MAX_EDGE_PX, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch {
    throw new ValidationError('The image could not be read.', [{ field: 'file', message: 'invalid or corrupt image' }], 'INVALID_IMAGE');
  }
}

const readyBuckets = new Set<string>();

/**
 * Creates the bucket with the wanted visibility if it does not exist, and refuses to use one whose
 * visibility differs: a public `payment-proofs` bucket would expose payment evidence, a private
 * `product-images` bucket would break the storefront.
 */
export async function ensureBucket(name: string, wantPublic: boolean): Promise<void> {
  if (readyBuckets.has(name)) return;
  const storage = getSupabase().storage;
  const existing = await storage.getBucket(name);
  if (existing.error || !existing.data) {
    const created = await storage.createBucket(name, { public: wantPublic });
    if (created.error && !/already exists/i.test(created.error.message)) {
      logger.error({ err: created.error.message, bucket: name }, 'bucket create failed');
      throw new UpstreamError('Failed to prepare image storage.');
    }
  } else if (Boolean(existing.data.public) !== wantPublic) {
    throw new InternalError(`The ${name} bucket must be ${wantPublic ? 'public' : 'private'}.`);
  }
  readyBuckets.add(name);
}

/** Removes one object; false (never a throw) when the bucket refuses, so callers decide what that means. */
export async function removeObject(bucket: string, path: string): Promise<boolean> {
  const { error } = await getSupabase().storage.from(bucket).remove([path]);
  if (error) {
    logger.error({ err: error.message, bucket }, 'bucket object delete failed');
    return false;
  }
  return true;
}

/** Test seam. */
export function resetBucketCache(): void {
  readyBuckets.clear();
}
