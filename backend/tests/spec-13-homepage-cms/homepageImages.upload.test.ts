import { describe, expect, it } from 'vitest';
import { validateUpload } from '../../src/lib/uploadValidation.js';
import { HOMEPAGE_IMAGE_MAX_BYTES } from '../../src/config/constants.js';

/**
 * Spec 13 — homepage image upload validation (§13.11, plan §2). Exercises the
 * content-sniffing layer `homepageImages.service.ts` reuses verbatim from
 * spec 04 — the actual Supabase Storage `upload()` call is covered by an
 * end-to-end admin-route test only when live Supabase credentials are
 * present (see `homepageCms.permissions.test.ts` for the 403/401 surface,
 * which does not require a live bucket).
 */
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Minimal valid file signatures (magic bytes) `file-type` recognizes.
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const SVG_BUFFER = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const HTML_BUFFER = Buffer.from('<html><body><script>alert(1)</script></body></html>');

describe('homepage image upload validation (13-homepage-cms §13.11)', () => {
  it('rejects an SVG file regardless of an allowed extension list', async () => {
    await expect(
      validateUpload(SVG_BUFFER, { allowedMimeTypes: ALLOWED_MIME_TYPES, maxBytes: HOMEPAGE_IMAGE_MAX_BYTES }),
    ).rejects.toThrow();
  });

  it('rejects an HTML file', async () => {
    await expect(
      validateUpload(HTML_BUFFER, { allowedMimeTypes: ALLOWED_MIME_TYPES, maxBytes: HOMEPAGE_IMAGE_MAX_BYTES }),
    ).rejects.toThrow();
  });

  it('rejects a file exceeding HOMEPAGE_IMAGE_MAX_BYTES', async () => {
    const oversized = Buffer.concat([PNG_HEADER, Buffer.alloc(HOMEPAGE_IMAGE_MAX_BYTES)]);
    await expect(
      validateUpload(oversized, { allowedMimeTypes: ALLOWED_MIME_TYPES, maxBytes: HOMEPAGE_IMAGE_MAX_BYTES }),
    ).rejects.toThrow();
  });

  it('rejects an empty file', async () => {
    await expect(
      validateUpload(Buffer.alloc(0), { allowedMimeTypes: ALLOWED_MIME_TYPES, maxBytes: HOMEPAGE_IMAGE_MAX_BYTES }),
    ).rejects.toThrow();
  });

  it('an SVG renamed with a .png-style declared type is still rejected (content-sniffed, not extension-trusted)', async () => {
    // No declared-type parameter exists on validateUpload's contract at all —
    // this test documents that guarantee structurally: the SVG bytes above
    // are rejected purely on content, with no extension/MIME hint accepted.
    await expect(
      validateUpload(SVG_BUFFER, { allowedMimeTypes: [...ALLOWED_MIME_TYPES, 'image/svg+xml'], maxBytes: HOMEPAGE_IMAGE_MAX_BYTES }),
    ).rejects.toThrow();
  });
});
