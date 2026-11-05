import { CourierCallError } from '../types.js';

/**
 * Bangladesh mobile -> 01XXXXXXXXX (accepts +880 / 880 prefixes and separators). Shared by
 * every courier adapter: Pathao and Steadfast both require exactly eleven digits beginning 01.
 * An invalid number is refused locally, so no parcel can have been created (NOT_CREATED).
 */
export function normalizeCourierPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  const local = digits.startsWith('880') ? `0${digits.slice(3)}` : digits;
  if (!/^01[3-9]\d{8}$/.test(local)) {
    throw new CourierCallError('The recipient phone number is not a valid Bangladesh mobile number.', null, { outcome: 'NOT_CREATED' });
  }
  return local;
}
