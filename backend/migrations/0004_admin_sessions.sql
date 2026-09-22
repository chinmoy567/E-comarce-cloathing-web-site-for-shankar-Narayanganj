-- 0004_admin_sessions.sql — spec 03
-- Server-side refresh-token storage for the back-office session (Admin/Manager
-- login) and, from spec 08 onward, the customer session — one table, scoped by
-- `scope`, so both sessions share the same rotation/revocation mechanism
-- without either ever being usable on the other's routes (02-customer §2.4).
-- Forward-only: never edit this file after it has been applied.
--
-- The migration runner wraps this file in BEGIN/COMMIT, so no transaction
-- control appears here.

CREATE TABLE refresh_tokens (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL,
  -- SHA-256 of the raw token; the raw token itself is never stored (11-security-hardening §11.7).
  token_hash  text        NOT NULL,
  scope       text        NOT NULL,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz NULL,
  replaced_by uuid        NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id),

  CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE,

  -- Rotation chain: the token a replay-detected reuse leads back to.
  CONSTRAINT refresh_tokens_replaced_by_fkey FOREIGN KEY (replaced_by)
    REFERENCES refresh_tokens (id),

  CONSTRAINT refresh_tokens_scope_check CHECK (scope IN ('admin', 'customer')),

  CONSTRAINT refresh_tokens_token_hash_key UNIQUE (token_hash)
);

-- Lookup for "does this user have a live session" and for revoking a chain.
CREATE INDEX refresh_tokens_user_id_revoked_at_idx
  ON refresh_tokens (user_id, revoked_at);
