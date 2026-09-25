import { getSupabase } from '../../lib/supabase.js';
import { validateUpload } from '../../lib/uploadValidation.js';
import { HOMEPAGE_IMAGES_BUCKET, HOMEPAGE_IMAGE_MAX_BYTES } from '../../config/constants.js';
import { InternalError } from '../../lib/errors.js';

/**
 * Minimal homepage/campaign image upload (13-homepage-cms §13.11, plan §2).
 * This is the minimal spec-06 slice this project needs right now: one public
 * bucket, one call site, content-sniffed via the existing `uploadValidation`
 * (spec 04) so an SVG/HTML masquerading as an image is rejected regardless of
 * its declared type. No re-encoding/thumbnailing — full spec 06's job later
 * (plan §10).
 */

export type HomepageImageKind = 'section-desktop' | 'section-mobile' | 'campaign-hero';

export type UploadHomepageImageInput = {
  file: Buffer;
  kind: HomepageImageKind;
};

export type UploadHomepageImageResult = {
  url: string;
  storagePath: string;
};

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export async function uploadHomepageImage(input: UploadHomepageImageInput): Promise<UploadHomepageImageResult> {
  const validated = await validateUpload(input.file, {
    allowedMimeTypes: ALLOWED_MIME_TYPES,
    maxBytes: HOMEPAGE_IMAGE_MAX_BYTES,
  });

  const storagePath = `${input.kind}/${validated.storageFilename}`;

  const { error } = await getSupabase()
    .storage.from(HOMEPAGE_IMAGES_BUCKET)
    .upload(storagePath, input.file, { contentType: validated.mimeType, upsert: false });

  if (error) {
    throw new InternalError('Failed to upload the image.');
  }

  const { data } = getSupabase().storage.from(HOMEPAGE_IMAGES_BUCKET).getPublicUrl(storagePath);

  return { url: data.publicUrl, storagePath };
}
