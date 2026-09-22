import type pg from 'pg';
import { withTransaction } from '../lib/transaction.js';
import { hashPassword } from '../lib/password.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../lib/errors.js';
import * as usersRepository from '../repositories/users.repository.js';
import * as permissionsRepository from '../repositories/permissions.repository.js';
import * as auditRepository from '../repositories/audit.repository.js';
import type { PaginationQuery } from '../lib/pagination.js';
import type { PermissionKey } from '../types/permissions.js';
import type { UserRecord } from '../repositories/users.repository.js';

/**
 * Manager account and permission management (spec 03 §Service-layer rules).
 *
 * Every mutation runs inside `withTransaction` so the change and its
 * `audit_logs` row commit together (06-rbac §5.15 rule 10) — an audited action
 * and its record can never diverge.
 */

export type Actor = { userId: string; role: 'ADMIN' | 'MANAGER' };

export type ManagerResponse = {
  id: string;
  userIdentifier: string;
  role: 'MANAGER';
  isActive: boolean;
  permissions: PermissionKey[];
  createdAt: string;
};

function toManagerResponse(user: UserRecord, permissions: PermissionKey[]): ManagerResponse {
  return {
    id: user.id,
    userIdentifier: user.userIdentifier!,
    role: 'MANAGER',
    isActive: user.isActive,
    permissions,
    createdAt: user.createdAt.toISOString(),
  };
}

/** Loads a MANAGER row or throws 404 — the single check that makes every §5.12.3 protection hold. */
async function loadManagerOrThrow(id: string, client: pg.PoolClient): Promise<UserRecord> {
  const user = await usersRepository.findById(id, client);
  if (!user || user.role !== 'MANAGER') {
    throw new NotFoundError('Manager not found.');
  }
  return user;
}

/** The actor's own currently-effective ASSIGNED+YES permission set — the ceiling for §5.15 rule 6. */
async function loadActorPermissions(
  actor: Actor,
  catalogue: permissionsRepository.PermissionCatalogueEntry[],
  client: pg.PoolClient,
): Promise<Set<PermissionKey>> {
  if (actor.role === 'ADMIN') {
    return new Set(catalogue.filter((entry) => entry.adminTier === 'YES').map((entry) => entry.key));
  }
  const managerYes = catalogue.filter((entry) => entry.managerTier === 'YES').map((entry) => entry.key);
  const managerAssigned = await permissionsRepository.listGrantsForUser(actor.userId, client);
  return new Set([...managerYes, ...managerAssigned]);
}

function assertAssignableTier(
  keys: Iterable<PermissionKey>,
  catalogue: permissionsRepository.PermissionCatalogueEntry[],
): void {
  const tierByKey = new Map(catalogue.map((entry) => [entry.key, entry.managerTier]));
  for (const key of keys) {
    if (tierByKey.get(key) !== 'ASSIGNED') {
      throw new ValidationError(
        'This permission cannot be assigned to a Manager.',
        [{ field: 'permissions', message: `${key} is not an ASSIGNED-tier permission` }],
        'PERMISSION_NOT_ASSIGNABLE',
      );
    }
  }
}

function assertActorHolds(keys: Iterable<PermissionKey>, actorPermissions: Set<PermissionKey>): void {
  for (const key of keys) {
    if (!actorPermissions.has(key)) {
      throw new ForbiddenError(
        'You cannot grant or revoke a permission you do not hold.',
        undefined,
        'CANNOT_GRANT_UNHELD_PERMISSION',
      );
    }
  }
}

export async function listManagers(pagination: PaginationQuery) {
  return usersRepository.listManagers(pagination);
}

export async function getManager(id: string): Promise<ManagerResponse> {
  const user = await usersRepository.findById(id);
  if (!user || user.role !== 'MANAGER') {
    throw new NotFoundError('Manager not found.');
  }
  const permissions = await permissionsRepository.listGrantsForUser(user.id);
  return toManagerResponse(user, permissions);
}

export type CreateManagerInput = {
  userIdentifier: string;
  password: string;
  permissions?: PermissionKey[];
};

export async function createManager(actor: Actor, input: CreateManagerInput): Promise<ManagerResponse> {
  // §5.14 Rule 2 defence in depth — requirePermission('user.manager.create')
  // already blocks a Manager (it's `No` for that role), but the service
  // re-asserts per §5.15 rule 9.
  if (actor.role !== 'ADMIN') {
    throw new ForbiddenError('Only the Admin may create Manager accounts.');
  }

  const requestedPermissions = input.permissions ?? [];

  return withTransaction(async (client) => {
    if (requestedPermissions.length > 0) {
      const catalogue = await permissionsRepository.listAll(client);
      assertAssignableTier(requestedPermissions, catalogue);
      const actorPermissions = await loadActorPermissions(actor, catalogue, client);
      assertActorHolds(requestedPermissions, actorPermissions);
    }

    // There is no `role` field on CreateManagerInput, so creating an Admin
    // through this endpoint is structurally impossible (§5.12, §5.12.3).
    const passwordHash = await hashPassword(input.password);
    const created = await usersRepository.create(
      {
        role: 'MANAGER',
        userIdentifier: input.userIdentifier,
        passwordHash,
        mustChangePassword: true,
        createdBy: actor.userId,
      },
      client,
    );

    await auditRepository.append(
      {
        entityType: 'user',
        entityId: created.id,
        action: 'manager_created',
        newValue: { userIdentifier: created.userIdentifier },
        actorUserId: actor.userId,
        actorType: 'USER',
      },
      client,
    );

    for (const key of requestedPermissions) {
      await permissionsRepository.grant(created.id, key, actor.userId, client);
      await auditRepository.append(
        {
          entityType: 'user',
          entityId: created.id,
          action: 'permission_grant',
          newValue: { permission: key },
          actorUserId: actor.userId,
          actorType: 'USER',
        },
        client,
      );
    }

    return toManagerResponse(created, requestedPermissions);
  });
}

export type UpdateManagerInput = {
  userIdentifier?: string;
  password?: string;
};

export async function updateManager(actor: Actor, id: string, input: UpdateManagerInput): Promise<ManagerResponse> {
  return withTransaction(async (client) => {
    // Loading with `role = 'MANAGER'` makes every §5.12.3 protection hold: the
    // system Admin is an ADMIN row and therefore 404s here regardless of actor.
    const target = await loadManagerOrThrow(id, client);

    if (target.id === actor.userId) {
      throw new ForbiddenError('You cannot modify your own account.', undefined, 'CANNOT_MODIFY_SELF');
    }
    if (actor.role !== 'ADMIN') {
      throw new ForbiddenError('Only the Admin may update Manager accounts.');
    }

    const previousValue: Record<string, unknown> = {};
    const newValue: Record<string, unknown> = {};
    let identifierChanged = false;
    let passwordHash: string | undefined;

    if (input.userIdentifier !== undefined && input.userIdentifier !== target.userIdentifier) {
      previousValue.userIdentifier = target.userIdentifier;
      newValue.userIdentifier = input.userIdentifier;
      identifierChanged = true;
    }
    if (input.password !== undefined) {
      passwordHash = await hashPassword(input.password);
      previousValue.password = 'changed';
      newValue.password = 'changed';
    }

    if (!identifierChanged && passwordHash === undefined) {
      const permissions = await permissionsRepository.listGrantsForUser(target.id, client);
      return toManagerResponse(target, permissions);
    }

    // `users.repository.update` has no `userIdentifier` field today — write it
    // via a direct statement inside this same transaction.
    if (identifierChanged) {
      await client.query(`UPDATE users SET user_identifier = $2, updated_at = now() WHERE id = $1`, [
        target.id,
        input.userIdentifier,
      ]);
    }
    if (passwordHash !== undefined) {
      await usersRepository.update(target.id, { passwordHash }, client);
    }
    const updated = (await usersRepository.findById(target.id, client))!;

    await auditRepository.append(
      {
        entityType: 'user',
        entityId: target.id,
        action: 'manager_updated',
        previousValue,
        newValue,
        actorUserId: actor.userId,
        actorType: 'USER',
      },
      client,
    );

    const permissions = await permissionsRepository.listGrantsForUser(updated.id, client);
    return toManagerResponse(updated, permissions);
  });
}

async function setManagerActive(actor: Actor, id: string, isActive: boolean, action: string): Promise<ManagerResponse> {
  return withTransaction(async (client) => {
    const target = await loadManagerOrThrow(id, client);

    if (target.id === actor.userId) {
      throw new ForbiddenError('You cannot modify your own account.', undefined, 'CANNOT_MODIFY_SELF');
    }
    if (actor.role !== 'ADMIN') {
      throw new ForbiddenError('Only the Admin may change a Manager account status.');
    }

    const updated = (await usersRepository.update(target.id, { isActive }, client))!;

    await auditRepository.append(
      {
        entityType: 'user',
        entityId: target.id,
        action,
        previousValue: { isActive: target.isActive },
        newValue: { isActive },
        actorUserId: actor.userId,
        actorType: 'USER',
      },
      client,
    );

    const permissions = await permissionsRepository.listGrantsForUser(updated.id, client);
    return toManagerResponse(updated, permissions);
  });
}

export async function deactivateManager(actor: Actor, id: string): Promise<ManagerResponse> {
  return setManagerActive(actor, id, false, 'manager_deactivated');
}

export async function reactivateManager(actor: Actor, id: string): Promise<ManagerResponse> {
  return setManagerActive(actor, id, true, 'manager_reactivated');
}

export async function deleteManager(actor: Actor, id: string): Promise<void> {
  return withTransaction(async (client) => {
    const target = await loadManagerOrThrow(id, client);

    if (target.id === actor.userId) {
      throw new ForbiddenError('You cannot delete your own account.', undefined, 'CANNOT_MODIFY_SELF');
    }
    if (actor.role !== 'ADMIN') {
      throw new ForbiddenError('Only the Admin may delete Manager accounts.');
    }

    await client.query(`DELETE FROM users WHERE id = $1`, [target.id]);

    await auditRepository.append(
      {
        entityType: 'user',
        entityId: target.id,
        action: 'manager_deleted',
        previousValue: { userIdentifier: target.userIdentifier, role: target.role },
        actorUserId: actor.userId,
        actorType: 'USER',
      },
      client,
    );
  });
}

export async function setManagerPermissions(
  actor: Actor,
  id: string,
  requestedKeys: PermissionKey[],
): Promise<{ permissions: PermissionKey[] }> {
  return withTransaction(async (client) => {
    const target = await loadManagerOrThrow(id, client);

    if (target.id === actor.userId) {
      throw new ForbiddenError('You cannot change your own permissions.', undefined, 'CANNOT_MODIFY_SELF');
    }

    const catalogue = await permissionsRepository.listAll(client);
    assertAssignableTier(requestedKeys, catalogue);

    const current = new Set(await permissionsRepository.listGrantsForUser(target.id, client));
    const requested = new Set(requestedKeys);

    const toGrant = [...requested].filter((key) => !current.has(key));
    const toRevoke = [...current].filter((key) => !requested.has(key));

    // §5.15 rule 6, at both ends of the diff: the actor must hold every key it
    // grants OR revokes.
    const actorPermissions = await loadActorPermissions(actor, catalogue, client);
    assertActorHolds([...toGrant, ...toRevoke], actorPermissions);

    for (const key of toGrant) {
      await permissionsRepository.grant(target.id, key, actor.userId, client);
      await auditRepository.append(
        {
          entityType: 'user',
          entityId: target.id,
          action: 'permission_grant',
          newValue: { permission: key },
          actorUserId: actor.userId,
          actorType: 'USER',
        },
        client,
      );
    }
    for (const key of toRevoke) {
      await permissionsRepository.revoke(target.id, key, client);
      await auditRepository.append(
        {
          entityType: 'user',
          entityId: target.id,
          action: 'permission_revoke',
          previousValue: { permission: key },
          actorUserId: actor.userId,
          actorType: 'USER',
        },
        client,
      );
    }

    return { permissions: [...requested] };
  });
}
