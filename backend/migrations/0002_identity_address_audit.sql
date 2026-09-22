-- 0002_identity_address_audit.sql — spec 02
-- Identity, Bangladesh address model, permission catalogue, and audit log.
-- Forward-only: never edit this file after it has been applied.
--
-- The migration runner wraps this file in BEGIN/COMMIT, so no transaction
-- control appears here.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- 06-rbac §5.19: the role set is exactly these three. A Postgres enum (rather
-- than a CHECK on text) is what makes an invalid role unwritable "whether by
-- application error or direct database access" — SUPER_ADMIN and STAFF are
-- absent by construction, not by application-layer validation.
CREATE TYPE user_role AS ENUM ('ADMIN', 'MANAGER', 'CUSTOMER');

-- 02-customer §2.9.4 / 05-admin-operations §5.7: guest references and
-- registered customers are the same kind of record, told apart by this field.
CREATE TYPE account_type AS ENUM ('GUEST', 'REGISTERED');

-- 02-customer §2.2 note: Upazila/Thana and Union/Ward are ONE field each with
-- a naming discriminator, not two independent fields each.
CREATE TYPE area_unit_type AS ENUM ('UPAZILA', 'THANA');
CREATE TYPE ward_unit_type AS ENUM ('UNION', 'WARD');

-- 06-rbac §5.18 matrix values.
CREATE TYPE permission_tier AS ENUM ('YES', 'ASSIGNED', 'NO');

-- ---------------------------------------------------------------------------
-- customers
-- ---------------------------------------------------------------------------
-- Registered customers AND guest references, one row per phone number.
-- Created before `users` because users.customer_id references it.
--
-- There is deliberately no separate guest address table (02-customer §2.9.2,
-- database skill §3): guest and registered orders read the same columns, so
-- admin views and courier mapping behave identically for both.

CREATE TABLE customers (
  id               uuid           NOT NULL DEFAULT gen_random_uuid(),
  account_type     account_type   NOT NULL DEFAULT 'GUEST',
  full_name        text           NOT NULL,
  phone_number     text           NOT NULL,
  email            text           NULL,
  division         text           NOT NULL,
  district         text           NOT NULL,
  area_unit_type   area_unit_type NOT NULL,
  area_unit_name   text           NOT NULL,
  ward_unit_type   ward_unit_type NOT NULL,
  ward_unit_name   text           NOT NULL,
  detailed_address text           NOT NULL,
  postal_code      text           NULL,
  created_at       timestamptz    NOT NULL DEFAULT now(),
  updated_at       timestamptz    NOT NULL DEFAULT now(),

  CONSTRAINT customers_pkey PRIMARY KEY (id),

  -- The single fact that lets customer-record reuse (§2.9.4), the risk-check
  -- cache (09-fraud-risk-check §7.6), and the per-customer coupon limit
  -- (10-coupon-discount §8.8) all key off one row. It also turns "create or
  -- reuse the guest reference" into an upsert rather than a check-then-insert
  -- race: two concurrent guest checkouts cannot create two rows.
  CONSTRAINT customers_phone_number_key UNIQUE (phone_number),

  -- Canonical normalized Bangladesh mobile form (spec 02 assumption 1).
  -- Application input passes through normalizeBdPhone before reaching here.
  CONSTRAINT customers_phone_number_format CHECK (phone_number ~ '^01[3-9][0-9]{8}$')
);

CREATE INDEX customers_account_type_idx ON customers (account_type);

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
-- Back-office (Admin/Manager) and registered-customer login identities.
-- A guest customer has NO row here: no role, no session, no password.

CREATE TABLE users (
  id                   uuid        NOT NULL DEFAULT gen_random_uuid(),
  role                 user_role   NOT NULL,
  user_identifier      text        NULL,
  phone_number         text        NULL,
  email                text        NULL,
  password_hash        text        NOT NULL,
  customer_id          uuid        NULL,
  is_system_admin      boolean     NOT NULL DEFAULT false,
  is_active            boolean     NOT NULL DEFAULT true,
  must_change_password boolean     NOT NULL DEFAULT false,
  last_login_at        timestamptz NULL,
  created_by           uuid        NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT users_pkey PRIMARY KEY (id),

  CONSTRAINT users_customer_id_fkey FOREIGN KEY (customer_id)
    REFERENCES customers (id) ON DELETE RESTRICT,

  CONSTRAINT users_created_by_fkey FOREIGN KEY (created_by)
    REFERENCES users (id),

  -- The schema-level expression of §5.19's "a customer role value must never
  -- grant access to any Admin/Manager back-office function": the two domains
  -- cannot even be shaped like one another.
  CONSTRAINT users_role_shape CHECK (
    (role IN ('ADMIN', 'MANAGER')
      AND user_identifier IS NOT NULL
      AND customer_id IS NULL)
    OR
    (role = 'CUSTOMER'
      AND phone_number IS NOT NULL
      AND customer_id IS NOT NULL)
  ),

  -- 06-rbac §5.12.3: only an Admin may carry the protected system designation.
  CONSTRAINT users_system_admin_is_admin CHECK (NOT is_system_admin OR role = 'ADMIN')
);

-- Admin/Manager login User ID (02-customer §2.8); NULL for customers.
CREATE UNIQUE INDEX users_user_identifier_key
  ON users (user_identifier) WHERE user_identifier IS NOT NULL;

-- 02-customer §2.1: "cannot create multiple accounts using the same mobile
-- phone number", enforced by the database rather than by application checks.
CREATE UNIQUE INDEX users_phone_number_key
  ON users (phone_number) WHERE phone_number IS NOT NULL;

-- One login identity per customer record — what makes §2.9.8's guest→registered
-- promotion single-valued rather than able to attach two identities to one row.
CREATE UNIQUE INDEX users_customer_id_key
  ON users (customer_id) WHERE customer_id IS NOT NULL;

-- At most one system admin, ever. This is what makes spec 03's seed idempotent
-- and concurrency-safe (§5.12.2) without relying on the seed's own check:
-- ON CONFLICT DO NOTHING targets this index.
CREATE UNIQUE INDEX users_single_system_admin_key
  ON users ((true)) WHERE is_system_admin;

CREATE INDEX users_role_idx ON users (role);

-- ---------------------------------------------------------------------------
-- permissions
-- ---------------------------------------------------------------------------
-- The authoritative catalogue, seeded below from 06-rbac §5.16 (keys) and
-- §5.18 (the matrix). If this seed and §5.18 ever disagree, §5.18 wins and the
-- seed is corrected — a test asserts every row against the PRD table.

CREATE TABLE permissions (
  key               text            NOT NULL,
  label             text            NOT NULL,
  admin_tier        permission_tier NOT NULL,
  manager_tier      permission_tier NOT NULL,
  is_administrative boolean         NOT NULL,

  CONSTRAINT permissions_pkey PRIMARY KEY (key)
);

-- All 47 §5.18 matrix rows. admin_tier is YES throughout in the current matrix.
-- is_administrative marks the §5.17 administrative split: manager account
-- management, role management, permission management, system and RBAC
-- configuration. Everything else is operational.
INSERT INTO permissions (key, label, admin_tier, manager_tier, is_administrative) VALUES
  ('dashboard.view',           'Dashboard View',                'YES', 'YES',      false),
  ('analytics.view',           'Analytics View',                'YES', 'ASSIGNED', false),
  ('audit.view',               'Audit Log View',                'YES', 'ASSIGNED', false),
  ('product.create',           'Product Create',                'YES', 'YES',      false),
  ('product.update',           'Product Update',                'YES', 'YES',      false),
  ('product.delete',           'Product Delete',                'YES', 'ASSIGNED', false),
  ('category.manage',          'Category Management',           'YES', 'YES',      false),
  ('product.image.manage',     'Product Image Management',      'YES', 'YES',      false),
  ('product.attribute.manage', 'Size / Colour Management',      'YES', 'YES',      false),
  ('product.variant.manage',   'Variant Management',            'YES', 'YES',      false),
  ('product.price.manage',     'Price Management',              'YES', 'YES',      false),
  ('inventory.manage',         'Inventory Management',          'YES', 'YES',      false),
  ('product.visibility.manage','Product Visibility',            'YES', 'YES',      false),
  ('order.view',               'Order View',                    'YES', 'YES',      false),
  ('order.update',             'Order Update',                  'YES', 'ASSIGNED', false),
  ('order.confirm',            'Order Confirmation',            'YES', 'YES',      false),
  ('order.cancel',             'Order Cancellation',            'YES', 'ASSIGNED', false),
  ('payment.view',             'bKash Payment View',            'YES', 'YES',      false),
  ('payment.verify',           'bKash Payment Verification',    'YES', 'YES',      false),
  ('payment.reject',           'bKash Payment Rejection',       'YES', 'YES',      false),
  ('payment.review',           'Payment Resubmission Review',   'YES', 'YES',      false),
  ('order.cod.confirm',        'COD Order Confirmation',        'YES', 'YES',      false),
  ('customer.view',            'Customer View',                 'YES', 'YES',      false),
  ('customer.update',          'Customer Update',               'YES', 'ASSIGNED', false),
  ('customer.risk.check',      'Customer Risk Check',           'YES', 'YES',      false),
  ('shipment.view',            'Shipment View',                 'YES', 'YES',      false),
  ('shipment.create',          'Shipment Creation',             'YES', 'YES',      false),
  ('courier.select',           'Courier Selection',             'YES', 'YES',      false),
  ('shipment.track',           'Shipment Tracking',             'YES', 'YES',      false),
  ('shipment.retry',           'Shipment Retry',                'YES', 'YES',      false),
  ('shipment.courier.change',  'Change Courier',                'YES', 'YES',      false),
  ('courier.manage',           'Courier Configuration',         'YES', 'ASSIGNED', false),
  ('cms.manage',               'CMS Management',                'YES', 'ASSIGNED', false),
  ('user.manager.create',      'Manager Create',                'YES', 'NO',       true),
  ('user.manager.update',      'Manager Update',                'YES', 'NO',       true),
  ('user.manager.delete',      'Manager Delete',                'YES', 'NO',       true),
  ('permission.assign',        'Manager Permission Assignment', 'YES', 'NO',       true),
  ('role.manage',              'Role Management',               'YES', 'NO',       true),
  ('permission.manage',        'Permission Management',         'YES', 'NO',       true),
  ('system.configure',         'System Configuration',          'YES', 'NO',       true),
  ('rbac.configure',           'RBAC Configuration',            'YES', 'NO',       true),
  ('coupon.view',              'Coupon View',                   'YES', 'YES',      false),
  ('coupon.create',            'Coupon Create',                 'YES', 'ASSIGNED', false),
  ('coupon.update',            'Coupon Update',                 'YES', 'ASSIGNED', false),
  ('coupon.status',            'Coupon Activate/Deactivate',    'YES', 'ASSIGNED', false),
  ('coupon.delete',            'Coupon Delete/Archive',         'YES', 'ASSIGNED', false),
  ('coupon.usage.view',        'Coupon Usage View',             'YES', 'YES',      false)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- user_permissions
-- ---------------------------------------------------------------------------
-- Grants of ASSIGNED-tier permissions to Manager accounts.

CREATE TABLE user_permissions (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL,
  permission_key text        NOT NULL,
  granted_by     uuid        NOT NULL,
  granted_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_permissions_pkey PRIMARY KEY (id),

  CONSTRAINT user_permissions_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE,

  -- RESTRICT: a permission key in the catalogue cannot be removed while any
  -- account still holds it.
  CONSTRAINT user_permissions_permission_key_fkey FOREIGN KEY (permission_key)
    REFERENCES permissions (key) ON DELETE RESTRICT,

  CONSTRAINT user_permissions_granted_by_fkey FOREIGN KEY (granted_by)
    REFERENCES users (id),

  -- Makes a repeated grant a no-op rather than a duplicate row.
  CONSTRAINT user_permissions_user_id_permission_key_key UNIQUE (user_id, permission_key)
);

-- ---------------------------------------------------------------------------
-- audit_logs
-- ---------------------------------------------------------------------------
-- Append-only (database skill §2.4, 06-rbac §5.15 rule 10, §5.21.11).
-- The repository exposes append() and read functions only; no UPDATE or DELETE
-- path exists in application code.
--
-- PII (phone, address) is never copied into previous_value/new_value beyond the
-- specific field actually changed (database skill §4).

CREATE TABLE audit_logs (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  entity_type    text        NOT NULL,
  entity_id      uuid        NULL,
  action         text        NOT NULL,
  previous_value jsonb       NULL,
  new_value      jsonb       NULL,
  reason         text        NULL,
  -- NULL actor means a system/courier-sync actor, paired with actor_type SYSTEM.
  actor_user_id  uuid        NULL,
  actor_type     text        NOT NULL,
  request_id     text        NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT audit_logs_pkey PRIMARY KEY (id),

  CONSTRAINT audit_logs_actor_user_id_fkey FOREIGN KEY (actor_user_id)
    REFERENCES users (id),

  CONSTRAINT audit_logs_actor_type_check CHECK (actor_type IN ('USER', 'SYSTEM'))
);

CREATE INDEX audit_logs_entity_idx
  ON audit_logs (entity_type, entity_id, created_at DESC);
