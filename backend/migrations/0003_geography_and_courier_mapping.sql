-- 0003_geography_and_courier_mapping.sql — spec 08 prerequisite
-- Bangladesh administrative geography (the internal source of truth) and the
-- courier location-mapping boundary.
-- Forward-only: never edit this file after it has been applied.
--
-- The migration runner wraps this file in BEGIN/COMMIT, so no transaction
-- control appears here.
--
-- SOURCE OF TRUTH
-- ---------------
-- Division/District/Upazila rows come from the OCHA COD-AB v03 dataset for
-- Bangladesh, which is built from Bangladesh Bureau of Statistics (BBS) live
-- geoservices (boundary alignment: BBS as of March 2025). The dataset is
-- carried in `data/geography/bd-adm-cod-v03.json` and loaded by
-- `scripts/seedGeography.ts`. This file creates structure only — it inserts no
-- geography rows, so the dataset is never duplicated into SQL by hand.
--
-- The identifier is the official P-code (`BD20` -> `BD2003` -> `BD20030004`),
-- not a courier id and not a row number, which is what keeps internal geography
-- independent of Pathao and Steadfast (CLAUDE.md §6, 04-courier-shipment §4.2).
--
-- LEVEL 4 IS DELIBERATELY ABSENT
-- ------------------------------
-- 02-customer §2.2 requires a Union/Ward field, but the COD-AB dataset states
-- "ADM4 (Ward level) is not officially confirmed or maintained", and BBS
-- publishes no authoritative machine-readable union/ward geocode list. Creating
-- a `unions` table now would mean inventing records, which CLAUDE.md §1
-- forbids. Union/Ward therefore remains the validated free-text field spec 02
-- already ships (`customers.ward_unit_name` + `ward_unit_type`), and
-- `customers.union_ward_id` below is reserved, nullable, and unused until an
-- authoritative level-4 source exists.

-- ---------------------------------------------------------------------------
-- divisions (ADM1)
-- ---------------------------------------------------------------------------

CREATE TABLE geo_divisions (
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  pcode      text        NOT NULL,
  name       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT geo_divisions_pkey PRIMARY KEY (id),

  -- The official identifier. UNIQUE is what makes the seed an idempotent
  -- upsert (ON CONFLICT (pcode)) rather than a check-then-insert race.
  CONSTRAINT geo_divisions_pcode_key UNIQUE (pcode),
  CONSTRAINT geo_divisions_name_key UNIQUE (name),

  CONSTRAINT geo_divisions_pcode_format CHECK (pcode ~ '^BD[0-9]{2}$'),
  CONSTRAINT geo_divisions_name_not_blank CHECK (btrim(name) <> '')
);

-- ---------------------------------------------------------------------------
-- districts (ADM2)
-- ---------------------------------------------------------------------------

CREATE TABLE geo_districts (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  pcode       text        NOT NULL,
  name        text        NOT NULL,
  division_id uuid        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT geo_districts_pkey PRIMARY KEY (id),

  -- RESTRICT: a division that still has districts cannot be deleted, so the
  -- hierarchy can never be left with orphaned children.
  CONSTRAINT geo_districts_division_id_fkey FOREIGN KEY (division_id)
    REFERENCES geo_divisions (id) ON DELETE RESTRICT,

  CONSTRAINT geo_districts_pcode_key UNIQUE (pcode),

  -- Two districts may not share a name inside one division. Names are NOT
  -- globally unique in Bangladesh, so the constraint is scoped to the parent.
  CONSTRAINT geo_districts_division_name_key UNIQUE (division_id, name),

  -- The composite target that lets `geo_upazilas` prove, in the database, that
  -- its district really belongs to the division it claims (see below).
  CONSTRAINT geo_districts_id_division_key UNIQUE (id, division_id),

  CONSTRAINT geo_districts_pcode_format CHECK (pcode ~ '^BD[0-9]{4}$'),
  CONSTRAINT geo_districts_name_not_blank CHECK (btrim(name) <> '')
);

CREATE INDEX geo_districts_division_id_idx ON geo_districts (division_id);

-- ---------------------------------------------------------------------------
-- upazilas / thanas (ADM3)
-- ---------------------------------------------------------------------------
-- One table for both: an upazila and a metropolitan thana are the same
-- administrative level, told apart by the naming discriminator spec 02 already
-- defined (`area_unit_type`). The dataset's 507 ADM3 rows are 495 upazilas plus
-- 12 city-corporation units.

CREATE TABLE geo_upazilas (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  pcode       text        NOT NULL,
  name        text        NOT NULL,
  district_id uuid        NOT NULL,
  -- Denormalized parent, carried so the composite FK below can enforce that
  -- (district, division) is a real pair. It is maintained by the seed and is
  -- not independently writable in a way that could disagree, because the
  -- composite FK rejects any value that is not the district's true division.
  division_id uuid        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT geo_upazilas_pkey PRIMARY KEY (id),

  -- This is the constraint that makes "Chattogram -> Dhaka" unrepresentable:
  -- the pair must exist in geo_districts, so an upazila cannot be attached to a
  -- district/division combination that does not exist. Backend validation is
  -- additionally enforced in geography.validation.ts, but the database is the
  -- last line rather than the only line.
  CONSTRAINT geo_upazilas_district_division_fkey FOREIGN KEY (district_id, division_id)
    REFERENCES geo_districts (id, division_id) ON DELETE RESTRICT,

  CONSTRAINT geo_upazilas_pcode_key UNIQUE (pcode),
  CONSTRAINT geo_upazilas_district_name_key UNIQUE (district_id, name),

  -- Composite target for customers.* referential integrity (below).
  CONSTRAINT geo_upazilas_id_district_key UNIQUE (id, district_id),

  CONSTRAINT geo_upazilas_pcode_format CHECK (pcode ~ '^BD[0-9]{8}$'),
  CONSTRAINT geo_upazilas_name_not_blank CHECK (btrim(name) <> '')
);

CREATE INDEX geo_upazilas_district_id_idx ON geo_upazilas (district_id);

-- ---------------------------------------------------------------------------
-- customers — structured geography references
-- ---------------------------------------------------------------------------
-- Added alongside the existing text columns rather than replacing them.
-- Migration 0002 is already applied and its text columns hold real rows; a hard
-- cutover would have to drop or hand-fix any row that does not resolve. The
-- text columns stay authoritative for reads until every row is backfilled, and
-- `scripts/backfillCustomerGeography.ts` reports what it could not match
-- instead of guessing (CLAUDE.md §9, task §14).
--
-- Nullable by necessity: a NOT NULL column cannot be added to a populated table
-- without a default, and there is no correct default for a customer's district.

ALTER TABLE customers
  ADD COLUMN division_id   uuid NULL,
  ADD COLUMN district_id   uuid NULL,
  ADD COLUMN upazila_id    uuid NULL,
  -- Reserved for a future authoritative ADM4 source. No table to reference yet,
  -- so no FK is declared; the column exists so adding level 4 later does not
  -- require another ALTER on a large table.
  ADD COLUMN union_ward_id uuid NULL;

ALTER TABLE customers
  ADD CONSTRAINT customers_division_id_fkey FOREIGN KEY (division_id)
    REFERENCES geo_divisions (id) ON DELETE RESTRICT,

  -- Composite FKs, not plain ones: they enforce that the customer's district
  -- actually belongs to the customer's division, and the upazila to the
  -- district. A client that submits a valid-but-mismatched set of ids is
  -- rejected by Postgres even if application validation were bypassed.
  ADD CONSTRAINT customers_district_division_fkey FOREIGN KEY (district_id, division_id)
    REFERENCES geo_districts (id, division_id) ON DELETE RESTRICT,

  ADD CONSTRAINT customers_upazila_district_fkey FOREIGN KEY (upazila_id, district_id)
    REFERENCES geo_upazilas (id, district_id) ON DELETE RESTRICT,

  -- Partial population is only allowed in the top-down order the checkout flow
  -- fills it in; an upazila without its district can never be stored.
  ADD CONSTRAINT customers_geography_chain CHECK (
    (division_id IS NULL AND district_id IS NULL AND upazila_id IS NULL)
    OR (division_id IS NOT NULL AND district_id IS NULL AND upazila_id IS NULL)
    OR (division_id IS NOT NULL AND district_id IS NOT NULL AND upazila_id IS NULL)
    OR (division_id IS NOT NULL AND district_id IS NOT NULL AND upazila_id IS NOT NULL)
  );

CREATE INDEX customers_upazila_id_idx ON customers (upazila_id);

-- ---------------------------------------------------------------------------
-- courier location mapping
-- ---------------------------------------------------------------------------
-- The boundary between internal geography and each courier's proprietary
-- location ids (task §7-§9, 04-courier-shipment §4.2/§4.9).
--
-- Deliberately generic: one table keyed by courier code, rather than
-- `pathao_location_mapping` + `steadfast_location_mapping`. §4.9 requires the
-- courier list to be data-driven so a third courier needs no schema change, and
-- a per-courier table would contradict that. The per-courier boundary lives in
-- the adapter/mapping modules; this table is their shared storage.
--
-- NO ROWS ARE SEEDED HERE. Pathao's city/zone/area ids and Steadfast's location
-- fields must come from each provider's current official API at integration
-- time (CLAUDE.md §6, spec 14 assumptions 1-2). Inventing them is exactly what
-- the rules forbid, so this migration ships the structure empty.

CREATE TYPE geo_level AS ENUM ('DIVISION', 'DISTRICT', 'UPAZILA');

CREATE TABLE courier_location_mappings (
  id                 uuid        NOT NULL DEFAULT gen_random_uuid(),
  -- Matches the courier registry's code (spec 14), e.g. 'PATHAO', 'STEADFAST'.
  -- Text, not an enum: §4.9 requires adding a courier without a schema change.
  courier_code       text        NOT NULL,
  geo_level          geo_level   NOT NULL,
  geo_id             uuid        NOT NULL,
  -- The provider's own identifier, as its API returns it. Text because one
  -- provider's id is numeric and another's may not be; the adapter casts.
  courier_location_id text       NOT NULL,
  -- The provider's own label, kept for operator-facing diagnostics when a
  -- mapping looks wrong.
  courier_location_name text     NULL,
  -- Which provider API version/endpoint the value was resolved from, so a stale
  -- mapping is identifiable after a provider changes its location catalogue.
  source_note        text        NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT courier_location_mappings_pkey PRIMARY KEY (id),

  -- One mapping per (courier, internal entity): the adapter's lookup is
  -- single-valued, so a duplicate cannot make shipment creation ambiguous.
  CONSTRAINT courier_location_mappings_unique
    UNIQUE (courier_code, geo_level, geo_id),

  CONSTRAINT courier_location_mappings_courier_code_format
    CHECK (courier_code ~ '^[A-Z][A-Z0-9_]{1,31}$'),

  CONSTRAINT courier_location_mappings_location_id_not_blank
    CHECK (btrim(courier_location_id) <> '')
);

-- The adapter's read path: resolve one internal entity for one courier.
CREATE INDEX courier_location_mappings_lookup_idx
  ON courier_location_mappings (courier_code, geo_level, geo_id);

-- NOTE: geo_id is intentionally NOT a foreign key. It is polymorphic across
-- three tables, and Postgres cannot express a conditional FK; the repository
-- validates the referenced row exists for the given level before inserting.
-- A per-level nullable-column design was considered and rejected as it would
-- need a three-way CHECK and still not prevent a wrong-level pairing.
