import type { SessionScope } from '../lib/session.js';
import { run, type Db } from './db.js';

/**
 * Server-side refresh-token storage (spec 03 §Database changes, §11.7).
 *
 * The raw token is never stored — only its SHA-256 hash — so a leaked database
 * row cannot itself be used as a session token.
 */

export type RefreshTokenRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  scope: SessionScope;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedBy: string | null;
  createdAt: Date;
};

type RefreshTokenRow = {
  id: string;
  user_id: string;
  token_hash: string;
  scope: SessionScope;
  expires_at: Date;
  revoked_at: Date | null;
  replaced_by: string | null;
  created_at: Date;
};

const COLUMNS = `id, user_id, token_hash, scope, expires_at, revoked_at, replaced_by, created_at`;

function toRecord(row: RefreshTokenRow): RefreshTokenRecord {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    scope: row.scope,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    replacedBy: row.replaced_by,
    createdAt: row.created_at,
  };
}

export async function create(
  input: { userId: string; tokenHash: string; scope: SessionScope; expiresAt: Date },
  db?: Db,
): Promise<RefreshTokenRecord> {
  return run(db, async (client) => {
    const { rows } = await client.query<RefreshTokenRow>(
      `INSERT INTO refresh_tokens (user_id, token_hash, scope, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING ${COLUMNS}`,
      [input.userId, input.tokenHash, input.scope, input.expiresAt],
    );
    return toRecord(rows[0]!);
  });
}

/** Lookup by hash — the only way a presented raw token is ever matched. */
export async function findByHash(tokenHash: string, db?: Db): Promise<RefreshTokenRecord | null> {
  return run(db, async (client) => {
    const { rows } = await client.query<RefreshTokenRow>(
      `SELECT ${COLUMNS} FROM refresh_tokens WHERE token_hash = $1`,
      [tokenHash],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  });
}

/** Marks one token revoked and records the token that replaced it (rotation). */
export async function revoke(id: string, replacedBy: string | null, db?: Db): Promise<void> {
  return run(db, async (client) => {
    await client.query(
      `UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $2
        WHERE id = $1 AND revoked_at IS NULL`,
      [id, replacedBy],
    );
  });
}

/**
 * Revokes every live token for a user (logout, reuse-detected rotation chain,
 * and the out-of-band Admin reset). `replaced_by` is left null — there is no
 * single successor when an entire chain is invalidated at once.
 */
export async function revokeAllForUser(userId: string, db?: Db): Promise<void> {
  return run(db, async (client) => {
    await client.query(
      `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
  });
}
