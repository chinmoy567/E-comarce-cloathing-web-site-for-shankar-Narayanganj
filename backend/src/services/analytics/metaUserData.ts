import { createHash } from 'crypto';

/**
 * Hashed customer identifiers sent to Meta per spec 18 §6.5/§6.6.
 * No plain-text field exists on this type — omission of prohibited data is structural.
 * All values are 64-char hex SHA-256 hashes (except fbp/fbc, which are Meta's own cookies).
 */
export type MetaUserData = {
  em?: string; // hashed email
  ph?: string; // hashed phone
  fn?: string; // hashed first name
  ln?: string; // hashed last name
  client_ip_address?: string;
  client_user_agent?: string;
  fbp?: string; // Meta's own _fbp cookie, forwarded as-is
  fbc?: string; // Meta's own _fbc cookie, forwarded as-is
};

export interface BuildMetaUserDataInput {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  ip?: string;
  userAgent?: string;
  fbp?: string;
  fbc?: string;
}

/**
 * Builds a MetaUserData object with normalized, hashed identifiers.
 * Normalization and hashing follow Meta's documented rules.
 * See spec 18 §6.5 for the exact normalization per field.
 */
export function buildMetaUserData(input: BuildMetaUserDataInput): MetaUserData {
  const result: MetaUserData = {};

  if (input.email) {
    result.em = hashField(input.email.toLowerCase().trim());
  }

  if (input.phone) {
    // Digits only, with country code
    const digitsOnly = input.phone.replace(/\D/g, '');
    if (digitsOnly) {
      result.ph = hashField(digitsOnly);
    }
  }

  if (input.firstName) {
    result.fn = hashField(input.firstName.toLowerCase().trim());
  }

  if (input.lastName) {
    result.ln = hashField(input.lastName.toLowerCase().trim());
  }

  if (input.ip) {
    result.client_ip_address = input.ip;
  }

  if (input.userAgent) {
    result.client_user_agent = input.userAgent;
  }

  // Meta's own cookies are forwarded as-is, not hashed
  if (input.fbp) {
    result.fbp = input.fbp;
  }

  if (input.fbc) {
    result.fbc = input.fbc;
  }

  return result;
}

function hashField(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
