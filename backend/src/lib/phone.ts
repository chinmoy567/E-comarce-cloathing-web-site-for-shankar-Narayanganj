import { ValidationError } from './errors.js';

/**
 * Bangladesh mobile number normalization (spec 02 assumption 1).
 *
 * 02-customer §2.9.3 step 2 requires "Bangladesh phone number format
 * validation" without defining the format. The canonical stored form is the
 * 11-digit local format `01[3-9]XXXXXXXX`; `+880…` and `880…` inputs are
 * normalized to it before any storage or lookup.
 *
 * This is deliberately the ONLY phone normalizer in the system. Three separate
 * features silently depend on two phone strings comparing equal — customer
 * record reuse (§2.9.4), the risk-check cache key (09-fraud-risk-check §7.6),
 * and the per-customer coupon limit (10-coupon-discount §8.8) — so a second
 * normalizer anywhere would let the same person resolve to two identities.
 */

/** The canonical stored form. Mirrors the `customers_phone_number_format` CHECK. */
const CANONICAL = /^01[3-9][0-9]{8}$/;

/** Characters humans type into phone fields that carry no information. */
const SEPARATORS = /[\s\-().]/g;

/**
 * Reduces any accepted input form to the canonical 11-digit local number.
 *
 * Accepts `+8801XXXXXXXXX`, `8801XXXXXXXXX`, and `01XXXXXXXXX`, with or
 * without spaces, dashes, dots, or parentheses.
 *
 * @throws ValidationError when the input cannot be reduced to a valid number.
 */
export function normalizeBdPhone(input: string): string {
  if (typeof input !== 'string') {
    throw new ValidationError('A valid Bangladesh mobile number is required.', [
      { field: 'phoneNumber', message: 'must be a string' },
    ]);
  }

  let digits = input.replace(SEPARATORS, '');

  // Country code, with or without the leading plus.
  if (digits.startsWith('+880')) {
    digits = digits.slice(4);
  } else if (digits.startsWith('880')) {
    digits = digits.slice(3);
  }

  // A country-code form written without the trunk zero: 8801712345678 -> 1712345678.
  if (digits.length === 10 && digits.startsWith('1')) {
    digits = `0${digits}`;
  }

  if (!CANONICAL.test(digits)) {
    throw new ValidationError('A valid Bangladesh mobile number is required.', [
      { field: 'phoneNumber', message: 'must be a valid Bangladesh mobile number' },
    ]);
  }

  return digits;
}

/** Non-throwing companion to `normalizeBdPhone`, for validation-only paths. */
export function isValidBdPhone(input: string): boolean {
  try {
    normalizeBdPhone(input);
    return true;
  } catch {
    return false;
  }
}
