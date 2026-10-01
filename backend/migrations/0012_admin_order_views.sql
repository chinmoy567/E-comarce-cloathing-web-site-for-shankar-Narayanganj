-- 0012_admin_order_views.sql — spec 13
-- Admin order panel read-optimisations plus the two order columns the panel
-- needs: a denormalised "last payment rejected" time (so the list can sort by
-- time-since-rejection, 03-payment-order §3.4, without scanning
-- order_status_history) and an operator-only internal note (§5.2).
-- No new status, no new table. Forward-only: never edit after it has been applied.
--
-- The migration runner wraps this file in BEGIN/COMMIT, so no transaction
-- control appears here.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS last_payment_rejected_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS internal_note            text        NULL;

-- Status tabs on the admin list.
CREATE INDEX IF NOT EXISTS orders_status_payment_created_idx
  ON orders (order_status, payment_status, created_at DESC);

-- The bKash / COD split §5.2 requires.
CREATE INDEX IF NOT EXISTS orders_method_status_idx
  ON orders (payment_method, order_status);
