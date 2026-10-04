import { ApiClientError } from '@/lib/apiClient';
import type { ProductImageResponse } from '@/lib/admin/types';

/**
 * Product image upload (spec 06): the request body is the raw image, alt text rides in the query,
 * and the admin CSRF token is echoed as a header (double-submit, spec 03). Moves, primary, alt text
 * and delete are ordinary JSON calls made with the shared API client.
 */
export async function uploadProductImage(productId: string, file: File, altText: string): Promise<ProductImageResponse> {
  const base = (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');
  const csrfMatch = document.cookie.match(/(?:^|; )admin_csrf=([^;]*)/);
  const csrfToken = csrfMatch ? decodeURIComponent(csrfMatch[1]!) : '';
  const query = altText.trim() ? `?altText=${encodeURIComponent(altText.trim())}` : '';

  let res: Response;
  try {
    res = await fetch(`${base}/api/admin/catalogue/products/${productId}/images${query}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': file.type, 'X-CSRF-Token': csrfToken },
      body: await file.arrayBuffer(),
    });
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }

  let payload: { data?: ProductImageResponse; error?: { message?: string; code?: string } } | undefined;
  try {
    payload = (await res.json()) as typeof payload;
  } catch {
    payload = undefined;
  }
  if (!res.ok || !payload?.data) {
    if (res.status === 413) throw new Error('The image is larger than 5 MB. Please choose a smaller one.');
    throw new ApiClientError({
      code: payload?.error?.code ?? 'UPLOAD_FAILED',
      message: payload?.error?.message ?? 'Could not upload the image. Please try again.',
      status: res.status,
    });
  }
  return payload.data;
}

/** The new full order after moving one image by `delta` places, or null when it cannot move. */
export function moveImage(ids: string[], id: string, delta: -1 | 1): string[] | null {
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= ids.length) return null;
  const next = [...ids];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}
