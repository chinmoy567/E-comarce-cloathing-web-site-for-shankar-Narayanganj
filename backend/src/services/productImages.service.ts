import { createHash, randomUUID } from 'node:crypto';
import { getSupabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';
import { withTransaction } from '../lib/transaction.js';
import { ConflictError, NotFoundError, UpstreamError, ValidationError } from '../lib/errors.js';
import { PRODUCT_IMAGES_BUCKET, PRODUCT_IMAGE_MAX_BYTES, PRODUCT_IMAGE_MAX_COUNT } from '../config/constants.js';
import * as productImagesRepository from '../repositories/productImages.repository.js';
import * as storageObjectsRepository from '../repositories/storageObjects.repository.js';
import { append as appendAudit } from '../repositories/audit.repository.js';
import type { Db } from '../repositories/db.js';
import { ensureBucket, removeObject, validateAndNormalizeImage } from './storage/imagePipeline.js';

/**
 * Product images (05-admin §5.1, spec 06). Uploads go through the backend only; the bytes are
 * content-sniffed and re-encoded by the shared pipeline, stored in the PUBLIC `product-images`
 * bucket under a server-generated path (the client filename is discarded), and registered in
 * `storage_objects`. `product_images.storage_path` carries the public URL the storefront renders.
 *
 * Order of effects: the bucket write happens first (it cannot join the database transaction), and
 * a failed row write deletes the new object again, so a failure leaves no orphan and never a row
 * pointing at a missing object. Deleting an image removes the object inside the transaction, so a
 * bucket failure rolls the delete back instead of claiming the image is gone while it is still served.
 */

export type Actor = { userId: string };

export type ProductImageResponse = {
  id: string;
  productId: string;
  /** The public URL (named for the column; every storefront reader treats it as the image URL). */
  storagePath: string;
  altText: string | null;
  displayOrder: number;
  isPrimary: boolean;
};

function toResponse(r: productImagesRepository.ProductImageRecord): ProductImageResponse {
  return {
    id: r.id,
    productId: r.productId,
    storagePath: r.storagePath,
    altText: r.altText,
    displayOrder: r.displayOrder,
    isPrimary: r.isPrimary,
  };
}

function limitReached(): ConflictError {
  return new ConflictError(
    `A product can have at most ${PRODUCT_IMAGE_MAX_COUNT} images.`,
    undefined,
    'IMAGE_LIMIT_REACHED',
  );
}

async function audit(
  client: Db,
  actor: Actor,
  action: string,
  productId: string,
  requestId: string | null | undefined,
  detail: Record<string, unknown>,
): Promise<void> {
  await appendAudit(
    {
      entityType: 'product',
      entityId: productId,
      action,
      newValue: detail,
      actorUserId: actor.userId,
      actorType: 'USER',
      requestId: requestId ?? null,
    },
    client,
  );
}

export async function listForProduct(productId: string, client?: Db): Promise<ProductImageResponse[]> {
  return (await productImagesRepository.listByProduct(productId, client)).map(toResponse);
}

export async function uploadProductImage(
  actor: Actor,
  productId: string,
  file: Buffer,
  altText: string | null,
  requestId?: string | null,
): Promise<ProductImageResponse> {
  // Cheap check first, so a full product never costs an image encode.
  const preliminary = await productImagesRepository.listByProduct(productId);
  if (preliminary.length >= PRODUCT_IMAGE_MAX_COUNT) throw limitReached();

  const image = await validateAndNormalizeImage(file, PRODUCT_IMAGE_MAX_BYTES);

  await ensureBucket(PRODUCT_IMAGES_BUCKET, true);
  const objectPath = `product/${productId}/${randomUUID()}.webp`;
  const bucket = getSupabase().storage.from(PRODUCT_IMAGES_BUCKET);
  const { error } = await bucket.upload(objectPath, image.data, {
    contentType: 'image/webp',
    cacheControl: '31536000', // immutable: a replacement gets a new UUID path
    upsert: false,
  });
  if (error) {
    logger.error({ err: error.message }, 'product image upload failed');
    throw new UpstreamError('Failed to store the image.');
  }
  const publicUrl = bucket.getPublicUrl(objectPath).data.publicUrl;

  try {
    return await withTransaction(async (client) => {
      // The lock serialises concurrent uploads, so the count below cannot be raced past the limit.
      if (!(await productImagesRepository.lockProduct(productId, client))) {
        throw new NotFoundError('Product not found.');
      }
      const existing = await productImagesRepository.listByProduct(productId, client);
      if (existing.length >= PRODUCT_IMAGE_MAX_COUNT) throw limitReached();

      const stored = await storageObjectsRepository.insert(
        {
          bucket: PRODUCT_IMAGES_BUCKET,
          objectPath,
          visibility: 'PUBLIC',
          mimeType: 'image/webp',
          byteSize: image.data.byteLength,
          width: image.width,
          height: image.height,
          checksumSha256: createHash('sha256').update(image.data).digest('hex'),
          uploadedBy: actor.userId,
          ownerEntityType: 'product',
          ownerEntityId: productId,
        },
        client,
      );
      const created = await productImagesRepository.insert(
        {
          productId,
          storagePath: publicUrl,
          storageObjectId: stored.id,
          altText,
          displayOrder: existing.length === 0 ? 0 : Math.max(...existing.map((e) => e.displayOrder)) + 1,
          isPrimary: existing.length === 0,
        },
        client,
      );
      await audit(client, actor, 'product_image_uploaded', productId, requestId, { imageId: created.id });
      return toResponse(created);
    });
  } catch (err) {
    await removeObject(PRODUCT_IMAGES_BUCKET, objectPath);
    throw err;
  }
}

export async function reorderProductImages(
  actor: Actor,
  productId: string,
  imageIds: string[],
  requestId?: string | null,
): Promise<ProductImageResponse[]> {
  return withTransaction(async (client) => {
    if (!(await productImagesRepository.lockProduct(productId, client))) {
      throw new NotFoundError('Product not found.');
    }
    const existing = await productImagesRepository.listByProduct(productId, client);
    const wanted = new Set(imageIds);
    const complete =
      imageIds.length === existing.length && wanted.size === imageIds.length && existing.every((e) => wanted.has(e.id));
    if (!complete) {
      throw new ValidationError('The list must contain every image of the product exactly once.', [
        { field: 'imageIds', message: "must match the product's images exactly" },
      ]);
    }
    await productImagesRepository.setOrder(productId, imageIds, client);
    await audit(client, actor, 'product_images_reordered', productId, requestId, { imageIds });
    return (await productImagesRepository.listByProduct(productId, client)).map(toResponse);
  });
}

export async function updateImageAltText(
  actor: Actor,
  imageId: string,
  altText: string | null,
  requestId?: string | null,
): Promise<ProductImageResponse> {
  return withTransaction(async (client) => {
    const existing = await productImagesRepository.findById(imageId, client);
    if (!existing) throw new NotFoundError('Image not found.');
    const updated = await productImagesRepository.updateAltText(imageId, altText, client);
    await audit(client, actor, 'product_image_updated', existing.productId, requestId, { imageId });
    return toResponse(updated!);
  });
}

export async function setPrimaryImage(
  actor: Actor,
  imageId: string,
  requestId?: string | null,
): Promise<ProductImageResponse[]> {
  return withTransaction(async (client) => {
    const image = await productImagesRepository.findById(imageId, client);
    if (!image) throw new NotFoundError('Image not found.');
    await productImagesRepository.lockProduct(image.productId, client);
    await productImagesRepository.setPrimary(image.productId, imageId, client);
    await audit(client, actor, 'product_image_primary_set', image.productId, requestId, { imageId });
    return (await productImagesRepository.listByProduct(image.productId, client)).map(toResponse);
  });
}

export async function deleteProductImage(
  actor: Actor,
  imageId: string,
  requestId?: string | null,
): Promise<ProductImageResponse[]> {
  return withTransaction(async (client) => {
    const image = await productImagesRepository.findById(imageId, client);
    if (!image) throw new NotFoundError('Image not found.');
    await productImagesRepository.lockProduct(image.productId, client);

    await productImagesRepository.remove(imageId, client);
    if (image.storageObjectId) {
      const stored = await storageObjectsRepository.findById(image.storageObjectId, client);
      if (stored && !stored.deletedAt) {
        // Inside the transaction: if the bucket refuses, this throws and the row delete rolls back.
        if (!(await removeObject(stored.bucket, stored.objectPath))) {
          throw new UpstreamError('Failed to delete the image from storage.');
        }
        await storageObjectsRepository.markDeleted(stored.id, client);
      }
    }

    // A product that still has images always has a primary: promote the first remaining one.
    const remaining = await productImagesRepository.listByProduct(image.productId, client);
    if (image.isPrimary && remaining.length > 0) {
      await productImagesRepository.setPrimary(image.productId, remaining[0]!.id, client);
    }
    await audit(client, actor, 'product_image_deleted', image.productId, requestId, { imageId });
    return (await productImagesRepository.listByProduct(image.productId, client)).map(toResponse);
  });
}

/** Read inside the product-delete transaction; the objects are removed after it commits. */
export async function collectObjectsForProduct(productId: string, client: Db) {
  return productImagesRepository.listObjectsForProduct(productId, client);
}

/** Best-effort cleanup once the product row is gone; a failure leaves a registry row for a later sweep, never a broken page. */
export async function retireObjects(
  objects: Array<{ objectId: string; bucket: string; objectPath: string }>,
): Promise<void> {
  for (const o of objects) {
    if (await removeObject(o.bucket, o.objectPath)) await storageObjectsRepository.markDeleted(o.objectId);
  }
}
