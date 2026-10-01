-- 0015_tracking_lookup.sql — spec 15
-- Courier status synchronization (04-courier §4.6), public Track Order lookup
-- (§4.14, §4.16) and the minimal idempotent applier's storage.
--
--   * shipments.status_sequence — monotonic ordinal of the current status, kept
--     in step with shipment_status by a trigger so every writer (admin actions,
--     sync) agrees. The applier rejects an update whose ordinal is not ahead of it
--     as STALE (07 §5.21; out-of-order courier updates must not regress status).
--   * shipment_sync_events — every inbound courier update (webhook or poll) with
--     its outcome. A partial UNIQUE index on applied events is the duplicate
--     backstop; the applier also checks under the shipment row lock.
--   * courier_webhook_deliveries — receipt audit; a DIGEST only, never the body
--     (it contains customer data).
--   * shipments.courier_order_id index — the Track Order lookup key. Not unique
--     across couriers, so the lookup treats a multi-match as not-found.
--   * shipments.last_* — the last normalized tracking snapshot, served from cache
--     within TRACK_REFRESH_TTL_SECONDS so the public endpoint cannot be used to
--     hammer a provider.
--
-- No (order_number, phone_number) composite index: order_number is already UNIQUE,
-- so the guest lookup's single-query match is one unique-index probe.
-- Forward-only: never edit after it has been applied. The runner wraps this file
-- in BEGIN/COMMIT.

CREATE OR REPLACE FUNCTION shipment_status_ordinal(s shipment_status) RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE s
    WHEN 'NOT_CREATED'      THEN 0
    WHEN 'CREATING'         THEN 1
    WHEN 'CREATION_FAILED'  THEN 1
    WHEN 'CREATED'          THEN 2
    WHEN 'SHIPPED'          THEN 3
    WHEN 'IN_TRANSIT'       THEN 4
    WHEN 'OUT_FOR_DELIVERY' THEN 5
    WHEN 'DELIVERY_FAILED'  THEN 5
    WHEN 'DELIVERED'        THEN 6
    WHEN 'RETURNED'         THEN 6
  END
$$;

ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS status_sequence          integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_synced_at           timestamptz NULL,
  ADD COLUMN IF NOT EXISTS last_events              jsonb       NULL,
  ADD COLUMN IF NOT EXISTS last_estimated_delivery  timestamptz NULL,
  ADD COLUMN IF NOT EXISTS last_delivery_area       text        NULL;

UPDATE shipments SET status_sequence = shipment_status_ordinal(shipment_status);

CREATE OR REPLACE FUNCTION shipments_set_status_sequence() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.status_sequence := shipment_status_ordinal(NEW.shipment_status);
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS shipments_status_sequence_trg ON shipments;
CREATE TRIGGER shipments_status_sequence_trg
  BEFORE INSERT OR UPDATE OF shipment_status ON shipments
  FOR EACH ROW EXECUTE FUNCTION shipments_set_status_sequence();

CREATE INDEX IF NOT EXISTS shipments_courier_order_id_idx
  ON shipments (courier_order_id)
  WHERE courier_order_id IS NOT NULL;

-- Rows written inside one transaction (a sync that chains SHIPPED -> IN_TRANSIT ->
-- OUT_FOR_DELIVERY) must keep their real order in every timeline. now() is the
-- transaction start, so such rows tie; clock_timestamp() gives each its own instant.
ALTER TABLE order_status_history ALTER COLUMN created_at SET DEFAULT clock_timestamp();

CREATE TABLE IF NOT EXISTS shipment_sync_events (
  id                uuid            NOT NULL DEFAULT gen_random_uuid(),
  shipment_id       uuid            NULL,
  courier_code      text            NOT NULL,
  courier_order_id  text            NULL,
  source            text            NOT NULL,
  reported_status   shipment_status NULL,
  provider_event_id text            NULL,
  dedupe_key        text            NOT NULL,
  occurred_at       timestamptz     NULL,
  applied           boolean         NOT NULL,
  skip_reason       text            NULL,
  created_at        timestamptz     NOT NULL DEFAULT now(),

  CONSTRAINT shipment_sync_events_pkey PRIMARY KEY (id),
  CONSTRAINT shipment_sync_events_shipment_fkey FOREIGN KEY (shipment_id)
    REFERENCES shipments (id) ON DELETE SET NULL,
  CONSTRAINT shipment_sync_events_source_check CHECK (source IN ('WEBHOOK', 'POLL')),
  CONSTRAINT shipment_sync_events_skip_reason_check CHECK (
    (applied = true  AND skip_reason IS NULL) OR
    (applied = false AND skip_reason IN
      ('DUPLICATE', 'STALE', 'INVALID_TRANSITION', 'UNKNOWN_SHIPMENT', 'UNRECOGNIZED_STATUS'))
  )
);

-- Duplicate backstop: one APPLIED event per (shipment, dedupe key). Skipped events
-- are not unique-constrained, so an update that was INVALID_TRANSITION earlier
-- (e.g. reported before the parcel was marked Shipped) can still apply later.
CREATE UNIQUE INDEX IF NOT EXISTS shipment_sync_events_applied_uq
  ON shipment_sync_events (shipment_id, dedupe_key)
  WHERE applied = true;

CREATE INDEX IF NOT EXISTS shipment_sync_events_shipment_idx
  ON shipment_sync_events (shipment_id, created_at DESC);

CREATE TABLE IF NOT EXISTS courier_webhook_deliveries (
  id                   uuid        NOT NULL DEFAULT gen_random_uuid(),
  courier_code         text        NOT NULL,
  signature_valid      boolean     NOT NULL,
  payload_digest       text        NOT NULL,
  http_status_returned integer     NOT NULL,
  received_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT courier_webhook_deliveries_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS courier_webhook_deliveries_received_idx
  ON courier_webhook_deliveries (courier_code, received_at DESC);
