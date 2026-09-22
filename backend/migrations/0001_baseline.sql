-- 0001_baseline.sql — spec 01
-- Migration bookkeeping and the extension later migrations depend on.
-- Forward-only: never edit this file after it has been applied.

-- gen_random_uuid() is used by every table created from spec 02 onward.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Applied-migration ledger. The runner refuses to re-apply a recorded id,
-- so running migrations repeatedly is safe.
CREATE TABLE IF NOT EXISTS schema_migrations (
  id         text        NOT NULL PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
