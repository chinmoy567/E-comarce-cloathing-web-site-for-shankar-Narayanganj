-- 0023_order_delivery_instructions.sql — spec 13 (05-admin §5.2)
-- A short note for the courier ("call before delivery", "leave with the guard"), set by an
-- admin before the shipment is created and sent to the courier with it. Nullable: most orders
-- have none. Length is bounded in the API (250, the shortest courier limit), not here.
-- Forward-only: never edit this file after it has been applied.
--
-- The migration runner wraps this file in BEGIN/COMMIT, so no transaction
-- control appears here.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_instructions text NULL;
