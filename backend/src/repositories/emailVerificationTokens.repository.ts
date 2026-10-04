import { run, type Db } from './db.js';

/**
 * Pending email-change confirmations (spec 08 §Email change). Only the SHA-256 of the emailed
 * token is stored. The address is written to `users` only when a token is consumed.
 */

/** Supersedes any unconsumed token for the user, then stores the new one. */
export async function replaceForUser(
  input: { userId: string; newEmail: string; tokenHash: string; ttlSec: number },
  db?: Db,
): Promise<void> {
  return run(db, async (client) => {
    await client.query(
      `UPDATE email_verification_tokens SET consumed_at = now() WHERE user_id = $1 AND consumed_at IS NULL`,
      [input.userId],
    );
    await client.query(
      `INSERT INTO email_verification_tokens (user_id, new_email, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(secs => $4))`,
      [input.userId, input.newEmail, input.tokenHash, input.ttlSec],
    );
  });
}

/** Atomically consumes a live token; returns who it was for and the address to confirm, or null. */
export async function consume(
  tokenHash: string,
  db?: Db,
): Promise<{ userId: string; newEmail: string } | null> {
  return run(db, async (client) => {
    const { rows } = await client.query<{ user_id: string; new_email: string }>(
      `UPDATE email_verification_tokens SET consumed_at = now()
        WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()
        RETURNING user_id, new_email`,
      [tokenHash],
    );
    return rows[0] ? { userId: rows[0].user_id, newEmail: rows[0].new_email } : null;
  });
}
