import { AppError, type ApiErrorDetailInput } from '../lib/errors.js';

/**
 * Maps database constraint violations onto the spec 02 error taxonomy.
 *
 * The constraints are the real enforcement point — a unique violation means a
 * concurrent writer won the race, not that an earlier application-level check
 * was skipped. Translating the driver error here keeps that race a clean 409
 * instead of a 500, without any repository re-reading to "check first".
 *
 * Constraint names are pinned explicitly in `0002_identity_address_audit.sql`
 * so this mapping cannot drift with a Postgres naming change.
 */

/** Postgres SQLSTATE codes we translate. */
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

type PgError = { code?: string; constraint?: string };

function asPgError(err: unknown): PgError | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const candidate = err as PgError;
  return typeof candidate.code === 'string' ? candidate : undefined;
}

/** Unique-constraint name -> the error the spec's table names for it. */
const UNIQUE_CONFLICTS: Record<string, { code: string; message: string }> = {
  customers_phone_number_key: {
    code: 'CUSTOMER_PHONE_EXISTS',
    message: 'A customer with this phone number already exists.',
  },
  users_user_identifier_key: {
    code: 'USER_IDENTIFIER_EXISTS',
    message: 'This user ID is already taken.',
  },
  users_phone_number_key: {
    code: 'USER_PHONE_EXISTS',
    message: 'An account with this phone number already exists.',
  },
  users_customer_id_key: {
    code: 'USER_PHONE_EXISTS',
    message: 'This customer already has a login identity.',
  },
  users_single_system_admin_key: {
    code: 'SYSTEM_ADMIN_EXISTS',
    message: 'A system administrator already exists.',
  },
  user_permissions_user_id_permission_key_key: {
    code: 'PERMISSION_ALREADY_GRANTED',
    message: 'This permission is already granted.',
  },
};

/**
 * `ConflictError`/`ValidationError` each fix one literal `code`, but spec 02's
 * error table names a distinct code per constraint. These carry the same status
 * with a per-instance code, so the centralized error handler treats them
 * identically to any other AppError.
 */
class ConstraintConflictError extends AppError {
  readonly status = 409;
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

class ConstraintValidationError extends AppError {
  readonly status = 400;
  readonly code: string;

  constructor(code: string, message: string, details: ApiErrorDetailInput[]) {
    super(message, details);
    this.code = code;
  }
}

/**
 * Rethrows a recognized constraint violation as its `AppError`, or the original
 * error untouched when it is not one we map.
 *
 * Always call as `throw toDomainError(err)` so the compiler sees the throw.
 */
export function toDomainError(err: unknown): unknown {
  const pgErr = asPgError(err);
  if (!pgErr?.constraint) return err;

  if (pgErr.code === UNIQUE_VIOLATION) {
    const mapped = UNIQUE_CONFLICTS[pgErr.constraint];
    if (mapped) return new ConstraintConflictError(mapped.code, mapped.message);
  }

  if (
    pgErr.code === FOREIGN_KEY_VIOLATION &&
    pgErr.constraint === 'user_permissions_permission_key_fkey'
  ) {
    return new ConstraintValidationError('UNKNOWN_PERMISSION', 'Unknown permission key.', [
      { field: 'permissionKey', message: 'is not a known permission' },
    ]);
  }

  return err;
}
