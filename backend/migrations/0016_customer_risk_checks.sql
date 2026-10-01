-- 0016_customer_risk_checks.sql — spec 16 (09-fraud-risk-check §7.6)
-- Reconciles the spec-09-era customer_risk_checks table (0008) with the spec 16
-- contract. 0008 is already applied and forward-only, so this is an ALTER.
--
-- Changes:
--   * risk_level text -> risk_level enum (LOW/MEDIUM/HIGH/UNKNOWN/CHECK_FAILED), NOT NULL
--   * risk_score integer -> numeric(6,2)
--   * order_id: nullable, ON DELETE SET NULL (provenance only), UNIQUE(order_id) dropped
--     so history is append-only and a customer can be checked more than once per order
--   * raw_result / checked_by: nullable (a failed check may have no payload; checked_by
--     survives user removal)
--   * customer_id FK: ON DELETE CASCADE
--
-- The migration runner wraps this file in BEGIN/COMMIT, so no transaction
-- control appears here.

CREATE TYPE risk_level AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'UNKNOWN', 'CHECK_FAILED');

-- risk_level: map any spec-09 text value onto the enum; anything unrecognised is UNKNOWN.
ALTER TABLE customer_risk_checks
  ALTER COLUMN risk_level TYPE risk_level
  USING (
    CASE upper(coalesce(risk_level, ''))
      WHEN 'LOW'          THEN 'LOW'::risk_level
      WHEN 'SAFE'         THEN 'LOW'::risk_level
      WHEN 'MEDIUM'       THEN 'MEDIUM'::risk_level
      WHEN 'HIGH'         THEN 'HIGH'::risk_level
      WHEN 'DANGER'       THEN 'HIGH'::risk_level
      WHEN 'CHECK_FAILED' THEN 'CHECK_FAILED'::risk_level
      ELSE 'UNKNOWN'::risk_level
    END
  );

ALTER TABLE customer_risk_checks ALTER COLUMN risk_level SET NOT NULL;

ALTER TABLE customer_risk_checks
  ALTER COLUMN risk_score TYPE numeric(6, 2) USING risk_score::numeric(6, 2);

-- order_id: provenance only.
ALTER TABLE customer_risk_checks DROP CONSTRAINT IF EXISTS customer_risk_checks_order_id_key;
ALTER TABLE customer_risk_checks DROP CONSTRAINT IF EXISTS customer_risk_checks_order_id_fkey;
ALTER TABLE customer_risk_checks ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE customer_risk_checks
  ADD CONSTRAINT customer_risk_checks_order_id_fkey
  FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE SET NULL;

-- raw_result / checked_by nullable.
ALTER TABLE customer_risk_checks ALTER COLUMN raw_result DROP NOT NULL;
ALTER TABLE customer_risk_checks ALTER COLUMN checked_by DROP NOT NULL;

-- customer_id: cascade with the customer record.
ALTER TABLE customer_risk_checks DROP CONSTRAINT IF EXISTS customer_risk_checks_customer_id_fkey;
ALTER TABLE customer_risk_checks
  ADD CONSTRAINT customer_risk_checks_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE;

-- (customer_id, checked_at DESC) and (order_id) indexes already exist from 0008.
