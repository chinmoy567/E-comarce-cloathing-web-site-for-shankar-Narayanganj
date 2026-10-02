-- 0017_reporting.sql — spec 20 (analytics and business reports)
-- Reporting is read-only over the operational tables. Two additions keep 11-security-hardening
-- §11.4 ("no synchronous heavy work in the request path") satisfiable:
--   * report_daily_sales — a daily rollup (Asia/Dhaka calendar day, by orders.created_at),
--     recomputed — never incremented — by scripts/refreshReportRollups.ts.
--   * report_exports — queue/state for asynchronous CSV exports, processed out of band by
--     scripts/processReportExports.ts. The file itself lives in a PRIVATE storage bucket.
-- No business table is altered. The migration number is 0017 (the spec's "0020" would leave a gap).

CREATE TABLE IF NOT EXISTS report_daily_sales (
  day                date          NOT NULL,
  orders_placed      integer       NOT NULL DEFAULT 0,
  orders_confirmed   integer       NOT NULL DEFAULT 0,
  orders_delivered   integer       NOT NULL DEFAULT 0,
  orders_cancelled   integer       NOT NULL DEFAULT 0,
  orders_returned    integer       NOT NULL DEFAULT 0,
  gross_subtotal     numeric(14,2) NOT NULL DEFAULT 0,
  total_discount     numeric(14,2) NOT NULL DEFAULT 0,
  total_shipping     numeric(14,2) NOT NULL DEFAULT 0,
  net_revenue        numeric(14,2) NOT NULL DEFAULT 0,
  bkash_orders       integer       NOT NULL DEFAULT 0,
  cod_orders         integer       NOT NULL DEFAULT 0,
  coupon_orders      integer       NOT NULL DEFAULT 0,
  refreshed_at       timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT report_daily_sales_pkey PRIMARY KEY (day)
);

-- Status is text + CHECK (not a pg enum) so no TypeScript enum mirror is required.
CREATE TABLE IF NOT EXISTS report_exports (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  requested_by   uuid        NOT NULL,
  report         text        NOT NULL,
  range_from     date        NOT NULL,
  range_to       date        NOT NULL,
  status         text        NOT NULL DEFAULT 'PENDING',
  storage_path   text        NULL,
  error_message  text        NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  started_at     timestamptz NULL,
  completed_at   timestamptz NULL,

  CONSTRAINT report_exports_pkey PRIMARY KEY (id),
  CONSTRAINT report_exports_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES users (id),
  CONSTRAINT report_exports_status_check CHECK (status IN ('PENDING','PROCESSING','READY','FAILED')),
  CONSTRAINT report_exports_report_check CHECK (report IN (
    'sales-summary','sales-trend','sales-by-product','sales-by-category','orders-summary',
    'payments-summary','products-performance','products-stock','customers-summary',
    'shipments-summary','coupons-summary')),
  CONSTRAINT report_exports_range_check CHECK (range_from <= range_to)
);

CREATE INDEX IF NOT EXISTS report_exports_requested_by_idx ON report_exports (requested_by, created_at DESC);
CREATE INDEX IF NOT EXISTS report_exports_pending_idx ON report_exports (created_at) WHERE status = 'PENDING';

-- Supporting indexes for the report aggregates (order_items.order_id and orders.created_at already exist).
CREATE INDEX IF NOT EXISTS order_items_product_id_idx ON order_items (product_id);
CREATE INDEX IF NOT EXISTS shipments_courier_status_idx ON shipments (courier, shipment_status);
CREATE INDEX IF NOT EXISTS coupon_usages_coupon_id_idx ON coupon_usages (coupon_id);
CREATE INDEX IF NOT EXISTS customers_created_at_idx ON customers (created_at);
