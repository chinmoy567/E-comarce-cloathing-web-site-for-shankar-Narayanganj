-- 0010_homepage_cms.sql — spec 13
-- CMS-driven homepage schema: campaigns, homepage_sections, and the four
-- ordered join tables to the existing catalogue (§13.2, §13.4, §13.6, §13.6a,
-- §13.7). No product/category data is duplicated — every join table
-- references products/categories by id only.
-- Forward-only: never edit this file after it has been applied.
--
-- The migration runner wraps this file in BEGIN/COMMIT, so no transaction
-- control appears here.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE section_type AS ENUM
  ('HERO', 'CATEGORY_GRID', 'PRODUCT_CAROUSEL', 'CAMPAIGN_BANNER', 'PROMO_BANNER', 'CUSTOM_CONTENT');

-- Exactly 3 stored values. SCHEDULED/EXPIRED are computed-only labels
-- (§13.7a, §13.10), never persisted — matches coupon_status's own precedent
-- in 0009_coupons.sql.
CREATE TYPE cms_status AS ENUM ('DRAFT', 'ACTIVE', 'DISABLED');

-- ---------------------------------------------------------------------------
-- campaigns
-- ---------------------------------------------------------------------------

CREATE TABLE campaigns (
  id            uuid         NOT NULL DEFAULT gen_random_uuid(),
  name          text         NOT NULL,
  slug          text         NOT NULL,
  description   text         NULL,
  starts_at     timestamptz  NULL,
  ends_at       timestamptz  NULL,
  -- §13.7a: ACTIVE is the stored default a Campaign is created with.
  status        cms_status   NOT NULL DEFAULT 'ACTIVE',
  hero_content  jsonb        NULL,
  visual_theme  jsonb        NULL,
  created_by    uuid         NULL,
  updated_by    uuid         NULL,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT campaigns_pkey PRIMARY KEY (id),
  CONSTRAINT campaigns_slug_key UNIQUE (slug),

  CONSTRAINT campaigns_created_by_fkey FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT campaigns_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES users (id),

  CONSTRAINT campaigns_ends_after_starts_check
    CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX campaigns_status_idx ON campaigns (status);

-- ---------------------------------------------------------------------------
-- homepage_sections
-- ---------------------------------------------------------------------------

CREATE TABLE homepage_sections (
  id                    uuid          NOT NULL DEFAULT gen_random_uuid(),
  -- §13.4: immutable after creation — enforced below by the trigger, and at
  -- the API by the update schema simply having no such field.
  section_type          section_type  NOT NULL,
  title                 text          NULL,
  subtitle              text          NULL,
  display_order         integer       NOT NULL,
  status                cms_status    NOT NULL DEFAULT 'DRAFT',
  cta_label             text          NULL,
  cta_url               text          NULL,
  secondary_cta_label   text          NULL,
  secondary_cta_url     text          NULL,
  desktop_image_url     text          NULL,
  mobile_image_url      text          NULL,
  starts_at             timestamptz   NULL,
  ends_at               timestamptz   NULL,
  campaign_id           uuid          NULL,
  content_config        jsonb         NOT NULL DEFAULT '{}',
  created_by            uuid          NULL,
  updated_by            uuid          NULL,
  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT homepage_sections_pkey PRIMARY KEY (id),

  -- SET NULL, not CASCADE: deleting a campaign must not delete the sections
  -- that reference it (§13.4) — a CAMPAIGN_BANNER left without a campaign
  -- simply fails its own visibility check afterward.
  CONSTRAINT homepage_sections_campaign_id_fkey FOREIGN KEY (campaign_id)
    REFERENCES campaigns (id) ON DELETE SET NULL,

  CONSTRAINT homepage_sections_created_by_fkey FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT homepage_sections_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES users (id),

  CONSTRAINT homepage_sections_ends_after_starts_check
    CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at),
  CONSTRAINT homepage_sections_display_order_nonnegative_check CHECK (display_order >= 0)
);

-- §13.8 rendering order.
CREATE INDEX homepage_sections_status_display_order_idx ON homepage_sections (status, display_order);
CREATE INDEX homepage_sections_campaign_id_idx ON homepage_sections (campaign_id);

-- §13.4's immutability rule stated outright — enforced at the database too,
-- so a direct SQL UPDATE cannot bypass the API-level omission of the field.
CREATE OR REPLACE FUNCTION reject_section_type_change() RETURNS trigger AS $$
BEGIN
  IF NEW.section_type IS DISTINCT FROM OLD.section_type THEN
    RAISE EXCEPTION 'section_type is immutable after creation'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER homepage_sections_section_type_immutable
  BEFORE UPDATE ON homepage_sections
  FOR EACH ROW EXECUTE FUNCTION reject_section_type_change();

-- ---------------------------------------------------------------------------
-- homepage_section_products / homepage_section_categories (§13.6)
-- ---------------------------------------------------------------------------

CREATE TABLE homepage_section_products (
  section_id     uuid     NOT NULL,
  product_id     uuid     NOT NULL,
  display_order  integer  NOT NULL DEFAULT 0,

  CONSTRAINT homepage_section_products_pkey PRIMARY KEY (section_id, product_id),

  CONSTRAINT homepage_section_products_section_id_fkey FOREIGN KEY (section_id)
    REFERENCES homepage_sections (id) ON DELETE CASCADE,
  CONSTRAINT homepage_section_products_product_id_fkey FOREIGN KEY (product_id)
    REFERENCES products (id)
);

CREATE INDEX homepage_section_products_section_order_idx
  ON homepage_section_products (section_id, display_order);

CREATE TABLE homepage_section_categories (
  section_id     uuid     NOT NULL,
  category_id    uuid     NOT NULL,
  display_order  integer  NOT NULL DEFAULT 0,

  CONSTRAINT homepage_section_categories_pkey PRIMARY KEY (section_id, category_id),

  CONSTRAINT homepage_section_categories_section_id_fkey FOREIGN KEY (section_id)
    REFERENCES homepage_sections (id) ON DELETE CASCADE,
  CONSTRAINT homepage_section_categories_category_id_fkey FOREIGN KEY (category_id)
    REFERENCES categories (id)
);

CREATE INDEX homepage_section_categories_section_order_idx
  ON homepage_section_categories (section_id, display_order);

-- ---------------------------------------------------------------------------
-- campaign_products / campaign_categories (§13.6a)
-- ---------------------------------------------------------------------------

CREATE TABLE campaign_products (
  campaign_id    uuid     NOT NULL,
  product_id     uuid     NOT NULL,
  display_order  integer  NOT NULL DEFAULT 0,

  CONSTRAINT campaign_products_pkey PRIMARY KEY (campaign_id, product_id),

  CONSTRAINT campaign_products_campaign_id_fkey FOREIGN KEY (campaign_id)
    REFERENCES campaigns (id) ON DELETE CASCADE,
  CONSTRAINT campaign_products_product_id_fkey FOREIGN KEY (product_id)
    REFERENCES products (id)
);

CREATE INDEX campaign_products_campaign_order_idx ON campaign_products (campaign_id, display_order);

CREATE TABLE campaign_categories (
  campaign_id    uuid     NOT NULL,
  category_id    uuid     NOT NULL,
  display_order  integer  NOT NULL DEFAULT 0,

  CONSTRAINT campaign_categories_pkey PRIMARY KEY (campaign_id, category_id),

  CONSTRAINT campaign_categories_campaign_id_fkey FOREIGN KEY (campaign_id)
    REFERENCES campaigns (id) ON DELETE CASCADE,
  CONSTRAINT campaign_categories_category_id_fkey FOREIGN KEY (category_id)
    REFERENCES categories (id)
);

CREATE INDEX campaign_categories_campaign_order_idx ON campaign_categories (campaign_id, display_order);
