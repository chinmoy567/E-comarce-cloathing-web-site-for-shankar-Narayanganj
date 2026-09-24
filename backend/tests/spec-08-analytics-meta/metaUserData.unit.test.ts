import { describe, it, expect } from 'vitest';
import { buildMetaUserData } from '../../src/services/analytics/metaUserData';

describe('Meta user data hashing (spec 08 §6.5)', () => {
  it('hashes email with normalization (lowercase, trim)', () => {
    const result = buildMetaUserData({
      email: '  JOHN@EXAMPLE.COM  ',
    });

    expect(result.em).toBeTruthy();
    expect(result.em).toHaveLength(64); // SHA-256 hex
    // Hash of lowercase, trimmed email: john@example.com
    expect(result.em).toBe(
      '855f96e983f1f8e8be944692b6f719fd54329826cb62e98015efee8e2e071dd4'
    );
    // No plain-text value
    expect(result.em).not.toContain('@');
  });

  it('hashes phone with digits-only normalization', () => {
    const result = buildMetaUserData({
      phone: '+880-1234-567890',
    });

    expect(result.ph).toBeTruthy();
    expect(result.ph).toHaveLength(64);
    // Hash of digits only: 8801234567890
    expect(result.ph).toBe(
      '61386e01586f2e07b9a415b109abd114855af44abdf17d9ff60ed27e9e53a155'
    );
  });

  it('hashes first and last names with lowercase + trim normalization', () => {
    const result = buildMetaUserData({
      firstName: '  John  ',
      lastName: '  DOE  ',
    });

    expect(result.fn).toBeTruthy();
    expect(result.ln).toBeTruthy();
    expect(result.fn).toHaveLength(64);
    expect(result.ln).toHaveLength(64);
    // No plain-text values
    expect(result.fn).not.toContain('john');
    expect(result.ln).not.toContain('doe');
  });

  it('omits undefined fields', () => {
    const result = buildMetaUserData({
      email: 'test@example.com',
      // no phone, name, ip, ua, fbp, fbc
    });

    expect(result.em).toBeTruthy();
    expect(result.ph).toBeUndefined();
    expect(result.fn).toBeUndefined();
    expect(result.ln).toBeUndefined();
    expect(result.client_ip_address).toBeUndefined();
    expect(result.client_user_agent).toBeUndefined();
    expect(result.fbp).toBeUndefined();
    expect(result.fbc).toBeUndefined();
  });

  it('includes client_ip_address and client_user_agent as-is (not hashed)', () => {
    const result = buildMetaUserData({
      ip: '192.0.2.1',
      userAgent: 'Mozilla/5.0',
    });

    expect(result.client_ip_address).toBe('192.0.2.1');
    expect(result.client_user_agent).toBe('Mozilla/5.0');
  });

  it('includes Meta cookies (fbp/fbc) as-is (not hashed)', () => {
    const result = buildMetaUserData({
      fbp: 'fb.1.123456789.987654321',
      fbc: 'fb.2.abcdefgh.ijklmnop',
    });

    expect(result.fbp).toBe('fb.1.123456789.987654321');
    expect(result.fbc).toBe('fb.2.abcdefgh.ijklmnop');
  });

  it('never includes prohibited fields', () => {
    const result = buildMetaUserData({
      email: 'test@example.com',
    });

    // No object property should be capable of holding password, OTP, token, etc.
    expect(Object.keys(result)).not.toContain('password');
    expect(Object.keys(result)).not.toContain('passwordHash');
    expect(Object.keys(result)).not.toContain('otp');
    expect(Object.keys(result)).not.toContain('token');
    expect(Object.keys(result)).not.toContain('sessionId');
    expect(Object.keys(result)).not.toContain('bkashTransactionId');
    expect(Object.keys(result)).not.toContain('paymentProof');

    // Key-set assertion: if a prohibited field is ever added in the future,
    // this test will fail, preventing a silent security regression.
    const allowedKeys = [
      'em',
      'ph',
      'fn',
      'ln',
      'client_ip_address',
      'client_user_agent',
      'fbp',
      'fbc',
    ];
    Object.keys(result).forEach((key) => {
      expect(allowedKeys).toContain(key);
    });
  });
});
