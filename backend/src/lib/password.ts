import bcrypt from 'bcrypt';
import { BCRYPT_COST } from '../config/constants.js';

/**
 * The only place password hashing happens (11-security-hardening §11.7,
 * 02-customer §2.1).
 *
 * No other module imports `bcrypt` directly, and no code path here logs the
 * plaintext or the resulting hash.
 */

/** Hashes a plaintext password for storage in `users.password_hash`. */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

/**
 * Verifies a plaintext password against a stored hash.
 *
 * Returns false rather than throwing on a malformed or empty stored hash, so a
 * corrupt row reads as "wrong password" instead of a 500 that distinguishes
 * that account from any other.
 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (!hash) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}
