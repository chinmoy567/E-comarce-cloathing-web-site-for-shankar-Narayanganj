import { createHash } from 'node:crypto';

/**
 * Fast deterministic hash for grouping keys that must never store the raw
 * value (spec 04 §Logging — rate-limit rejection identifiers; not a password
 * or token hash, so bcrypt's deliberate slowness would be the wrong tool
 * here). SHA-256, hex-encoded.
 */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
