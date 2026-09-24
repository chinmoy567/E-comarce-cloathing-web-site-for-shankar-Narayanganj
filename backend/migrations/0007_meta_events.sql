-- Migration: 0007_meta_events.sql
-- Spec: 08-analytics-meta.md §6, implementation-spec 18
-- Description: Meta Pixel / Conversions API event logging table and indexes
-- Forward-only: never edit this file after it has been applied
-- The migration runner wraps this file in BEGIN/COMMIT, so no transaction control appears here

CREATE TABLE meta_event_log (
  id                uuid          NOT NULL DEFAULT gen_random_uuid(),
  event_id          text          NOT NULL,
  event_name        text          NOT NULL,
  order_id          uuid          NULL REFERENCES orders(id) ON DELETE SET NULL,
  channel           text          NOT NULL,
  status            text          NOT NULL CHECK (status IN ('SENT', 'FAILED', 'SKIPPED')),
  http_status       integer       NULL,
  error_message     text          NULL,
  value_amount      numeric(12,2) NULL,
  sent_at           timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT meta_event_log_pkey PRIMARY KEY (id)
);

-- Unique index to enforce "Purchase fires exactly once per order" (§6.3)
CREATE UNIQUE INDEX meta_event_log_purchase_once_idx
  ON meta_event_log (event_name, order_id)
  WHERE event_name = 'Purchase' AND order_id IS NOT NULL;

-- Index for event_id deduplication lookup (§6.4)
CREATE INDEX meta_event_log_event_id_idx ON meta_event_log (event_id);

-- Indexes for admin queries and observability
CREATE INDEX meta_event_log_order_id_idx ON meta_event_log (order_id);
CREATE INDEX meta_event_log_status_idx ON meta_event_log (status);
CREATE INDEX meta_event_log_sent_at_idx ON meta_event_log (sent_at DESC);
