-- 0021_payment_proofs.sql — spec 06 (private slice) + spec 11 (payment proof)
-- Registry of stored objects, and the link from an order to its bKash payment
-- screenshot. The screenshot lives in the PRIVATE `payment-proofs` bucket and is
-- released only as a short-lived signed URL to an admin holding `payment.view`.
-- Forward-only: never edit this file after it has been applied.
--
-- The migration runner wraps this file in BEGIN/COMMIT, so no transaction
-- control appears here.

-- ---------------------------------------------------------------------------
-- storage_objects
-- ---------------------------------------------------------------------------
-- Physical-object registry (spec 06 §Database changes) so deletions never leak
-- orphans and a private object carries its access classification in the
-- database, not only in a bucket name. `visibility` is text + CHECK rather than
-- a Postgres enum so it adds no enum that needs a TypeScript mirror.

CREATE TABLE IF NOT EXISTS storage_objects (
  id                 uuid         NOT NULL DEFAULT gen_random_uuid(),
  bucket             text         NOT NULL,
  object_path        text         NOT NULL,
  visibility         text         NOT NULL,
  mime_type          text         NOT NULL,
  byte_size          integer      NOT NULL,
  width              integer      NULL,
  height             integer      NULL,
  checksum_sha256    text         NOT NULL,
  uploaded_by        uuid         NULL,
  owner_entity_type  text         NULL,
  owner_entity_id    uuid         NULL,
  created_at         timestamptz  NOT NULL DEFAULT now(),
  deleted_at         timestamptz  NULL,

  CONSTRAINT storage_objects_pkey PRIMARY KEY (id),

  -- NULL for a guest's payment screenshot.
  CONSTRAINT storage_objects_uploaded_by_fkey FOREIGN KEY (uploaded_by)
    REFERENCES users (id),

  CONSTRAINT storage_objects_bucket_path_key UNIQUE (bucket, object_path),

  CONSTRAINT storage_objects_visibility_check CHECK (visibility IN ('PUBLIC', 'PRIVATE')),
  CONSTRAINT storage_objects_byte_size_positive_check CHECK (byte_size > 0)
);

CREATE INDEX IF NOT EXISTS storage_objects_owner_idx
  ON storage_objects (owner_entity_type, owner_entity_id);

-- ---------------------------------------------------------------------------
-- orders.payment_proof_object_id
-- ---------------------------------------------------------------------------
-- 03-payment-order §3.1: the customer may submit a Transaction ID and/or a
-- screenshot. The Transaction ID already lives on orders (0011); the screenshot
-- is referenced here. NULL when none was submitted.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_proof_object_id uuid NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_payment_proof_object_id_fkey'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_payment_proof_object_id_fkey
      FOREIGN KEY (payment_proof_object_id) REFERENCES storage_objects (id);
  END IF;
END
$$;
