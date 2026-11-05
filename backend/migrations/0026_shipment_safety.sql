-- 0026_shipment_safety.sql — courier go-live safety (04-courier §4.6, §4.11; 07 §5.21.5)
--
-- 1. creation_outcome_unknown: a failed creation where the courier never gave a definite
--    answer (timeout, network drop, 5xx, interrupted process). The parcel MAY exist, so a
--    retry needs the admin to confirm there is none, or to link the existing parcel.
-- 2. creating_started_at: when the current CREATING attempt began. A CREATING row older than
--    the configured limit was interrupted (process crash/restart) and is recovered to
--    CREATION_FAILED with the outcome marked unknown — never left locked forever.
-- 3. status_changed_at: when shipment_status last changed, for the "parcel not moving" alert.
-- 4. sync_problem / sync_problem_at: the last courier-sync failure that will not fix itself
--    (unrecognized courier status, rejected credentials, parcel not found). Cleared by the
--    next successful sync. Message is already sanitized (no credentials, no raw body).
--
-- No new shipment status and no new transition: 07-order-state-machine.md stays as written.
-- Forward-only: never edit after it has been applied. The runner wraps this file in BEGIN/COMMIT.

ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS creation_outcome_unknown boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS creating_started_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS sync_problem text NULL,
  ADD COLUMN IF NOT EXISTS sync_problem_at timestamptz NULL;

-- Existing rows: best available history.
UPDATE shipments SET status_changed_at = updated_at WHERE status_changed_at IS NULL;
UPDATE shipments SET creating_started_at = updated_at
 WHERE shipment_status = 'CREATING' AND creating_started_at IS NULL;

ALTER TABLE shipments ALTER COLUMN status_changed_at SET DEFAULT now();

-- Recovery sweep and dashboard alerts scan only small, partial sets.
CREATE INDEX IF NOT EXISTS shipments_creating_started_idx
  ON shipments (creating_started_at) WHERE shipment_status = 'CREATING';
CREATE INDEX IF NOT EXISTS shipments_sync_problem_idx
  ON shipments (sync_problem_at) WHERE sync_problem IS NOT NULL;
CREATE INDEX IF NOT EXISTS shipments_active_status_changed_idx
  ON shipments (status_changed_at)
  WHERE shipment_status IN ('CREATED','SHIPPED','IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERY_FAILED');

-- One consignment id belongs to one shipment per courier: linking a parcel by hand can
-- never attach the same courier parcel to two orders. NOT VALID-free: fails loudly if
-- existing data already violates it, which must be investigated rather than hidden.
CREATE UNIQUE INDEX IF NOT EXISTS shipments_courier_order_id_unique
  ON shipments (courier, courier_order_id) WHERE courier_order_id IS NOT NULL;
