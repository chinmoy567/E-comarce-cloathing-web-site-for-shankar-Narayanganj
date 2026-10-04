-- 0024_one_time_codes.sql — spec 08 (02-customer §2.5 password recovery)
-- Email OTPs for password reset. Only an HMAC of the code is stored, never the
-- code itself, so a database read does not yield usable codes. One live code per
-- (purpose, user) is enforced by a partial unique index, so issuing a new code
-- supersedes the old one instead of building a pool of valid codes.
-- Forward-only: never edit this file after it has been applied.

CREATE TABLE IF NOT EXISTS one_time_codes (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  purpose        text        NOT NULL,
  user_id        uuid        NOT NULL,
  -- SHA-256 of the lower-cased destination email (lookup/audit without storing it twice).
  destination_hash text      NOT NULL,
  code_hash      text        NOT NULL,
  expires_at     timestamptz NOT NULL,
  attempt_count  integer     NOT NULL DEFAULT 0,
  -- Set when the code is verified successfully (single use).
  consumed_at    timestamptz NULL,
  -- Set when superseded by a newer code or after too many wrong attempts.
  invalidated_at timestamptz NULL,
  -- Set when the reset grant issued for this code is redeemed (single use).
  grant_spent_at timestamptz NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT one_time_codes_pkey PRIMARY KEY (id),
  CONSTRAINT one_time_codes_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT one_time_codes_purpose_check CHECK (purpose IN ('PASSWORD_RESET')),
  CONSTRAINT one_time_codes_attempt_count_check CHECK (attempt_count >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS one_time_codes_one_live_per_user_idx
  ON one_time_codes (purpose, user_id)
  WHERE consumed_at IS NULL AND invalidated_at IS NULL;

-- The "N requests per account per window" count.
CREATE INDEX IF NOT EXISTS one_time_codes_user_created_idx
  ON one_time_codes (user_id, purpose, created_at);
