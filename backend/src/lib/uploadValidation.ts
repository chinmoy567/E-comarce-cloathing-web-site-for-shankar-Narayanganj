import { randomUUID } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import { ValidationError } from './errors.js';

/**
 * Content-sniffed upload validation (spec 04 §11.6, used by specs 06 and 11).
 *
 * Validates by actual content (magic bytes), never by the caller-declared
 * extension or `Content-Type` alone — those are attacker-controlled. SVG and
 * HTML are never permitted regardless of `opts.allowedMimeTypes`, since an
 * uploaded SVG/HTML is a stored-XSS vector (`security` skill §6). The
 * generated filename is a UUID; the caller's original filename is never used
 * as a storage path.
 */

/** Never allowed, even if a caller mistakenly lists one in `allowedMimeTypes`. */
const FORBIDDEN_MIME_TYPES = new Set(['image/svg+xml', 'text/html', 'application/xhtml+xml']);

export type ValidateUploadOptions = {
  allowedMimeTypes: string[];
  maxBytes: number;
};

export type ValidatedUpload = {
  mimeType: string;
  extension: string;
  /** Generated storage filename — the original filename is discarded. */
  storageFilename: string;
};

export async function validateUpload(file: Buffer, opts: ValidateUploadOptions): Promise<ValidatedUpload> {
  if (file.byteLength === 0) {
    throw new ValidationError('The uploaded file is empty.', [{ field: 'file', message: 'must not be empty' }]);
  }

  if (file.byteLength > opts.maxBytes) {
    throw new ValidationError('The uploaded file is too large.', [{ field: 'file', message: 'exceeds the maximum allowed size' }]);
  }

  const allowed = opts.allowedMimeTypes.filter((mime) => !FORBIDDEN_MIME_TYPES.has(mime));

  const detected = await fileTypeFromBuffer(file);
  if (!detected || FORBIDDEN_MIME_TYPES.has(detected.mime)) {
    throw new ValidationError('The file type could not be verified or is not allowed.', [
      { field: 'file', message: 'unsupported or unverifiable file type' },
    ]);
  }

  if (!allowed.includes(detected.mime)) {
    throw new ValidationError('The file type could not be verified or is not allowed.', [
      { field: 'file', message: 'unsupported or unverifiable file type' },
    ]);
  }

  return {
    mimeType: detected.mime,
    extension: detected.ext,
    storageFilename: `${randomUUID()}.${detected.ext}`,
  };
}
