-- 0006_catalogue.sql — spec 05
-- Catalogue schema: categories, products, attributes, variants, and the
-- (as-yet-empty) product_images table spec 06 populates.
-- Forward-only: never edit this file after it has been applied.
--
-- The migration runner wraps this file in BEGIN/COMMIT, so no transaction
-- control appears here.

-- Trigram search support for products.name (spec 07's storefront search).
-- Installed into `public` explicitly: this migration runs with a scoped
-- `search_path` in tests (one schema per test file), so the operator class
-- below is referenced with an explicit `public.` qualifier rather than
-- relying on search_path to find it.
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- 05-admin-operations §5.1 note: Active/Inactive are the two values of ONE
-- visibility status. OUT_OF_STOCK is deliberately NOT a value — it is derived
-- from stock data at read time, never stored as its own state.
CREATE TYPE product_status AS ENUM ('ACTIVE', 'INACTIVE');

-- 05-admin-operations §5.1: size / colour / age group / other future types,
-- data-driven rather than a fixed column per attribute kind.
CREATE TYPE attribute_type AS ENUM ('SIZE', 'COLOUR', 'AGE_GROUP', 'OTHER');

-- ---------------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------------
-- Self-referencing tree covering categories and subcategories (§5.1). Depth is
-- limited to two levels by a service-layer check (a category with a non-null
-- parent_id cannot itself be a parent) — not a schema constraint, since the
-- spec speaks only of "categories and subcategories" without ruling out a
-- deeper tree at the storage layer.

CREATE TABLE categories (
  id             uuid            NOT NULL DEFAULT gen_random_uuid(),
  parent_id      uuid            NULL,
  name           text            NOT NULL,
  slug           text            NOT NULL,
  description    text            NULL,
  display_order  integer         NOT NULL DEFAULT 0,
  status         product_status  NOT NULL DEFAULT 'ACTIVE',
  image_url      text            NULL,
  created_by     uuid            NULL,
  updated_by     uuid            NULL,
  created_at     timestamptz     NOT NULL DEFAULT now(),
  updated_at     timestamptz     NOT NULL DEFAULT now(),

  CONSTRAINT categories_pkey PRIMARY KEY (id),

  -- RESTRICT: a category with children cannot be deleted (see products FK too).
  CONSTRAINT categories_parent_id_fkey FOREIGN KEY (parent_id)
    REFERENCES categories (id) ON DELETE RESTRICT,

  CONSTRAINT categories_created_by_fkey FOREIGN KEY (created_by)
    REFERENCES users (id),
  CONSTRAINT categories_updated_by_fkey FOREIGN KEY (updated_by)
    REFERENCES users (id),

  CONSTRAINT categories_slug_key UNIQUE (slug),

  CONSTRAINT categories_parent_not_self CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE INDEX categories_parent_display_order_idx
  ON categories (parent_id, display_order);

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------

CREATE TABLE products (
  id                 uuid            NOT NULL DEFAULT gen_random_uuid(),
  category_id        uuid            NOT NULL,
  name               text            NOT NULL,
  slug               text            NOT NULL,
  sku                text            NULL,
  description        text            NULL,
  base_price         numeric(12,2)   NOT NULL,
  compare_at_price   numeric(12,2)   NULL,
  status             product_status  NOT NULL DEFAULT 'INACTIVE',
  is_featured        boolean         NOT NULL DEFAULT false,
  weight_grams       integer         NULL,
  created_by         uuid            NULL,
  updated_by         uuid            NULL,
  created_at         timestamptz     NOT NULL DEFAULT now(),
  updated_at         timestamptz     NOT NULL DEFAULT now(),

  CONSTRAINT products_pkey PRIMARY KEY (id),

  -- RESTRICT: a category with products cannot be deleted (§5.1 delete guard).
  CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id)
    REFERENCES categories (id) ON DELETE RESTRICT,

  CONSTRAINT products_created_by_fkey FOREIGN KEY (created_by)
    REFERENCES users (id),
  CONSTRAINT products_updated_by_fkey FOREIGN KEY (updated_by)
    REFERENCES users (id),

  CONSTRAINT products_slug_key UNIQUE (slug),

  CONSTRAINT products_base_price_check CHECK (base_price >= 0),

  -- A "discount" that raises the price above the base price is a data error.
  CONSTRAINT products_compare_at_price_check
    CHECK (compare_at_price IS NULL OR compare_at_price >= base_price)
);

-- Partial unique: sku is optional (§12.5 "included only if the product has one").
CREATE UNIQUE INDEX products_sku_key ON products (sku) WHERE sku IS NOT NULL;

-- §13.5 LATEST rule.
CREATE INDEX products_status_created_at_idx ON products (status, created_at DESC);
-- §13.5 FEATURED rule.
CREATE INDEX products_status_is_featured_idx ON products (status, is_featured);
-- §13.5 CATEGORY rule.
CREATE INDEX products_category_id_status_idx ON products (category_id, status);
-- Spec 07 storefront search.
CREATE INDEX products_name_trgm_idx ON products USING gin (name public.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- product_attributes / product_attribute_values
-- ---------------------------------------------------------------------------
-- §5.1: manage sizes / colours / age groups / other future fashion attributes.
-- Data-driven rather than a fixed column list.

CREATE TABLE product_attributes (
  id             uuid            NOT NULL DEFAULT gen_random_uuid(),
  type           attribute_type  NOT NULL,
  name           text            NOT NULL,
  display_order  integer         NOT NULL DEFAULT 0,
  created_at     timestamptz     NOT NULL DEFAULT now(),
  updated_at     timestamptz     NOT NULL DEFAULT now(),

  CONSTRAINT product_attributes_pkey PRIMARY KEY (id)
);

CREATE TABLE product_attribute_values (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  attribute_id   uuid        NOT NULL,
  value          text        NOT NULL,
  display_order  integer     NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT product_attribute_values_pkey PRIMARY KEY (id),

  CONSTRAINT product_attribute_values_attribute_id_fkey FOREIGN KEY (attribute_id)
    REFERENCES product_attributes (id) ON DELETE RESTRICT,

  CONSTRAINT product_attribute_values_attribute_id_value_key
    UNIQUE (attribute_id, value)
);

CREATE INDEX product_attribute_values_attribute_id_idx
  ON product_attribute_values (attribute_id);

-- ---------------------------------------------------------------------------
-- product_variants
-- ---------------------------------------------------------------------------
-- Stock lives here (§5.1: "Stock should be managed at the appropriate product
-- or variant level"). Every product has at least one variant — a product with
-- no options gets a single default variant with no attribute values — so
-- there is exactly one place stock is ever read or written.

CREATE TABLE product_variants (
  id                   uuid            NOT NULL DEFAULT gen_random_uuid(),
  product_id           uuid            NOT NULL,
  sku                  text            NULL,
  price                numeric(12,2)   NULL,
  compare_at_price     numeric(12,2)   NULL,
  stock_quantity       integer         NOT NULL DEFAULT 0,
  low_stock_threshold  integer         NOT NULL DEFAULT 5,
  is_active            boolean         NOT NULL DEFAULT true,
  created_at           timestamptz     NOT NULL DEFAULT now(),
  updated_at           timestamptz     NOT NULL DEFAULT now(),

  CONSTRAINT product_variants_pkey PRIMARY KEY (id),

  CONSTRAINT product_variants_product_id_fkey FOREIGN KEY (product_id)
    REFERENCES products (id) ON DELETE CASCADE,

  -- The structural guarantee behind §5.1's oversell rule: even if application
  -- logic were wrong, the database refuses a negative stock row.
  CONSTRAINT product_variants_stock_quantity_check CHECK (stock_quantity >= 0)
);

CREATE UNIQUE INDEX product_variants_sku_key ON product_variants (sku) WHERE sku IS NOT NULL;
CREATE INDEX product_variants_product_id_idx ON product_variants (product_id);

-- ---------------------------------------------------------------------------
-- product_variant_values
-- ---------------------------------------------------------------------------
-- Join to the attribute values that define a variant (e.g. "Black / M"). A
-- service-layer check enforces that two variants of the same product cannot
-- share an identical attribute-value combination.

CREATE TABLE product_variant_values (
  variant_id          uuid NOT NULL,
  attribute_value_id  uuid NOT NULL,

  CONSTRAINT product_variant_values_pkey PRIMARY KEY (variant_id, attribute_value_id),

  CONSTRAINT product_variant_values_variant_id_fkey FOREIGN KEY (variant_id)
    REFERENCES product_variants (id) ON DELETE CASCADE,

  -- RESTRICT: an attribute value in use by a variant cannot be deleted.
  CONSTRAINT product_variant_values_attribute_value_id_fkey FOREIGN KEY (attribute_value_id)
    REFERENCES product_attribute_values (id) ON DELETE RESTRICT
);

CREATE INDEX product_variant_values_attribute_value_id_idx
  ON product_variant_values (attribute_value_id);

-- ---------------------------------------------------------------------------
-- product_images
-- ---------------------------------------------------------------------------
-- Created here, empty; populated by spec 06's upload path.

CREATE TABLE product_images (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  product_id     uuid        NOT NULL,
  storage_path   text        NOT NULL,
  alt_text       text        NULL,
  display_order  integer     NOT NULL DEFAULT 0,
  is_primary     boolean     NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT product_images_pkey PRIMARY KEY (id),

  CONSTRAINT product_images_product_id_fkey FOREIGN KEY (product_id)
    REFERENCES products (id) ON DELETE CASCADE
);

CREATE INDEX product_images_product_id_idx ON product_images (product_id);

-- At most one primary image per product.
CREATE UNIQUE INDEX product_images_one_primary_per_product_idx
  ON product_images (product_id) WHERE is_primary;
