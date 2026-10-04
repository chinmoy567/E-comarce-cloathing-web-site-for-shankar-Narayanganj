import { describe, expect, it } from 'vitest';
import { PROOF_MAX_BYTES, validateProofFile } from '../src/lib/paymentProof';

describe('validateProofFile (UX pre-check; the backend re-validates)', () => {
  it('accepts JPG, PNG and WebP within the size limit', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(validateProofFile({ type, size: 1024 })).toBeNull();
    }
    expect(validateProofFile({ type: 'image/png', size: PROOF_MAX_BYTES })).toBeNull();
  });

  it('rejects SVG, HTML, PDF and an unknown type', () => {
    for (const type of ['image/svg+xml', 'text/html', 'application/pdf', '']) {
      expect(validateProofFile({ type, size: 1024 })).toMatch(/JPG, PNG or WebP/);
    }
  });

  it('rejects an empty file and one over 5 MB', () => {
    expect(validateProofFile({ type: 'image/png', size: 0 })).toMatch(/empty/);
    expect(validateProofFile({ type: 'image/png', size: PROOF_MAX_BYTES + 1 })).toMatch(/5 MB/);
  });
});
