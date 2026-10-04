/**
 * Client-side pre-check shared by every image upload (payment screenshots, product images).
 * UX only — it gives fast feedback; the backend re-validates the actual content and is the
 * authority (frontend skill §2).
 */

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Returns a message when the file should not be sent, or null when it looks acceptable. */
export function validateImageFile(file: { type: string; size: number }): string | null {
  if (file.size === 0) return 'The selected file is empty.';
  if (!(IMAGE_ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
    return 'Please choose a JPG, PNG or WebP image.';
  }
  if (file.size > IMAGE_MAX_BYTES) return 'The image is larger than 5 MB. Please choose a smaller one.';
  return null;
}
