import * as permissionsRepository from '../repositories/permissions.repository.js';
import type { PermissionKey } from '../types/permissions.js';
import type { UserRole } from '../types/role.js';
import type { Db } from '../repositories/db.js';

/**
 * Effective-permission resolution (06-rbac §5.18, spec 03 §Middleware).
 *
 * ADMIN gets every `admin_tier = 'YES'` key. MANAGER gets every
 * `manager_tier = 'YES'` key plus whichever `ASSIGNED`-tier keys are granted to
 * that specific account. A `manager_tier = 'NO'` key is filtered out
 * regardless of any grant row that might exist for it, so a stray row can
 * never escalate (§5.16) — the grant endpoint also refuses to create one, but
 * this is the second, independent guard.
 *
 * A CUSTOMER role resolves to no permissions; the customer domain has no use
 * for this catalogue (§5.19).
 */
export async function resolveEffectivePermissions(
  userId: string,
  role: UserRole,
  db?: Db,
): Promise<PermissionKey[]> {
  if (role === 'CUSTOMER') return [];

  const catalogue = await permissionsRepository.listAll(db);

  if (role === 'ADMIN') {
    return catalogue.filter((entry) => entry.adminTier === 'YES').map((entry) => entry.key);
  }

  const roleGranted = new Set(
    catalogue.filter((entry) => entry.managerTier === 'YES').map((entry) => entry.key),
  );
  const assignable = new Set(
    catalogue.filter((entry) => entry.managerTier === 'ASSIGNED').map((entry) => entry.key),
  );

  const grants = await permissionsRepository.listGrantsForUser(userId, db);
  for (const key of grants) {
    if (assignable.has(key)) {
      roleGranted.add(key);
    }
  }

  return [...roleGranted];
}
