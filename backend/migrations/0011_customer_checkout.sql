-- 0011_customer_checkout.sql — spec 11
-- Customer checkout (guest + registered): order_items table, and the orders
-- columns still missing after 0006/0009 — delivery-address snapshot,
-- bKash transaction id, idempotency key, and the coupon historical-snapshot
-- fields required by 10-coupon-discount §8.23 (coupon_id/discount_amount
-- already exist from 0006/0009; coupon_code/discount_type/eligible_subtotal
-- are the missing three).
-- Forward-only: never edit this file after it has been applied.
--
-- The migration runner wraps this file in BEGIN/COMMIT, so no transaction
-- control appears here.

-- ---------------------------------------------------------------------------
-- order_items
-- ---------------------------------------------------------------------------
-- 03-payment-order §3 (order creation), 05-admin-operations order-detail view.
-- Snapshots product_name/variant_description/unit_price at order-creation time
-- (02-customer §2.9.3 step 5 revalidates live price, but the order line itself
-- must keep showing what was actually charged even if the catalogue changes
-- later — same historical-snapshot principle as §8.23 for coupons).

CREATE TABLE IF NOT EXISTS order_items (
  id                  uuid          NOT NULL DEFAULT gen_random_uuid(),
  order_id            uuid          NOT NULL,
  product_id          uuid          NOT NULL,
  product_variant_id  uuid          NULL,
  product_name        text          NOT NULL,
  variant_description text          NULL,
  unit_price          numeric(12,2) NOT NULL,
  quantity            integer       NOT NULL,
  line_total          numeric(12,2) NOT NULL,
  created_at          timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT order_items_pkey PRIMARY KEY (id),

  CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id)
    REFERENCES orders (id) ON DELETE CASCADE,

  CONSTRAINT order_items_product_id_fkey FOREIGN KEY (product_id)
    REFERENCES products (id),

  CONSTRAINT order_items_product_variant_id_fkey FOREIGN KEY (product_variant_id)
    REFERENCES product_variants (id),

  CONSTRAINT order_items_quantity_positive_check CHECK (quantity > 0),
  CONSTRAINT order_items_unit_price_nonnegative_check CHECK (unit_price >= 0),
  CONSTRAINT order_items_line_total_nonnegative_check CHECK (line_total >= 0)
);

CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON order_items (order_id);

-- ---------------------------------------------------------------------------
-- orders — delivery-address snapshot, payment idempotency/dedup, coupon
-- historical-snapshot fields
-- ---------------------------------------------------------------------------
-- 02-customer §2.9.2/§2.9.4: guest and registered orders store the SAME
-- address shape as the `customers` table (02-customer §2.2 note; see
-- 0002_identity_address_audit.sql) — mirrored here column-for-column so admin
-- views and courier mapping read one consistent shape regardless of whether
-- the customer record's OWN address was later edited after the order shipped.
--
-- 03-payment-order §3.1: idempotent order placement (idempotency_key, unique)
-- and a bKash Transaction ID that must be unique across all orders
-- (bkash_transaction_id, unique) — both nullable because a COD order has
-- neither one filled the same way, and bKash orders do not require the
-- transaction id to already be known at order-creation time (the customer
-- sends money and submits the id in a later step, §3.1 steps 2-5).
--
-- 10-coupon-discount §8.23: coupon_id/discount_amount already exist
-- (0006/0009); coupon_code/discount_type/eligible_subtotal are the missing
-- historical-snapshot fields so a later coupon edit/archive never changes
-- what an already-placed order displays.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS full_name         text            NULL,
  ADD COLUMN IF NOT EXISTS phone_number      text            NULL,
  ADD COLUMN IF NOT EXISTS division          text            NULL,
  ADD COLUMN IF NOT EXISTS district          text            NULL,
  ADD COLUMN IF NOT EXISTS area_unit_type    area_unit_type  NULL,
  ADD COLUMN IF NOT EXISTS area_unit_name    text            NULL,
  ADD COLUMN IF NOT EXISTS ward_unit_type    ward_unit_type  NULL,
  ADD COLUMN IF NOT EXISTS ward_unit_name    text            NULL,
  ADD COLUMN IF NOT EXISTS detailed_address  text            NULL,
  ADD COLUMN IF NOT EXISTS postal_code       text            NULL,
  ADD COLUMN IF NOT EXISTS bkash_transaction_id text         NULL,
  ADD COLUMN IF NOT EXISTS idempotency_key   text            NULL,
  ADD COLUMN IF NOT EXISTS coupon_code       text            NULL,
  ADD COLUMN IF NOT EXISTS discount_type     discount_type   NULL,
  ADD COLUMN IF NOT EXISTS eligible_subtotal numeric(12,2)   NULL;

-- §3.1: "The submitted bKash Transaction ID must be unique across all
-- orders." Enforced at the database level, not only in application code.
CREATE UNIQUE INDEX IF NOT EXISTS orders_bkash_transaction_id_key
  ON orders (bkash_transaction_id) WHERE bkash_transaction_id IS NOT NULL;

-- §3.1: idempotent order placement — a repeated request carrying the same
-- client-generated key must resolve to the original order, never a second one.
CREATE UNIQUE INDEX IF NOT EXISTS orders_idempotency_key_key
  ON orders (idempotency_key) WHERE idempotency_key IS NOT NULL;
