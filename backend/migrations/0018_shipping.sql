-- 0018_shipping.sql — spec 21 (shipping fee computation)
-- One authority for "what does delivery cost": computeShipping(), driven by an admin-managed
-- zone/rate table instead of the hard-coded DEFAULT_SHIPPING_AMOUNT = 0.
--   * shipping_zones / shipping_zone_districts / shipping_rates — the rate table. Rates are
--     append-only (a change is a newer effective_from row), so a historical order's amount stays explainable.
--   * shipping_unmatched_districts — districts that fell through to the default zone, so a misspelling
--     is a visible, fixable data problem rather than a silent undercharge.
--   * orders.shipping_zone_code — snapshot of the zone used at order time (never recalculated).
--   * orders total CHECK — total_amount = subtotal - discount_amount + shipping_amount. No earlier
--     migration created it, although spec 21 assumes it exists. Added NOT VALID (enforced for new and
--     updated rows) and then validated only if every historical row already satisfies it.
-- Strategy is text + CHECK (not a pg enum), so no TypeScript enum mirror is required.
-- The seeded rates (60 / 100 / 120 BDT) are placeholders the client must confirm before launch.

CREATE TABLE IF NOT EXISTS shipping_zones (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  code        text        NOT NULL,
  name        text        NOT NULL,
  is_default  boolean     NOT NULL DEFAULT false,
  sort_order  integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT shipping_zones_pkey PRIMARY KEY (id),
  CONSTRAINT shipping_zones_code_key UNIQUE (code)
);

-- Exactly one default zone: this is what makes "every address resolves to some zone" structural.
CREATE UNIQUE INDEX IF NOT EXISTS shipping_zones_single_default_idx
  ON shipping_zones ((is_default)) WHERE is_default;

CREATE TABLE IF NOT EXISTS shipping_zone_districts (
  zone_id     uuid    NOT NULL,
  district    text    NOT NULL,
  metro_only  boolean NOT NULL DEFAULT false,

  CONSTRAINT shipping_zone_districts_zone_fkey FOREIGN KEY (zone_id) REFERENCES shipping_zones (id) ON DELETE CASCADE,
  CONSTRAINT shipping_zone_districts_district_check CHECK (length(btrim(district)) > 0)
);

-- One district cannot map to two zones at the same metro specificity (matching is case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS shipping_zone_districts_district_metro_key
  ON shipping_zone_districts ((lower(btrim(district))), metro_only);
CREATE INDEX IF NOT EXISTS shipping_zone_districts_zone_id_idx ON shipping_zone_districts (zone_id);

CREATE TABLE IF NOT EXISTS shipping_rates (
  id                uuid          NOT NULL DEFAULT gen_random_uuid(),
  zone_id           uuid          NOT NULL,
  strategy          text          NOT NULL,
  flat_amount       numeric(12,2) NOT NULL,
  free_over_amount  numeric(12,2) NULL,
  effective_from    timestamptz   NOT NULL DEFAULT now(),
  created_by        uuid          NULL,
  created_at        timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT shipping_rates_pkey PRIMARY KEY (id),
  CONSTRAINT shipping_rates_zone_fkey FOREIGN KEY (zone_id) REFERENCES shipping_zones (id),
  CONSTRAINT shipping_rates_created_by_fkey FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT shipping_rates_strategy_check CHECK (strategy IN ('FLAT','FREE','FREE_OVER_THRESHOLD')),
  CONSTRAINT shipping_rates_flat_amount_check CHECK (flat_amount >= 0),
  CONSTRAINT shipping_rates_free_over_check CHECK (free_over_amount IS NULL OR free_over_amount >= 0),
  -- All-or-nothing threshold, mirroring 10-coupon-discount §8.4b's treatment of maximum_discount_amount.
  CONSTRAINT shipping_rates_threshold_check CHECK ((strategy = 'FREE_OVER_THRESHOLD') = (free_over_amount IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS shipping_rates_zone_effective_idx ON shipping_rates (zone_id, effective_from DESC);

CREATE TABLE IF NOT EXISTS shipping_unmatched_districts (
  district_key   text        NOT NULL,
  district_text  text        NOT NULL,
  occurrences    integer     NOT NULL DEFAULT 1,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT shipping_unmatched_districts_pkey PRIMARY KEY (district_key)
);

-- Seed ------------------------------------------------------------------------------------------
INSERT INTO shipping_zones (code, name, is_default, sort_order) VALUES
  ('INSIDE_DHAKA',  'Inside Dhaka',  false, 1),
  ('DHAKA_SUBURB',  'Dhaka Suburbs', false, 2),
  ('OUTSIDE_DHAKA', 'Outside Dhaka', true,  3)
ON CONFLICT (code) DO NOTHING;

INSERT INTO shipping_zone_districts (zone_id, district, metro_only)
SELECT z.id, d.district, d.metro_only
  FROM (VALUES
    ('INSIDE_DHAKA', 'Dhaka',        true),
    ('DHAKA_SUBURB', 'Dhaka',        false),
    ('DHAKA_SUBURB', 'Gazipur',      false),
    ('DHAKA_SUBURB', 'Narayanganj',  false)
  ) AS d (zone_code, district, metro_only)
  JOIN shipping_zones z ON z.code = d.zone_code
ON CONFLICT DO NOTHING;

INSERT INTO shipping_rates (zone_id, strategy, flat_amount)
SELECT z.id, 'FLAT', r.amount
  FROM (VALUES ('INSIDE_DHAKA', 60), ('DHAKA_SUBURB', 100), ('OUTSIDE_DHAKA', 120)) AS r (zone_code, amount)
  JOIN shipping_zones z ON z.code = r.zone_code
 WHERE NOT EXISTS (SELECT 1 FROM shipping_rates sr WHERE sr.zone_id = z.id);

-- Orders ----------------------------------------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_zone_code text NULL;

DO $$
BEGIN
  -- Scoped to this table (conrelid): constraint names are only unique per table, so a bare conname lookup
  -- would match the same-named constraint in another schema and skip creating it here.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'orders_total_composition_check' AND conrelid = 'orders'::regclass
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_total_composition_check
      CHECK (total_amount = subtotal - COALESCE(discount_amount, 0) + shipping_amount) NOT VALID;
  END IF;

  -- Validate only when history is consistent; otherwise the constraint stays enforced for new/updated rows.
  BEGIN
    ALTER TABLE orders VALIDATE CONSTRAINT orders_total_composition_check;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'orders_total_composition_check left NOT VALID: historical rows do not satisfy it';
  END;
END $$;
