-- 0006_orders.sql — spec 07
-- Order, Payment, and Shipment state machine schema: orders table, shipments table,
-- order_status_history audit trail, and the enums for order_status, payment_method,
-- payment_status, and shipment_status (§5.21).
-- Forward-only: never edit this file after it has been applied.
--
-- The migration runner wraps this file in BEGIN/COMMIT, so no transaction
-- control appears here.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- 07-order-state-machine §5.21 — order status lifecycle (independent of
-- payment and shipment status per §5.21.11).
CREATE TYPE IF NOT EXISTS order_status AS ENUM (
  'PENDING_CONFIRMATION',
  'COD_VERIFICATION_PENDING',
  'CONFIRMED',
  'PROCESSING',
  'DELIVERED',
  'CANCELLED',
  'RETURNED'
);

-- Payment method selection at checkout (§3).
CREATE TYPE IF NOT EXISTS payment_method AS ENUM ('BKASH', 'COD');

-- 07-order-state-machine §5.21.2, §5.21.3 — payment status lifecycle.
-- bKash uses: PENDING_VERIFICATION, PAID_VERIFIED, REJECTED
-- COD uses: PENDING_COLLECTION, PAID_COLLECTED, REJECTED
-- Both share one enum; valid subset is enforced in the service layer
-- keyed off payment_method, not by two separate Postgres enums.
CREATE TYPE IF NOT EXISTS payment_status AS ENUM (
  'PENDING_VERIFICATION',
  'PAID_VERIFIED',
  'REJECTED',
  'PENDING_COLLECTION',
  'PAID_COLLECTED'
);

-- 07-order-state-machine §5.21.4 — shipment status lifecycle (independent
-- of order status per §5.21.4: order stays PROCESSING while shipment moves
-- through CREATED → SHIPPED → IN_TRANSIT → OUT_FOR_DELIVERY → DELIVERED).
CREATE TYPE IF NOT EXISTS shipment_status AS ENUM (
  'NOT_CREATED',
  'CREATING',
  'CREATED',
  'SHIPPED',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CREATION_FAILED',
  'DELIVERY_FAILED',
  'RETURNED'
);

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------
-- 03-payment-order §3, 05-admin-operations §5.2, 07-order-state-machine §5.21
-- Single order record with three independent status fields. Coupon fields
-- (coupon_id, discount_amount) coexist but do not add new statuses/transitions
-- per §5.21.11. coupon_id FK is nullable (coupons table does not exist yet;
-- add the constraint in Spec 10's migration once coupons are created).

CREATE TABLE IF NOT EXISTS orders (
  id                uuid            NOT NULL DEFAULT gen_random_uuid(),
  order_number      text            NOT NULL,
  customer_id       uuid            NOT NULL,
  payment_method    payment_method  NOT NULL,
  order_status      order_status    NOT NULL,
  payment_status    payment_status  NOT NULL,
  subtotal           numeric(12,2)   NOT NULL,
  shipping_amount    numeric(12,2)   NOT NULL DEFAULT 0,
  coupon_id          uuid            NULL,
  discount_amount    numeric(12,2)   NULL,
  total_amount       numeric(12,2)   NOT NULL,
  cancellation_reason text           NULL,
  cancelled_at       timestamptz     NULL,
  cancelled_by       uuid            NULL,
  created_at         timestamptz     NOT NULL DEFAULT now(),
  updated_at         timestamptz     NOT NULL DEFAULT now(),

  PRIMARY KEY (id),

  FOREIGN KEY (customer_id) REFERENCES customers (id),

  FOREIGN KEY (cancelled_by) REFERENCES users (id),

  UNIQUE (order_number),

  CHECK (subtotal >= 0),
  CHECK (shipping_amount >= 0),
  CHECK (total_amount >= 0)
);

CREATE INDEX IF NOT EXISTS orders_customer_id_idx ON orders (customer_id);
CREATE INDEX IF NOT EXISTS orders_order_status_idx ON orders (order_status);
CREATE INDEX IF NOT EXISTS orders_payment_status_idx ON orders (payment_status);
CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders (created_at DESC);

-- ---------------------------------------------------------------------------
-- shipments
-- ---------------------------------------------------------------------------
-- 04-courier-shipment §4.5, 07-order-state-machine §5.21.4 — shipment lifecycle
-- independent of order status. One row per order (1:1 relationship). Shipment
-- status moves through its own state machine while order_status remains in a
-- single state (typically PROCESSING); only two shipment outcomes cascade into
-- order-status changes (§5.21.4, §5.21.6): DELIVERED → order DELIVERED,
-- RETURNED → order RETURNED (atomic per §5.21.6).

CREATE TABLE IF NOT EXISTS shipments (
  id                uuid            NOT NULL DEFAULT gen_random_uuid(),
  order_id          uuid            NOT NULL UNIQUE,
  shipment_status   shipment_status NOT NULL DEFAULT 'NOT_CREATED',
  courier           text            NULL,
  courier_order_id  text            NULL,
  courier_error     text            NULL,
  courier_error_at  timestamptz     NULL,
  return_reason     text            NULL,
  created_at        timestamptz     NOT NULL DEFAULT now(),
  updated_at        timestamptz     NOT NULL DEFAULT now(),

  CONSTRAINT shipments_pkey PRIMARY KEY (id),

  CONSTRAINT shipments_order_id_fkey FOREIGN KEY (order_id)
    REFERENCES orders (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS shipments_order_id_idx ON shipments (order_id);

-- ---------------------------------------------------------------------------
-- order_status_history
-- ---------------------------------------------------------------------------
-- 07-order-state-machine §5.21.11 — append-only history of every order/payment/
-- shipment status change. Separate from the generic audit_logs table (spec 03)
-- to provide a fast, order-scoped, typed timeline for Admin/Manager order-detail
-- UI. Every transition writes to both tables inside the same transaction.

CREATE TABLE IF NOT EXISTS order_status_history (
  id              uuid            NOT NULL DEFAULT gen_random_uuid(),
  order_id        uuid            NOT NULL,
  status_field    text            NOT NULL CHECK (status_field IN ('order_status','payment_status','shipment_status')),
  previous_status text            NULL,
  new_status      text            NOT NULL,
  reason          text            NULL,
  actor_user_id   uuid            NULL,
  actor_type      text            NOT NULL CHECK (actor_type IN ('USER', 'SYSTEM')),
  created_at      timestamptz     NOT NULL DEFAULT now(),

  PRIMARY KEY (id),

  FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,

  FOREIGN KEY (actor_user_id) REFERENCES users (id)
);

CREATE INDEX IF NOT EXISTS order_status_history_order_id_idx ON order_status_history (order_id, created_at DESC);
