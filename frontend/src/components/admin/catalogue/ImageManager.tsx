'use client';

import { useState } from 'react';
import { apiDelete, apiPatch, apiPost, ApiClientError } from '@/lib/apiClient';
import { useAdminSession } from '@/lib/admin/session';
import { validateImageFile } from '@/lib/imageUpload';
import { moveImage, uploadProductImage } from '@/lib/admin/productImages';
import { Button } from '@/components/admin/Button';
import { FormField } from '@/components/admin/FormField';
import type { ProductImageResponse } from '@/lib/admin/types';

/**
 * Product images (spec 06, 05-admin §5.1): upload, order, primary, alt text and delete. Every action
 * is its own request and the product is reloaded afterwards, so what is shown is always what the
 * server holds — there is no optimistic insert. Order is changed with Move Up/Down (an accepted
 * equivalent to drag-and-drop, 44px targets). Everything is hidden without `product.image.manage`;
 * the backend is the real gate.
 */

const MAX_IMAGES = 10;

function errorMessage(err: unknown): string {
  return err instanceof ApiClientError || err instanceof Error ? err.message : 'Something went wrong. Please try again.';
}

function ImageCard({
  image,
  index,
  total,
  canManage,
  onMove,
  onChanged,
}: {
  image: ProductImageResponse;
  index: number;
  total: number;
  canManage: boolean;
  onMove: (delta: -1 | 1) => void;
  onChanged: () => void;
}) {
  const [alt, setAlt] = useState(image.altText ?? '');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setStatus(null);
    try {
      await action();
      setStatus({ kind: 'ok', text: success });
      onChanged();
    } catch (err) {
      setStatus({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-lg border border-border p-md">
      <div className="flex gap-md">
        {/* eslint-disable-next-line @next/next/no-img-element -- admin thumbnail of an already-optimised WebP */}
        <img
          src={image.storagePath}
          alt={image.altText ?? ''}
          width={96}
          height={96}
          className="h-24 w-24 shrink-0 rounded-lg border border-border object-cover"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text-primary">
            Image {index + 1}
            {image.isPrimary && (
              <span className="ml-sm rounded-lg bg-accent/10 px-sm py-xs text-xs font-semibold text-accent">Primary</span>
            )}
          </p>
          {canManage && (
            <div className="mt-sm flex flex-wrap gap-sm">
              <button
                type="button"
                aria-label={`Move image ${index + 1} up`}
                onClick={() => onMove(-1)}
                disabled={busy || index === 0}
                className="h-11 w-11 rounded-lg border border-border text-sm font-semibold disabled:opacity-40"
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`Move image ${index + 1} down`}
                onClick={() => onMove(1)}
                disabled={busy || index === total - 1}
                className="h-11 w-11 rounded-lg border border-border text-sm font-semibold disabled:opacity-40"
              >
                ↓
              </button>
              {!image.isPrimary && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void run(() => apiPost(`/api/admin/catalogue/images/${image.id}/primary`), 'Set as primary.')}
                >
                  Set as primary
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {canManage && (
        <div className="mt-md">
          <FormField
            label="Alt text (describe the image)"
            id={`image-alt-${image.id}`}
            type="text"
            maxLength={300}
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            disabled={busy}
          />
          <div className="flex flex-wrap items-center gap-sm">
            <Button
              type="button"
              variant="secondary"
              disabled={busy || alt.trim() === (image.altText ?? '')}
              onClick={() =>
                void run(
                  () => apiPatch(`/api/admin/catalogue/images/${image.id}`, { altText: alt.trim() || null }),
                  'Alt text saved.',
                )
              }
            >
              Save alt text
            </Button>
            {confirmDelete ? (
              <>
                <span className="text-xs text-text-secondary">Delete this image?</span>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => void run(() => apiDelete(`/api/admin/catalogue/images/${image.id}`), 'Image deleted.')}
                >
                  Yes, delete
                </Button>
                <Button type="button" variant="secondary" disabled={busy} onClick={() => setConfirmDelete(false)}>
                  Keep
                </Button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={busy}
                className="h-11 px-sm text-xs font-semibold text-error"
              >
                Delete image
              </button>
            )}
          </div>
        </div>
      )}

      {status && (
        <p
          role={status.kind === 'error' ? 'alert' : 'status'}
          className={`mt-sm text-xs ${status.kind === 'error' ? 'text-error' : 'text-success'}`}
        >
          {status.text}
        </p>
      )}
    </li>
  );
}

export function ImageManager({
  productId,
  images,
  onChanged,
}: {
  productId: string;
  images: ProductImageResponse[];
  /** Called after any successful change so the page can reload the product. */
  onChanged: () => void;
}) {
  const { hasPermission } = useAdminSession();
  const canManage = hasPermission('product.image.manage');

  const [altText, setAltText] = useState('');
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const ordered = [...images].sort((a, b) => a.displayOrder - b.displayOrder);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;

    const problem = validateImageFile(file);
    if (problem) {
      setPhase('error');
      setMessage(problem);
      input.value = '';
      return;
    }

    setPhase('uploading');
    setMessage('');
    try {
      await uploadProductImage(productId, file, altText);
      setAltText('');
      setPhase('idle');
      onChanged();
    } catch (err) {
      setPhase('error');
      setMessage(errorMessage(err));
    } finally {
      input.value = '';
    }
  }

  async function handleMove(id: string, delta: -1 | 1) {
    const next = moveImage(
      ordered.map((i) => i.id),
      id,
      delta,
    );
    if (!next) return;
    setMessage('');
    try {
      await apiPatch(`/api/admin/catalogue/products/${productId}/images/order`, { imageIds: next });
      onChanged();
    } catch (err) {
      setPhase('error');
      setMessage(errorMessage(err));
    }
  }

  return (
    <section className="mb-2xl rounded-lg border border-border bg-surface p-lg" aria-labelledby="images-heading">
      <h2 id="images-heading" className="text-base font-bold text-text-primary">
        Images
      </h2>
      <p className="mb-md mt-xs text-xs text-text-secondary">
        {images.length} of {MAX_IMAGES}. The primary image is the one shown on product cards. JPG, PNG or WebP, up to 5 MB.
        Give each image alt text that describes it.
      </p>

      {ordered.length > 0 && (
        <ul className="mb-lg space-y-md">
          {ordered.map((image, index) => (
            <ImageCard
              key={image.id}
              image={image}
              index={index}
              total={ordered.length}
              canManage={canManage}
              onMove={(delta) => void handleMove(image.id, delta)}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}

      {canManage && images.length < MAX_IMAGES && (
        <div>
          <FormField
            label="Alt text for the next upload (describe the image)"
            id="new-image-alt"
            type="text"
            maxLength={300}
            value={altText}
            onChange={(e) => setAltText(e.target.value)}
            disabled={phase === 'uploading'}
          />
          <label
            htmlFor="product-image-file"
            className="flex h-[60px] w-full cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-border bg-background text-sm font-semibold text-primary"
          >
            {phase === 'uploading' ? 'Uploading…' : 'Tap to upload or take photo'}
          </label>
          <input
            id="product-image-file"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(e) => void handleFileChange(e)}
            disabled={phase === 'uploading'}
          />
        </div>
      )}
      {canManage && images.length >= MAX_IMAGES && (
        <p className="text-xs text-text-secondary">The image limit is reached. Delete one to add another.</p>
      )}
      {!canManage && images.length === 0 && (
        <p className="text-xs text-text-secondary">No images yet. You do not have permission to add them.</p>
      )}

      {phase === 'error' && message && (
        <p role="alert" className="mt-sm text-xs text-error">
          {message}
        </p>
      )}
    </section>
  );
}
