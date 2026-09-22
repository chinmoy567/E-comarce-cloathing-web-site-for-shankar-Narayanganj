import { normalizeBdPhone } from '../lib/phone.js';
import type { PaginationQuery } from '../lib/pagination.js';
import type { UserRole } from '../types/role.js';
import { run, type Db } from './db.js';
import { toDomainError } from './pgErrors.js';

/**
 * Login identities: Admin, Manager, and registered Customer (06-rbac §5.19).
 *
 * A guest customer has no row here — no role, no session, no password — so
 * guest flows are gated by submitted-field validation, never by RBAC.
 *
 * `password_hash` is returned ONLY by the `findBy*` lookups that spec 03's and
 * spec 08's auth services call. Every other function selects an explicit column
 * list that omits it, so a hash cannot reach a list response by accident.
 */

/** Safe projection: everything except `password_hash`. */
const COLUMNS = `
  id, role, user_identifier, phone_number, email, customer_id,
  is_system_admin, is_active, must_change_password,
  last_login_at, created_by, created_at, updated_at
`;

type UserRow = {
  id: string;
  role: UserRole;
  user_identifier: string | null;
  phone_number: string | null;
  email: string | null;
  customer_id: string | null;
  is_system_admin: boolean;
  is_active: boolean;
  must_change_password: boolean;
  last_login_at: Date | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
};

type UserRowWithHash = UserRow & { password_hash: string };

export type UserRecord = {
  id: string;
  role: UserRole;
  userIdentifier: string | null;
  phoneNumber: string | null;
  email: string | null;
  customerId: string | null;
  isSystemAdmin: boolean;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** A record carrying the hash, for password verification only. */
export type UserWithSecret = UserRecord & { passwordHash: string };

function toRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    role: row.role,
    userIdentifier: row.user_identifier,
    phoneNumber: row.phone_number,
    email: row.email,
    customerId: row.customer_id,
    isSystemAdmin: row.is_system_admin,
    isActive: row.is_active,
    mustChangePassword: row.must_change_password,
    lastLoginAt: row.last_login_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRecordWithSecret(row: UserRowWithHash): UserWithSecret {
  return { ...toRecord(row), passwordHash: row.password_hash };
}

/**
 * Admin/Manager login lookup (02-customer §2.8).
 * Returns the password hash — callers outside auth want `findById`.
 */
export async function findByUserIdentifier(
  userIdentifier: string,
  db?: Db,
): Promise<UserWithSecret | null> {
  return run(db, async (client) => {
    const { rows } = await client.query<UserRowWithHash>(
      `SELECT ${COLUMNS}, password_hash FROM users WHERE user_identifier = $1`,
      [userIdentifier],
    );
    return rows[0] ? toRecordWithSecret(rows[0]) : null;
  });
}

/**
 * Registered-customer login lookup (02-customer §2.1, §2.4).
 * Returns the password hash — callers outside auth want `findById`.
 */
export async function findByPhoneNumber(
  phoneNumber: string,
  db?: Db,
): Promise<UserWithSecret | null> {
  const normalized = normalizeBdPhone(phoneNumber);
  return run(db, async (client) => {
    const { rows } = await client.query<UserRowWithHash>(
      `SELECT ${COLUMNS}, password_hash FROM users WHERE phone_number = $1`,
      [normalized],
    );
    return rows[0] ? toRecordWithSecret(rows[0]) : null;
  });
}

/** Lookup without the hash — the function every non-auth caller wants. */
export async function findById(id: string, db?: Db): Promise<UserRecord | null> {
  return run(db, async (client) => {
    const { rows } = await client.query<UserRow>(
      `SELECT ${COLUMNS} FROM users WHERE id = $1`,
      [id],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  });
}

/**
 * Lookup by id WITH the hash — for the self-service change-password flow
 * (spec 03), which authenticates the caller by session, not by credentials, so
 * it needs the hash keyed on id rather than on `userIdentifier`/`phoneNumber`.
 */
export async function findByIdWithSecret(id: string, db?: Db): Promise<UserWithSecret | null> {
  return run(db, async (client) => {
    const { rows } = await client.query<UserRowWithHash>(
      `SELECT ${COLUMNS}, password_hash FROM users WHERE id = $1`,
      [id],
    );
    return rows[0] ? toRecordWithSecret(rows[0]) : null;
  });
}

/**
 * Creates a login identity.
 *
 * `is_system_admin` is deliberately absent: the protected Admin designation
 * (§5.12.3) is set only by spec 03's seed script, which writes that column
 * directly, and by nothing else. No API-reachable path can mint one.
 *
 * The database's `users_role_shape` CHECK rejects a mismatched shape — an ADMIN
 * carrying a `customerId`, or a CUSTOMER without one — regardless of what the
 * caller passes.
 */
export type CreateUserInput = {
  role: UserRole;
  passwordHash: string;
  userIdentifier?: string | null;
  phoneNumber?: string | null;
  email?: string | null;
  customerId?: string | null;
  mustChangePassword?: boolean;
  createdBy?: string | null;
};

export async function create(input: CreateUserInput, db?: Db): Promise<UserRecord> {
  const phoneNumber = input.phoneNumber ? normalizeBdPhone(input.phoneNumber) : null;
  return run(db, async (client) => {
    try {
      const { rows } = await client.query<UserRow>(
        `INSERT INTO users (
           role, user_identifier, phone_number, email,
           password_hash, customer_id, must_change_password, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING ${COLUMNS}`,
        [
          input.role,
          input.userIdentifier ?? null,
          phoneNumber,
          input.email ?? null,
          input.passwordHash,
          input.customerId ?? null,
          input.mustChangePassword ?? false,
          input.createdBy ?? null,
        ],
      );
      return toRecord(rows[0]!);
    } catch (err) {
      throw toDomainError(err);
    }
  });
}

/**
 * Updates the mutable fields of a login identity.
 *
 * `role`, `customer_id`, and `is_system_admin` are NOT updatable here: the
 * first two would let an account cross the customer/back-office boundary the
 * `users_role_shape` CHECK exists to enforce, and the third is seed-only.
 * Role changes, where the PRDs allow them at all, are a spec 03 concern.
 */
export type UpdateUserInput = {
  email?: string | null;
  passwordHash?: string;
  isActive?: boolean;
  mustChangePassword?: boolean;
  lastLoginAt?: Date;
};

export async function update(
  id: string,
  input: UpdateUserInput,
  db?: Db,
): Promise<UserRecord | null> {
  const sets: string[] = [];
  const values: unknown[] = [id];

  // Built from a fixed allowlist of column names — never from caller-supplied
  // keys — with every value bound as a parameter.
  const assign = (column: string, value: unknown): void => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };

  if (input.email !== undefined) assign('email', input.email);
  if (input.passwordHash !== undefined) assign('password_hash', input.passwordHash);
  if (input.isActive !== undefined) assign('is_active', input.isActive);
  if (input.mustChangePassword !== undefined) {
    assign('must_change_password', input.mustChangePassword);
  }
  if (input.lastLoginAt !== undefined) assign('last_login_at', input.lastLoginAt);

  if (sets.length === 0) return findById(id, db);

  return run(db, async (client) => {
    try {
      const { rows } = await client.query<UserRow>(
        `UPDATE users SET ${sets.join(', ')}, updated_at = now()
          WHERE id = $1
          RETURNING ${COLUMNS}`,
        values,
      );
      return rows[0] ? toRecord(rows[0]) : null;
    } catch (err) {
      throw toDomainError(err);
    }
  });
}

/** Paginated Manager listing for spec 03's account-management panel. */
export async function listManagers(
  pagination: PaginationQuery,
  db?: Db,
): Promise<{ items: UserRecord[]; total: number }> {
  const { page, pageSize } = pagination;
  return run(db, async (client) => {
    const { rows } = await client.query<UserRow & { total: string }>(
      `SELECT ${COLUMNS}, count(*) OVER()::text AS total
         FROM users
        WHERE role = 'MANAGER'
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2`,
      [pageSize, (page - 1) * pageSize],
    );
    return {
      items: rows.map(toRecord),
      total: rows[0] ? Number(rows[0].total) : 0,
    };
  });
}
