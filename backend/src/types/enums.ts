/**
 * TypeScript mirrors of the database enums created in spec 02's migration.
 *
 * Each list must stay identical to its Postgres enum; a value added in SQL
 * without a matching entry here is a bug the type system cannot catch.
 * `role.ts` holds `user_role` separately, since spec 01 already fixed its
 * location.
 */

/** 02-customer §2.9.4 — guest reference vs registered customer. */
export const ACCOUNT_TYPES = ['GUEST', 'REGISTERED'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export function isAccountType(value: unknown): value is AccountType {
  return typeof value === 'string' && (ACCOUNT_TYPES as readonly string[]).includes(value);
}

/**
 * 02-customer §2.2 note — the Upazila/Thana naming discriminator.
 * This is one address field with two naming conventions, not two fields.
 */
export const AREA_UNIT_TYPES = ['UPAZILA', 'THANA'] as const;
export type AreaUnitType = (typeof AREA_UNIT_TYPES)[number];

export function isAreaUnitType(value: unknown): value is AreaUnitType {
  return typeof value === 'string' && (AREA_UNIT_TYPES as readonly string[]).includes(value);
}

/** 02-customer §2.2 note — the Union/Ward naming discriminator. */
export const WARD_UNIT_TYPES = ['UNION', 'WARD'] as const;
export type WardUnitType = (typeof WARD_UNIT_TYPES)[number];

export function isWardUnitType(value: unknown): value is WardUnitType {
  return typeof value === 'string' && (WARD_UNIT_TYPES as readonly string[]).includes(value);
}

/** 06-rbac §5.18 — a permission's default tier for a role. */
export const PERMISSION_TIERS = ['YES', 'ASSIGNED', 'NO'] as const;
export type PermissionTier = (typeof PERMISSION_TIERS)[number];

export function isPermissionTier(value: unknown): value is PermissionTier {
  return typeof value === 'string' && (PERMISSION_TIERS as readonly string[]).includes(value);
}

/** 06-rbac §5.21.11 — who performed an audited action: a user, or the system. */
export const ACTOR_TYPES = ['USER', 'SYSTEM'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];
