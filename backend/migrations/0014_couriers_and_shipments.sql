-- 0014_couriers_and_shipments.sql — spec 14
-- Data-driven courier registry (04-courier §4.9: the courier list is rows, never
-- an enum), the remaining shipment columns (§4.5, §4.15 — one identifier field,
-- courier_order_id), and an audit of every provider call with NO customer PII
-- (only a digest of the outbound payload).
--
-- Existing shipments columns are kept as-is (courier, shipment_status,
-- courier_error, courier_error_at) because they are read widely; this migration
-- only adds. Credentials are NEVER stored here — they live in environment
-- variables (§4.8, 11-security §11.9).
--
-- Deliberately no FK to courier_location_mappings: its migration file is
-- unnumbered and sorts after numbered files.
-- Forward-only: never edit after it has been applied. The runner wraps this file
-- in BEGIN/COMMIT.

CREATE TABLE IF NOT EXISTS couriers (
  code                        text        NOT NULL,
  name                        text        NOT NULL,
  adapter_key                 text        NOT NULL,
  is_enabled                  boolean     NOT NULL DEFAULT true,
  supports_cancel             boolean     NOT NULL DEFAULT true,
  supports_tracking           boolean     NOT NULL DEFAULT true,
  supports_reference_lookup   boolean     NOT NULL DEFAULT false,
  tracking_url_template       text        NULL,
  display_order               integer     NOT NULL DEFAULT 0,
  config                      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT couriers_pkey PRIMARY KEY (code),
  CONSTRAINT couriers_code_format CHECK (code ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  CONSTRAINT couriers_display_order_nonneg CHECK (display_order >= 0)
);

-- supports_reference_lookup defaults false: the adapters flip it only after the
-- provider's current documentation confirms lookup by merchant reference.
INSERT INTO couriers (code, name, adapter_key, display_order)
VALUES
  ('PATHAO',    'Pathao',    'pathao',    10),
  ('STEADFAST', 'Steadfast', 'steadfast', 20)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS tracking_url              text          NULL,
  ADD COLUMN IF NOT EXISTS cod_amount                numeric(12,2) NULL,
  ADD COLUMN IF NOT EXISTS declared_weight_grams     integer       NULL,
  ADD COLUMN IF NOT EXISTS last_error_courier        text          NULL,
  ADD COLUMN IF NOT EXISTS created_with_courier_at   timestamptz   NULL,
  ADD COLUMN IF NOT EXISTS shipped_at                timestamptz   NULL,
  ADD COLUMN IF NOT EXISTS cancelled_with_courier_at timestamptz   NULL;

-- Rows written before this registry existed must not block the constraint;
-- new and updated rows are enforced.
ALTER TABLE shipments
  ADD CONSTRAINT shipments_courier_fkey FOREIGN KEY (courier)
  REFERENCES couriers (code) NOT VALID;

CREATE TABLE IF NOT EXISTS courier_requests (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  shipment_id     uuid        NULL,
  courier_code    text        NOT NULL,
  operation       text        NOT NULL,
  request_digest  text        NOT NULL,
  http_status     integer     NULL,
  succeeded       boolean     NOT NULL,
  error_message   text        NULL,
  duration_ms     integer     NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT courier_requests_pkey PRIMARY KEY (id),
  CONSTRAINT courier_requests_shipment_fkey FOREIGN KEY (shipment_id)
    REFERENCES shipments (id) ON DELETE SET NULL,
  CONSTRAINT courier_requests_operation_check
    CHECK (operation IN ('CREATE', 'DETAILS', 'TRACK', 'CANCEL'))
);

CREATE INDEX IF NOT EXISTS courier_requests_shipment_idx
  ON courier_requests (shipment_id, created_at DESC);
