import { describe, expect, it } from 'vitest';
import { isValidBdPhone, normalizeBdPhone } from '../../src/lib/phone.ts';
import { ValidationError } from '../../src/lib/errors.ts';

/**
 * Spec 02 acceptance 9 — one canonical phone form.
 *
 * Pure unit test, no database: this helper is the single reason two phone
 * strings for the same person compare equal, which customer-record reuse
 * (§2.9.4), the risk-check cache key (§7.6), and the per-customer coupon limit
 * (§8.8) all silently depend on. If it is inconsistent, those three features
 * break in ways none of their own tests would catch.
 */
describe('normalizeBdPhone (acceptance 9)', () => {
  it.each([
    ['+8801712345678', '01712345678'],
    ['8801712345678', '01712345678'],
    ['01712345678', '01712345678'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeBdPhone(input)).toBe(expected);
  });

  it('all three accepted forms collapse to one identical string', () => {
    const forms = ['+8801712345678', '8801712345678', '01712345678'];
    expect(new Set(forms.map(normalizeBdPhone)).size).toBe(1);
  });

  it('ignores separators humans type', () => {
    expect(normalizeBdPhone('+880 1712-345678')).toBe('01712345678');
    expect(normalizeBdPhone('01712 345 678')).toBe('01712345678');
    expect(normalizeBdPhone('(017) 1234-5678')).toBe('01712345678');
  });

  it('accepts every valid operator prefix 013-019', () => {
    for (const d of [3, 4, 5, 6, 7, 8, 9]) {
      expect(normalizeBdPhone(`01${d}12345678`)).toBe(`01${d}12345678`);
    }
  });

  it.each([
    ['0171234567', 'too short'],
    ['017123456789', 'too long'],
    ['01212345678', 'invalid operator prefix 012'],
    ['01012345678', 'invalid operator prefix 010'],
    ['02712345678', 'not a mobile number'],
    ['+9171234567890', 'wrong country code'],
    ['', 'empty'],
    ['not-a-number', 'non-numeric'],
  ])('rejects %s (%s)', (input) => {
    expect(() => normalizeBdPhone(input)).toThrow(ValidationError);
  });

  it('never leaks the rejected value into the error message', () => {
    try {
      normalizeBdPhone('01999');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as Error).message).not.toContain('01999');
    }
  });
});

describe('isValidBdPhone', () => {
  it('agrees with normalizeBdPhone without throwing', () => {
    expect(isValidBdPhone('+8801712345678')).toBe(true);
    expect(isValidBdPhone('0171234567')).toBe(false);
  });
});
