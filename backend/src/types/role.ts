/**
 * Role values are constrained to exactly these three (06-rbac §5.19).
 * There is no "Staff" and no "Super Admin".
 *
 * The database enum / CHECK constraint is created in spec 02; this file only
 * fixes the TypeScript type location that later specs import.
 */
export const ROLES = ['ADMIN', 'MANAGER', 'CUSTOMER'] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
