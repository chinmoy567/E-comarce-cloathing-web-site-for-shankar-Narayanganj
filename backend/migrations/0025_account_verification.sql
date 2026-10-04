-- 0025_account_verification.sql — spec 08 (02-customer §2.6, §2.9.8)
-- Email-change confirmation, phone-change OTP purpose, and the verified-email
-- stamp that gates password recovery: an unconfirmed address can never receive a
-- recovery code (spec 08 acceptance 18).
-- Forward-only: never edit this file after it has been applied.

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz NULL;

-- Phone-change OTPs bind the code to the new number via destination_hash.
ALTER TABLE one_time_codes DROP CONSTRAINT IF EXISTS one_time_codes_purpose_check;
ALTER TABLE one_time_codes
  ADD CONSTRAINT one_time_codes_purpose_check CHECK (purpose IN ('PASSWORD_RESET', 'PHONE_VERIFICATION'));

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL,
  new_email   text        NOT NULL,
  -- SHA-256 of the raw token emailed to the customer; the raw token is never stored.
  token_hash  text        NOT NULL,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT email_verification_tokens_pkey PRIMARY KEY (id),
  CONSTRAINT email_verification_tokens_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT email_verification_tokens_token_hash_key UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS email_verification_tokens_user_idx
  ON email_verification_tokens (user_id, created_at);
