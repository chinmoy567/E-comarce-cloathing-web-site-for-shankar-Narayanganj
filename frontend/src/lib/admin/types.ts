/**
 * Mirrors of the back-office API response shapes (spec 03 §Request/response
 * types). Hand-maintained, like `apiTypes.ts`, since the frontend never
 * imports backend source directly.
 */

export type AdminRole = 'ADMIN' | 'MANAGER';

/** The 06-rbac §5.18 permission-key union. Kept as `string` here rather than a
 * literal union — the catalogue is the source of truth and is fetched at
 * runtime; a stale frontend copy of the key list would silently drift. */
export type PermissionKey = string;

export type PermissionTier = 'YES' | 'ASSIGNED' | 'NO';

export type PermissionCatalogueEntry = {
  key: PermissionKey;
  label: string;
  adminTier: PermissionTier;
  managerTier: PermissionTier;
  isAdministrative: boolean;
};

export type AdminUserSummary = {
  id: string;
  userIdentifier: string;
  role: AdminRole;
  isSystemAdmin: boolean;
};

export type AdminLoginResponse = {
  user: AdminUserSummary;
  permissions: PermissionKey[];
  mustChangePassword: boolean;
};

/**
 * `mustChangePassword` is not in the spec's literal `MeResponse` type, but the
 * backend includes it (see `backend/src/services/adminAuth.service.ts`
 * `MeResult`) so the shell can gate every page load, not only the login
 * response.
 */
export type MeResponse = AdminUserSummary & { permissions: PermissionKey[]; mustChangePassword: boolean };

export type ManagerListItem = {
  id: string;
  userIdentifier: string;
  isActive: boolean;
  createdAt: string;
};

export type ManagerDetail = {
  id: string;
  userIdentifier: string;
  role: 'MANAGER';
  isActive: boolean;
  permissions: PermissionKey[];
  createdAt: string;
};

export type AuditLogEntry = {
  id: string;
  entityType: string;
  entityId: string | null;
  action: string;
  previousValue: unknown;
  newValue: unknown;
  actorUserId: string | null;
  actorType: 'USER' | 'SYSTEM';
  createdAt: string;
};
