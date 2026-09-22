import type { PermissionTier } from '../types/enums.js';
import type { PermissionKey } from '../types/permissions.js';
import { run, type Db } from './db.js';
import { toDomainError } from './pgErrors.js';

/**
 * The permission catalogue (06-rbac §5.16, §5.18) and per-user grants of the
 * ASSIGNED-tier permissions.
 *
 * This layer stores and reads grants only. Resolving a role's default tier plus
 * its grants into an effective permission set, and enforcing it, is spec 03's
 * permission service — nothing here answers "may this user do X?".
 */

export type PermissionCatalogueEntry = {
  key: PermissionKey;
  label: string;
  adminTier: PermissionTier;
  managerTier: PermissionTier;
  isAdministrative: boolean;
};

type PermissionRow = {
  key: PermissionKey;
  label: string;
  admin_tier: PermissionTier;
  manager_tier: PermissionTier;
  is_administrative: boolean;
};

function toEntry(row: PermissionRow): PermissionCatalogueEntry {
  return {
    key: row.key,
    label: row.label,
    adminTier: row.admin_tier,
    managerTier: row.manager_tier,
    isAdministrative: row.is_administrative,
  };
}

/** The full catalogue, seeded by the spec 02 migration. */
export async function listAll(db?: Db): Promise<PermissionCatalogueEntry[]> {
  return run(db, async (client) => {
    const { rows } = await client.query<PermissionRow>(
      `SELECT key, label, admin_tier, manager_tier, is_administrative
         FROM permissions
        ORDER BY key`,
    );
    return rows.map(toEntry);
  });
}

/** The ASSIGNED-tier permissions explicitly granted to one account. */
export async function listGrantsForUser(userId: string, db?: Db): Promise<PermissionKey[]> {
  return run(db, async (client) => {
    const { rows } = await client.query<{ permission_key: PermissionKey }>(
      `SELECT permission_key
         FROM user_permissions
        WHERE user_id = $1
        ORDER BY permission_key`,
      [userId],
    );
    return rows.map((row) => row.permission_key);
  });
}

/**
 * Grants a permission. Idempotent by construction: the
 * `user_permissions_user_id_permission_key_key` constraint makes re-granting a
 * held permission a no-op rather than a duplicate row.
 *
 * An unknown key fails the `permission_key` foreign key and surfaces as
 * ValidationError UNKNOWN_PERMISSION.
 *
 * §5.15 rules 4 and 6 — an assigner may only grant what they themselves hold,
 * and never to themselves — are enforced by spec 03's service before it calls
 * this; the storage layer does not know who is asking.
 */
export async function grant(
  userId: string,
  permissionKey: PermissionKey,
  grantedBy: string,
  db?: Db,
): Promise<void> {
  return run(db, async (client) => {
    try {
      await client.query(
        `INSERT INTO user_permissions (user_id, permission_key, granted_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, permission_key) DO NOTHING`,
        [userId, permissionKey, grantedBy],
      );
    } catch (err) {
      throw toDomainError(err);
    }
  });
}

/** Revokes a permission. Revoking one not held is a no-op, not an error. */
export async function revoke(
  userId: string,
  permissionKey: PermissionKey,
  db?: Db,
): Promise<void> {
  return run(db, async (client) => {
    await client.query(
      `DELETE FROM user_permissions WHERE user_id = $1 AND permission_key = $2`,
      [userId, permissionKey],
    );
  });
}
