import { describe, expect, it } from 'vitest';
import { validateUpload } from '../src/lib/uploadValidation.js';

/**
 * Spec 04 §11.6 — content-sniffed upload validation (test required 9,
 * acceptance 11). Bytes are real, minimal, valid image files generated
 * in-test (a 1x1 PNG and a 1x1 JPEG) — magic-byte sniffing is the actual
 * claim under test, so a fake buffer that merely "looks like" an image would
 * assert nothing.
 */

// The smallest valid PNG: signature + IHDR + IDAT (1x1 transparent pixel) + IEND.
const VALID_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d494844520000000100000001080600000' +
    '01f15c4890000000a4944415478da6360000002000155020918a80f0000000049454e44ae426082',
  'hex',
);

// A minimal but complete valid JPEG (1x1, generated with a standard encoder).
const VALID_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=',
  'base64',
);

const SVG_CLAIMING_PNG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'utf8');

const PHP_SCRIPT_NAMED_PNG = Buffer.from('<?php system($_GET["cmd"]); ?>', 'utf8');

const IMAGE_OPTS = { allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: 5 * 1024 * 1024 };

describe('validateUpload (spec 04 §11.6, test 9, acceptance 11)', () => {
  it('accepts a valid PNG and returns a UUID storageFilename', async () => {
    const result = await validateUpload(VALID_PNG, IMAGE_OPTS);
    expect(result.mimeType).toBe('image/png');
    expect(result.extension).toBe('png');
    expect(result.storageFilename).toMatch(/^[0-9a-f-]{36}\.png$/);
  });

  it('accepts a valid JPEG under the size cap', async () => {
    const result = await validateUpload(VALID_JPEG, IMAGE_OPTS);
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.storageFilename).toMatch(/^[0-9a-f-]{36}\.jpe?g$/);
  });

  it('rejects a PHP script whose bytes disagree with its claimed image type', async () => {
    await expect(validateUpload(PHP_SCRIPT_NAMED_PNG, IMAGE_OPTS)).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
    });
  });

  it('rejects an SVG even when allowedMimeTypes mistakenly lists it', async () => {
    await expect(
      validateUpload(SVG_CLAIMING_PNG, { allowedMimeTypes: ['image/svg+xml', 'image/png'], maxBytes: 5 * 1024 * 1024 }),
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
  });

  it('rejects HTML content regardless of the declared allowlist', async () => {
    const html = Buffer.from('<html><body><script>alert(1)</script></body></html>', 'utf8');
    await expect(
      validateUpload(html, { allowedMimeTypes: ['text/html', 'image/png'], maxBytes: 5 * 1024 * 1024 }),
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
  });

  /**
   * Implementation finding (not a security gap, but worth naming): `file-type`
   * has no magic-byte signature for SVG or HTML — both are byte-less text
   * formats — so `fileTypeFromBuffer` can NEVER return `image/svg+xml`,
   * `text/html`, or `application/xhtml+xml` for real input. The two tests
   * above pass (correctly reject) via the `!detected` "unverifiable file
   * type" branch, not via `FORBIDDEN_MIME_TYPES`, which is therefore dead
   * code for its stated purpose — confirmed here directly against the
   * library, transcribed as a guard against `file-type` ever changing this.
   */
  it('file-type has no magic-byte signature for SVG or HTML (documents why FORBIDDEN_MIME_TYPES cannot be the path that rejects them)', async () => {
    const { fileTypeFromBuffer, supportedMimeTypes } = await import('file-type');
    expect(await fileTypeFromBuffer(SVG_CLAIMING_PNG)).toBeUndefined();
    expect([...supportedMimeTypes]).not.toContain('image/svg+xml');
    expect([...supportedMimeTypes]).not.toContain('text/html');
  });

  it('rejects an oversize file', async () => {
    await expect(validateUpload(VALID_PNG, { ...IMAGE_OPTS, maxBytes: VALID_PNG.byteLength - 1 })).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
    });
  });

  it('rejects an empty file', async () => {
    await expect(validateUpload(Buffer.alloc(0), IMAGE_OPTS)).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
    });
  });

  it('rejects a valid PNG when png is not in the caller\'s allowlist', async () => {
    await expect(
      validateUpload(VALID_PNG, { allowedMimeTypes: ['image/jpeg'], maxBytes: 5 * 1024 * 1024 }),
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
  });

  it('generates a distinct storageFilename per call, never derived from caller input', async () => {
    const first = await validateUpload(VALID_PNG, IMAGE_OPTS);
    const second = await validateUpload(VALID_PNG, IMAGE_OPTS);
    expect(first.storageFilename).not.toBe(second.storageFilename);
  });
});
