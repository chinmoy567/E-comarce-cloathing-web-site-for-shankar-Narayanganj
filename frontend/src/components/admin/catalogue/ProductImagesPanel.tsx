'use client';

import { useRef, useState } from 'react';
import { apiDelete, apiPatch, apiPost, apiUploadFile, ApiClientError } from '@/lib/apiClient';
import { useAdminSession } from '@/lib/admin/session';
import type { ProductImageResponse } from '@/lib/admin/types';

/** Mirrors backend `PRODUCT_IMAGE_MAX_BYTES` / `PRODUCT_IMAGE_MAX_COUNT`; the backend stays the authority. */
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_COUNT = 10;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

type Props = {
  productId: string;
  images: ProductImageResponse[];
  /** Called after any successful change so the page reloads the product from the server. */
  onChanged: () => void;
};

function errorText(err: unknown): string {
  return err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.';
}

/** Product images (spec 05 / 22): upload, set primary, reorder, edit alt text, delete. Gated on `product.image.manage`. */
export function ProductImagesPanel({ productId, images, onChanged }: Props) {
  const { hasPermission } = useAdminSession();
  const canManage = hasPermission('product.image.manage');

  const fileInput = useRef<HTMLInputElement>(null);
  const [altText, setAltText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [altDrafts, setAltDrafts] = useState<Record<string, string>>({});

  const base = '/api/admin/catalogue';
  const sorted = [...images].sort((a, b) => a.displayOrder - b.displayOrder);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const chosen = Array.from(files);
    if (images.length + chosen.length > MAX_COUNT) {
      setError(`A product can have at most ${MAX_COUNT} images.`);
      return;
    }
    for (const file of chosen) {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        setError(`${file.name}: only JPEG, PNG or WebP images are allowed.`);
        return;
      }
      if (file.size > MAX_BYTES) {
        setError(`${file.name}: must be 5 MB or smaller.`);
        return;
      }
    }
    await run(async () => {
      const query = altText.trim() ? `?altText=${encodeURIComponent(altText.trim())}` : '';
      // One at a time so display order follows the pick order and a failure names its file.
      for (const file of chosen) {
        try {
          await apiUploadFile(`${base}/products/${productId}/images${query}`, file);
        } catch (err) {
          throw new ApiClientError({
            code: err instanceof ApiClientError ? err.code : 'UPLOAD_FAILED',
            message: `${file.name}: ${errorText(err)}`,
            status: err instanceof ApiClientError ? err.status : 0,
          });
        }
      }
      setAltText('');
    });
    if (fileInput.current) fileInput.current.value = '';
  }

  function move(index: number, delta: -1 | 1) {
    const ids = sorted.map((i) => i.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    void run(() => apiPatch(`${base}/products/${productId}/images/order`, { imageIds: ids }));
  }

  const btn = 'h-9 rounded-lg border border-border px-sm text-xs font-semibold disabled:opacity-50';

  return (
    <section className="mb-2xl rounded-lg border border-border bg-surface p-lg" aria-labelledby="product-images-heading">
      <h2 id="product-images-heading" className="text-lg font-bold">
        Images
      </h2>
      <p className="mt-xs text-sm text-text-secondary">
        {sorted.length} of {MAX_COUNT} · JPEG, PNG or WebP, up to 5 MB each. The primary image is shown first in the store.
      </p>

      {error && (
        <div role="alert" className="mt-md rounded-lg border border-error/30 bg-error/5 p-md">
          <p className="text-sm text-error">{error}</p>
        </div>
      )}

      {sorted.length === 0 && <p className="mt-md text-sm text-text-secondary">No images yet.</p>}

      <ul className="mt-md grid grid-cols-1 gap-md sm:grid-cols-2">
        {sorted.map((image, index) => {
          const draft = altDrafts[image.id] ?? image.altText ?? '';
          return (
            <li key={image.id} className="rounded-lg border border-border p-sm">
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.storagePath}
                  alt={image.altText ?? ''}
                  className="aspect-square w-full rounded-lg object-cover"
                />
                {image.isPrimary && (
                  <span className="absolute left-xs top-xs rounded-lg bg-accent px-sm py-xs text-xs font-semibold text-white">
                    Primary
                  </span>
                )}
              </div>

              {canManage && (
                <>
                  <label className="mt-sm block text-xs font-medium text-text-secondary" htmlFor={`alt-${image.id}`}>
                    Alt text
                  </label>
                  <div className="mt-xs flex gap-xs">
                    <input
                      id={`alt-${image.id}`}
                      value={draft}
                      maxLength={300}
                      onChange={(e) => setAltDrafts((d) => ({ ...d, [image.id]: e.target.value }))}
                      className="h-9 min-w-0 flex-1 rounded-lg border border-border px-sm text-sm"
                    />
                    <button
                      type="button"
                      className={btn}
                      disabled={busy || draft.trim() === (image.altText ?? '')}
                      onClick={() => run(() => apiPatch(`${base}/images/${image.id}`, { altText: draft.trim() || null }))}
                    >
                      Save
                    </button>
                  </div>

                  <div className="mt-sm flex flex-wrap gap-xs">
                    <button type="button" className={btn} disabled={busy || index === 0} onClick={() => move(index, -1)} aria-label="Move earlier">
                      ←
                    </button>
                    <button
                      type="button"
                      className={btn}
                      disabled={busy || index === sorted.length - 1}
                      onClick={() => move(index, 1)}
                      aria-label="Move later"
                    >
                      →
                    </button>
                    {!image.isPrimary && (
                      <button
                        type="button"
                        className={btn}
                        disabled={busy}
                        onClick={() => run(() => apiPost(`${base}/images/${image.id}/primary`))}
                      >
                        Set primary
                      </button>
                    )}
                    {confirmDeleteId === image.id ? (
                      <>
                        <button
                          type="button"
                          className={`${btn} border-error text-error`}
                          disabled={busy}
                          onClick={() => {
                            setConfirmDeleteId(null);
                            void run(() => apiDelete(`${base}/images/${image.id}`));
                          }}
                        >
                          Confirm delete
                        </button>
                        <button type="button" className={btn} onClick={() => setConfirmDeleteId(null)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button type="button" className={`${btn} text-error`} disabled={busy} onClick={() => setConfirmDeleteId(image.id)}>
                        Delete
                      </button>
                    )}
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>

      {canManage ? (
        <div className="mt-lg border-t border-border pt-lg">
          <label className="block text-sm font-medium" htmlFor="new-image-alt">
            Alt text for new images (optional)
          </label>
          <input
            id="new-image-alt"
            value={altText}
            maxLength={300}
            onChange={(e) => setAltText(e.target.value)}
            className="mt-xs h-11 w-full rounded-lg border border-border px-md text-sm"
          />
          <label className="mt-md block text-sm font-medium" htmlFor="new-image-file">
            Add images
          </label>
          <input
            id="new-image-file"
            ref={fileInput}
            type="file"
            multiple
            accept={ACCEPTED_TYPES.join(',')}
            disabled={busy || sorted.length >= MAX_COUNT}
            onChange={(e) => void handleFiles(e.target.files)}
            className="mt-xs block w-full text-sm"
          />
          {busy && <p className="mt-sm text-sm text-text-secondary">Working…</p>}
        </div>
      ) : (
        <p className="mt-md text-sm text-text-secondary">You do not have permission to manage product images.</p>
      )}
    </section>
  );
}
