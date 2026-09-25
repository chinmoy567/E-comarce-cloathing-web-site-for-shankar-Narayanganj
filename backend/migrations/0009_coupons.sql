-- 0009_coupons.sql — spec 10
-- Coupon / Discount engine schema: coupons, coupon_usages, coupon_products,
-- coupon_categories tables and their enums (§8.24). Also adds the deferred
-- orders_coupon_id_fkey FK that 0006_orders.sql's own comment says this spec
-- owes it.
-- Forward-only: never edit this file after it has been applied.
--
-- The migration runner wraps this file in BEGIN/COMMIT, so no transaction
-- control appears here.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- 10-coupon-discount §8.4b — a coupon is either a percent-off or a fixed BDT
-- amount off, never both.
CREATE TYPE discount_type AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');

-- 10-coupon-discount §8.6 — EXPIRED is deliberately NOT a value here: it is
-- always a computed condition (status = ACTIVE AND now() > expires_at),
-- evaluated at validation/display time, never a stored, drift-prone status.
CREATE TYPE coupon_status AS ENUM ('DRAFT', 'ACTIVE', 'DISABLED');

-- 10-coupon-discount §8.13.
CREATE TYPE customer_eligibility AS ENUM ('ALL_CUSTOMERS', 'REGISTERED_CUSTOMERS_ONLY', 'SPECIFIC_CUSTOMER');

-- 10-coupon-discount §8.12. v1 always uses ALL_PRODUCTS; SPECIFIC_PRODUCTS /
-- SPECIFIC_CATEGORIES are modeled now so the schema does not change later.
CREATE TYPE product_eligibility AS ENUM ('ALL_PRODUCTS', 'SPECIFIC_PRODUCTS', 'SPECIFIC_CATEGORIES');

-- ---------------------------------------------------------------------------
-- coupons
-- ---------------------------------------------------------------------------
-- 10-coupon-discount §8.24a. Code uniqueness is enforced on the normalized
-- (trimmed + uppercased) value at the database level (§8.4a), so the
-- constraint holds even if an application path forgets to normalize.

CREATE TABLE IF NOT EXISTS coupons (
  id                       uuid                 NOT NULL DEFAULT gen_random_uuid(),
  code                     text                 NOT NULL,
  name                     text                 NOT NULL,
  description              text                 NULL,
  discount_type            discount_type        NOT NULL,
  discount_value           numeric(12,2)        NOT NULL,
  minimum_order_amount     numeric(12,2)        NULL,
  maximum_discount_amount  numeric(12,2)        NULL,
  starts_at                timestamptz          NOT NULL,
  expires_at               timestamptz          NOT NULL,
  usage_limit              integer              NULL,
  usage_count              integer              NOT NULL DEFAULT 0,
  per_customer_limit       integer              NULL,
  customer_eligibility     customer_eligibility NOT NULL DEFAULT 'ALL_CUSTOMERS',
  eligible_customer_id     uuid                 NULL,
  product_eligibility      product_eligibility  NOT NULL DEFAULT 'ALL_PRODUCTS',
  status                   coupon_status        NOT NULL DEFAULT 'DRAFT',
  is_archived              boolean              NOT NULL DEFAULT false,
  created_by               uuid                 NULL,
  updated_by               uuid                 NULL,
  created_at               timestamptz          NOT NULL DEFAULT now(),
  updated_at               timestamptz          NOT NULL DEFAULT now(),

  CONSTRAINT coupons_pkey PRIMARY KEY (id),

  CONSTRAINT coupons_eligible_customer_id_fkey FOREIGN KEY (eligible_customer_id)
    REFERENCES customers (id),

  CONSTRAINT coupons_created_by_fkey FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT coupons_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES users (id),

  CONSTRAINT coupons_expires_after_starts_check CHECK (expires_at > starts_at),
  CONSTRAINT coupons_discount_value_positive_check CHECK (discount_value > 0),
  CONSTRAINT coupons_percentage_max_100_check
    CHECK (discount_type <> 'PERCENTAGE' OR discount_value <= 100),
  -- §8.4b: maximum_discount_amount only ever means something on a PERCENTAGE
  -- coupon — structurally impossible on a FIXED_AMOUNT coupon, not merely
  -- application-validated.
  CONSTRAINT coupons_max_discount_percentage_only_check
    CHECK (maximum_discount_amount IS NULL OR discount_type = 'PERCENTAGE'),
  CONSTRAINT coupons_usage_count_nonnegative_check CHECK (usage_count >= 0),
  CONSTRAINT coupons_usage_limit_positive_check CHECK (usage_limit IS NULL OR usage_limit > 0),
  CONSTRAINT coupons_per_customer_limit_positive_check
    CHECK (per_customer_limit IS NULL OR per_customer_limit > 0),
  CONSTRAINT coupons_specific_customer_requires_id_check
    CHECK (customer_eligibility <> 'SPECIFIC_CUSTOMER' OR eligible_customer_id IS NOT NULL)
);

-- §8.4a: uniqueness on the normalized value, not the raw column, so `SAVE20`
-- and `save20` collide at the database level regardless of application logic.
CREATE UNIQUE INDEX IF NOT EXISTS coupons_code_unique ON coupons (upper(btrim(code)));

CREATE INDEX IF NOT EXISTS coupons_status_archived_expires_idx
  ON coupons (status, is_archived, expires_at);

-- ---------------------------------------------------------------------------
-- coupon_usages
-- ---------------------------------------------------------------------------
-- 10-coupon-discount §8.24b, §8.25. One row per redemption, for auditability
-- and accurate per-customer limit enforcement (counted here, not a second
-- denormalized per-customer counter). order_id is UNIQUE — §8.17 permits one
-- coupon per order, and this also structurally prevents a retried
-- order-creation attempt from double-recording a usage.

CREATE TABLE IF NOT EXISTS coupon_usages (
  id               uuid          NOT NULL DEFAULT gen_random_uuid(),
  coupon_id        uuid          NOT NULL,
  order_id         uuid          NOT NULL,
  customer_id      uuid          NOT NULL,
  discount_amount  numeric(12,2) NOT NULL,
  used_at          timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT coupon_usages_pkey PRIMARY KEY (id),

  -- ON DELETE RESTRICT reinforces §8.9 even against a direct database
  -- operation: a coupon with any usage row can never be hard-deleted.
  CONSTRAINT coupon_usages_coupon_id_fkey FOREIGN KEY (coupon_id)
    REFERENCES coupons (id) ON DELETE RESTRICT,

  CONSTRAINT coupon_usages_order_id_fkey FOREIGN KEY (order_id)
    REFERENCES orders (id),

  CONSTRAINT coupon_usages_customer_id_fkey FOREIGN KEY (customer_id)
    REFERENCES customers (id),

  CONSTRAINT coupon_usages_order_id_unique UNIQUE (order_id)
);

CREATE INDEX IF NOT EXISTS coupon_usages_coupon_customer_idx
  ON coupon_usages (coupon_id, customer_id);

-- ---------------------------------------------------------------------------
-- coupon_products / coupon_categories
-- ---------------------------------------------------------------------------
-- 10-coupon-discount §8.12, §8.24c. Created now, left unused in v1 (product/
-- category eligibility enforcement is deferred) — per §8.12's explicit
-- instruction not to omit the schema just because enforcement is deferred.

CREATE TABLE IF NOT EXISTS coupon_products (
  coupon_id   uuid NOT NULL,
  product_id  uuid NOT NULL,

  CONSTRAINT coupon_products_pkey PRIMARY KEY (coupon_id, product_id),

  CONSTRAINT coupon_products_coupon_id_fkey FOREIGN KEY (coupon_id)
    REFERENCES coupons (id) ON DELETE CASCADE,

  CONSTRAINT coupon_products_product_id_fkey FOREIGN KEY (product_id)
    REFERENCES products (id)
);

CREATE TABLE IF NOT EXISTS coupon_categories (
  coupon_id    uuid NOT NULL,
  category_id  uuid NOT NULL,

  CONSTRAINT coupon_categories_pkey PRIMARY KEY (coupon_id, category_id),

  CONSTRAINT coupon_categories_coupon_id_fkey FOREIGN KEY (coupon_id)
    REFERENCES coupons (id) ON DELETE CASCADE,

  CONSTRAINT coupon_categories_category_id_fkey FOREIGN KEY (category_id)
    REFERENCES categories (id)
);

-- ---------------------------------------------------------------------------
-- orders — the deferred coupon_id FK
-- ---------------------------------------------------------------------------
-- 0006_orders.sql's own comment: "coupon_id FK is nullable (coupons table
-- does not exist yet; add the constraint in Spec 10's migration once coupons
-- are created)." orders.coupon_id remains nullable and is currently always
-- inserted as NULL (spec 11 wires the real write path) — this constraint
-- alone does not require orders.repository.ts to change.

ALTER TABLE orders
  ADD CONSTRAINT orders_coupon_id_fkey FOREIGN KEY (coupon_id) REFERENCES coupons (id);
