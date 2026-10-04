import { describe, expect, it } from 'vitest';
import { PROOF_MAX_BYTES, validateProofFile, validateResubmission } from '../src/lib/paymentProof';

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

describe('validateResubmission', () => {
  const png = { type: 'image/png', size: 2000 };

  it('after a rejection needs an ID and/or a screenshot', () => {
    expect(validateResubmission({ paymentStatus: 'REJECTED', transactionId: '', file: null })).toMatch(/Transaction ID and\/or/);
    expect(validateResubmission({ paymentStatus: 'REJECTED', transactionId: 'NEWTX12345', file: null })).toBeNull();
    expect(validateResubmission({ paymentStatus: 'REJECTED', transactionId: '', file: png })).toBeNull();
    expect(validateResubmission({ paymentStatus: 'REJECTED', transactionId: 'NEWTX12345', file: png })).toBeNull();
  });

  it('bounds the Transaction ID length and ignores surrounding spaces', () => {
    expect(validateResubmission({ paymentStatus: 'REJECTED', transactionId: 'ab', file: null })).toMatch(/5 to 50/);
    expect(validateResubmission({ paymentStatus: 'REJECTED', transactionId: 'x'.repeat(51), file: null })).toMatch(/5 to 50/);
    expect(validateResubmission({ paymentStatus: 'REJECTED', transactionId: '  NEWTX12345  ', file: null })).toBeNull();
  });

  it('rejects an unsuitable screenshot even alongside a valid ID', () => {
    expect(validateResubmission({ paymentStatus: 'REJECTED', transactionId: 'NEWTX12345', file: { type: 'image/svg+xml', size: 10 } })).toMatch(/JPG, PNG or WebP/);
  });

  it('while awaiting verification only a screenshot is accepted, never an ID', () => {
    expect(validateResubmission({ paymentStatus: 'PENDING_VERIFICATION', transactionId: '', file: null })).toMatch(/Choose a screenshot/);
    expect(validateResubmission({ paymentStatus: 'PENDING_VERIFICATION', transactionId: 'NEWTX12345', file: png })).toMatch(/after a payment is rejected/);
    expect(validateResubmission({ paymentStatus: 'PENDING_VERIFICATION', transactionId: '', file: png })).toBeNull();
  });
});
