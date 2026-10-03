-- 0020_cart_wishlist.sql — spec 09 (server-side cart and wishlist)
--   * carts       — one row per anonymous visitor (token_hash) or per customer (customer_id).
--   * cart_items  — one line per variant. NO price column: prices are joined from the catalogue on
--                   every read, so a cart can never present a stale price as authoritative.
--   * wishlist_items — products (not variants), registered customers only.
-- status is text + CHECK (not a pg enum), so no TypeScript enum mirror is required.
-- Carts hold no PII: no name, phone or address column exists on any of these tables.

CREATE TABLE IF NOT EXISTS carts (
  id                 uuid        NOT NULL DEFAULT gen_random_uuid(),
  customer_id        uuid        NULL,
  token_hash         text        NULL,
  status             text        NOT NULL DEFAULT 'ACTIVE',
  converted_order_id uuid        NULL,
  last_activity_at   timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT carts_pkey PRIMARY KEY (id),
  CONSTRAINT carts_customer_id_fkey FOREIGN KEY (customer_id)
    REFERENCES customers (id) ON DELETE CASCADE,
  CONSTRAINT carts_status_check CHECK (status IN ('ACTIVE', 'CONVERTED', 'ABANDONED')),
  CONSTRAINT carts_owner_check CHECK (customer_id IS NOT NULL OR token_hash IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS carts_token_hash_key
  ON carts (token_hash) WHERE token_hash IS NOT NULL;

-- Exactly one active cart per customer: makes "merge into the customer's cart" deterministic.
CREATE UNIQUE INDEX IF NOT EXISTS carts_one_active_per_customer_idx
  ON carts (customer_id) WHERE customer_id IS NOT NULL AND status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS carts_status_last_activity_idx
  ON carts (status, last_activity_at);

CREATE TABLE IF NOT EXISTS cart_items (
  id                 uuid        NOT NULL DEFAULT gen_random_uuid(),
  cart_id            uuid        NOT NULL,
  product_variant_id uuid        NOT NULL,
  quantity           integer     NOT NULL,
  added_at           timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cart_items_pkey PRIMARY KEY (id),
  CONSTRAINT cart_items_cart_id_fkey FOREIGN KEY (cart_id)
    REFERENCES carts (id) ON DELETE CASCADE,
  CONSTRAINT cart_items_variant_fkey FOREIGN KEY (product_variant_id)
    REFERENCES product_variants (id) ON DELETE RESTRICT,
  CONSTRAINT cart_items_quantity_check CHECK (quantity > 0 AND quantity <= 99),
  CONSTRAINT cart_items_cart_variant_key UNIQUE (cart_id, product_variant_id)
);

CREATE TABLE IF NOT EXISTS wishlist_items (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  customer_id uuid        NOT NULL,
  product_id  uuid        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT wishlist_items_pkey PRIMARY KEY (id),
  CONSTRAINT wishlist_items_customer_fkey FOREIGN KEY (customer_id)
    REFERENCES customers (id) ON DELETE CASCADE,
  CONSTRAINT wishlist_items_product_fkey FOREIGN KEY (product_id)
    REFERENCES products (id) ON DELETE CASCADE,
  CONSTRAINT wishlist_items_customer_product_key UNIQUE (customer_id, product_id)
);
