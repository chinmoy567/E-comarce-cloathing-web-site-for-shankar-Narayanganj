-- 0008_customer_risk_checks.sql — spec 09
-- Customer Risk Check schema: customer_risk_checks table for fraud/delivery history checks
-- against courier APIs (e.g. BD Courier). Stores risk indicators, cached per customer_id.
-- Forward-only: never edit this file after it has been applied.
--
-- The migration runner wraps this file in BEGIN/COMMIT, so no transaction
-- control appears here.

-- ---------------------------------------------------------------------------
-- customer_risk_checks
-- ---------------------------------------------------------------------------
-- 09-fraud-risk-check §7 — customer risk/fraud check integration
-- Stores results of courier fraud-check API calls for audit and caching.
-- Cache key is customer_id (phone number), not order_id, so results are
-- reused across orders for the same customer within the rate-limit window.
-- order_id is recorded for audit provenance (which order triggered the check).

CREATE TABLE IF NOT EXISTS customer_risk_checks (
  id                uuid            NOT NULL DEFAULT gen_random_uuid(),
  customer_id       uuid            NOT NULL,
  order_id          uuid            NOT NULL,
  phone_number      text            NOT NULL,
  provider          text            NOT NULL,
  risk_score        integer         NULL,
  risk_level        text            NULL,
  total_orders      integer         NULL,
  successful_orders integer         NULL,
  returned_orders   integer         NULL,
  raw_result        jsonb           NOT NULL,
  checked_at        timestamptz     NOT NULL DEFAULT now(),
  checked_by        uuid            NOT NULL,

  PRIMARY KEY (id),

  FOREIGN KEY (customer_id) REFERENCES customers (id),

  FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,

  FOREIGN KEY (checked_by) REFERENCES users (id),

  UNIQUE (order_id)
);

CREATE INDEX IF NOT EXISTS customer_risk_checks_customer_id_idx
  ON customer_risk_checks (customer_id, checked_at DESC);

CREATE INDEX IF NOT EXISTS customer_risk_checks_order_id_idx
  ON customer_risk_checks (order_id);
