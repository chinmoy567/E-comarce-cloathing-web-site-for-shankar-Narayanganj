import { run, type Db } from './db.js';

/**
 * One-time-code storage (spec 08, 02-customer §2.5). Only the HMAC of a code is
 * ever stored. "Live" means neither consumed nor invalidated; expiry is checked
 * by callers against `expiresAt`.
 */

export type OneTimeCodePurpose = 'PASSWORD_RESET' | 'PHONE_VERIFICATION';

export type OneTimeCodeRecord = {
  id: string;
  purpose: OneTimeCodePurpose;
  userId: string;
  destinationHash: string;
  codeHash: string;
  expiresAt: Date;
  attemptCount: number;
  consumedAt: Date | null;
  invalidatedAt: Date | null;
  grantSpentAt: Date | null;
  createdAt: Date;
};

type Row = {
  id: string;
  purpose: OneTimeCodePurpose;
  user_id: string;
  destination_hash: string;
  code_hash: string;
  expires_at: Date;
  attempt_count: number;
  consumed_at: Date | null;
  invalidated_at: Date | null;
  grant_spent_at: Date | null;
  created_at: Date;
};

const COLUMNS = `id, purpose, user_id, destination_hash, code_hash, expires_at, attempt_count, consumed_at, invalidated_at, grant_spent_at, created_at`;

function toRecord(row: Row): OneTimeCodeRecord {
  return {
    id: row.id,
    purpose: row.purpose,
    userId: row.user_id,
    destinationHash: row.destination_hash,
    codeHash: row.code_hash,
    expiresAt: row.expires_at,
    attemptCount: row.attempt_count,
    consumedAt: row.consumed_at,
    invalidatedAt: row.invalidated_at,
    grantSpentAt: row.grant_spent_at,
    createdAt: row.created_at,
  };
}

/** Codes issued to a user for a purpose in the last `windowSec` seconds (live or not). */
export async function countIssuedSince(
  userId: string,
  purpose: OneTimeCodePurpose,
  windowSec: number,
  db?: Db,
): Promise<number> {
  return run(db, async (client) => {
    const { rows } = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM one_time_codes
        WHERE user_id = $1 AND purpose = $2 AND created_at > now() - make_interval(secs => $3)`,
      [userId, purpose, windowSec],
    );
    return Number(rows[0]!.n);
  });
}

/** Invalidates every live code for the user+purpose; the partial unique index requires this before an insert. */
export async function invalidateLive(userId: string, purpose: OneTimeCodePurpose, db?: Db): Promise<void> {
  return run(db, async (client) => {
    await client.query(
      `UPDATE one_time_codes SET invalidated_at = now()
        WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL AND invalidated_at IS NULL`,
      [userId, purpose],
    );
  });
}

export async function create(
  input: { id: string; purpose: OneTimeCodePurpose; userId: string; destinationHash: string; codeHash: string; ttlSec: number },
  db?: Db,
): Promise<OneTimeCodeRecord> {
  return run(db, async (client) => {
    const { rows } = await client.query<Row>(
      `INSERT INTO one_time_codes (id, purpose, user_id, destination_hash, code_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))
       RETURNING ${COLUMNS}`,
      [input.id, input.purpose, input.userId, input.destinationHash, input.codeHash, input.ttlSec],
    );
    return toRecord(rows[0]!);
  });
}

/** Row-locks the code for the verify step so concurrent guesses cannot both beat the attempt cap. */
export async function findByIdForUpdate(id: string, db: Db): Promise<OneTimeCodeRecord | null> {
  return run(db, async (client) => {
    const { rows } = await client.query<Row>(`SELECT ${COLUMNS} FROM one_time_codes WHERE id = $1 FOR UPDATE`, [id]);
    return rows[0] ? toRecord(rows[0]) : null;
  });
}

/** Records a wrong guess; invalidates the code when the cap is reached. */
export async function recordFailedAttempt(id: string, maxAttempts: number, db?: Db): Promise<void> {
  return run(db, async (client) => {
    await client.query(
      `UPDATE one_time_codes
          SET attempt_count = attempt_count + 1,
              invalidated_at = CASE WHEN attempt_count + 1 >= $2 THEN now() ELSE invalidated_at END
        WHERE id = $1`,
      [id, maxAttempts],
    );
  });
}

export async function markConsumed(id: string, db?: Db): Promise<void> {
  return run(db, async (client) => {
    await client.query(`UPDATE one_time_codes SET consumed_at = now() WHERE id = $1`, [id]);
  });
}

/** Atomically spends the reset grant for a consumed code. Returns the owning user id, or null if already spent / not valid. */
export async function spendGrant(id: string, db?: Db): Promise<string | null> {
  return run(db, async (client) => {
    const { rows } = await client.query<{ user_id: string }>(
      `UPDATE one_time_codes SET grant_spent_at = now()
        WHERE id = $1 AND consumed_at IS NOT NULL AND grant_spent_at IS NULL AND invalidated_at IS NULL
        RETURNING user_id`,
      [id],
    );
    return rows[0]?.user_id ?? null;
  });
}
